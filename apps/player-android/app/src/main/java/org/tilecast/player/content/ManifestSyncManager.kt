package org.tilecast.player.content

import android.content.Context
import androidx.room.withTransaction
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import org.tilecast.player.data.CachedAsset
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.data.StoredManifest
import org.tilecast.player.network.ManifestAsset
import org.tilecast.player.network.CalendarSourceConfig
import org.tilecast.player.network.StructuredSourceConfig
import org.tilecast.player.network.ClockAppConfig
import org.tilecast.player.network.DateAppConfig
import org.tilecast.player.network.QRCodeAppConfig
import org.tilecast.player.network.TickerAppConfig
import org.tilecast.player.network.PlayerManifest
import org.tilecast.player.network.TilecastApi
import java.io.File
import java.time.Duration
import java.time.Instant
import kotlin.random.Random
import java.util.concurrent.ConcurrentHashMap

data class PreparedContent(val manifest: PlayerManifest, val localFiles: Map<String, String>,val serverClockOffsetSeconds:Long?=null)
data class SyncProgress(val pendingVersion: Long? = null, val queueCount: Int = 0, val downloadedBytes: Long = 0, val requiredBytes: Long = 0, val cacheUsedBytes: Long = 0, val error: String? = null)

class ManifestSyncManager(
    private val context: Context,
    private val database: PlayerDatabase,
    private val api: TilecastApi,
    private var cacheLimitBytes: Long = 8L * 1024 * 1024 * 1024,
    private var minimumFreeBytes: Long = 1024L * 1024 * 1024,
    private var automaticVideoThresholdBytes: Long = 256L * 1024 * 1024,
    private var concurrentDownloads: Int = 2,
) {
    fun applyPolicy(maximumBytes:Long,minimumFree:Long,automaticThreshold:Long,downloads:Int){cacheLimitBytes=maximumBytes;minimumFreeBytes=minimumFree;automaticVideoThresholdBytes=automaticThreshold;concurrentDownloads=downloads}
    suspend fun loadActive(): PreparedContent? {
        val stored = database.manifests().active() ?: return null
        val manifest = runCatching { api.decodeManifest(stored.rawJson) }.getOrNull() ?: return null
        if (manifest.schemaVersion !in 1..9) return null
        val records = database.cachedAssets().all().associateBy { it.variantId }
        val local = records.filterValues { it.downloadStatus == "ready" && File(it.localPath).let { file -> file.exists() && file.length() == it.expectedFileSize } }.mapValues { it.value.localPath }
        val required = records.values.filter { it.requiredByActiveManifest }
        if (required.any { local[it.variantId] == null }) return null
        return PreparedContent(manifest, local)
    }

    suspend fun reconcile(serverUrl: String, credential: String, screenId: String, progress: (SyncProgress) -> Unit): PreparedContent? {
        val current = database.manifests().active()
        val response = api.manifest(serverUrl, credential, current?.etag)
        if (response.notModified) return null
        val manifest = response.manifest ?: return null
		val clockOffset=manifest.serverTime?.let{Duration.between(Instant.now(),Instant.parse(it)).seconds}
		try{validateManifest(manifest,screenId)}catch(error:Exception){progress(SyncProgress(pendingVersion=manifest.manifestVersion,cacheUsedBytes=cacheUsed(),error="Manifest validation failed"));return null}
        val raw = response.rawJson ?: error("Manifest response was empty")
        database.manifests().save(StoredManifest(manifest.manifestVersion, manifest.schemaVersion, raw, response.etag, "preparing", System.currentTimeMillis()))
        return try {
			database.cachedAssets().clearPendingRequirements()
			cleanupUnneeded()
            val required = selectDownloads(manifest)
            val requiredBytes = required.sumOf { it.fileSize }
			val missingBytes=required.sumOf{asset->val record=database.cachedAssets().get(asset.variantId);if(record?.downloadStatus=="ready"&&File(record.localPath).exists()&&record.sha256==asset.sha256)0L else asset.fileSize}
			ensureSpace(missingBytes)
            required.forEach { asset ->
                val path = finalFile(asset).absolutePath
                val old = database.cachedAssets().get(asset.variantId)
				database.cachedAssets().save(CachedAsset(asset.variantId,asset.assetId,asset.sha256,asset.fileSize,path,old?.downloadStatus?:"queued",old?.downloadedBytes?:0,old?.lastVerifiedAt,old?.lastUsedAt,old?.requiredByActiveManifest?:false,true,old?.failureReason))
            }
			val byteProgress=ConcurrentHashMap<String,Long>()
			progress(SyncProgress(manifest.manifestVersion,required.size,0,requiredBytes,cacheUsed()))
            val semaphore = Semaphore(concurrentDownloads)
			coroutineScope { required.map { asset -> async { semaphore.withPermit { downloadIfNeeded(serverUrl, credential, asset) { bytes -> byteProgress[asset.variantId]=bytes;progress(SyncProgress(manifest.manifestVersion,required.size,byteProgress.values.sum(),requiredBytes,cacheUsed())) } } } }.awaitAll() }
            database.manifests().setState(manifest.manifestVersion, "ready", System.currentTimeMillis(), null)
            val local = database.cachedAssets().all().filter { it.downloadStatus == "ready" }.associate { it.variantId to it.localPath }
            PreparedContent(manifest, local,clockOffset)
        } catch (error: Exception) {
            val safe = error.message ?: "Content could not be prepared"
            database.manifests().setState(manifest.manifestVersion, "failed", null, safe)
			progress(SyncProgress(manifest.manifestVersion,cacheUsedBytes=cacheUsed(),error = safe))
            null
        }
    }

    suspend fun activate(content: PreparedContent) {
        database.withTransaction {
            database.manifests().activate(content.manifest.manifestVersion, System.currentTimeMillis())
            database.cachedAssets().promoteRequirements()
        }
    }

	private fun selectDownloads(manifest: PlayerManifest): List<ManifestAsset> {
		val items = (manifest.playlists.flatMap { it.items } + manifest.directFallbackPlaylist?.items.orEmpty() + manifest.playlist?.items.orEmpty()).distinctBy { it.id }
        val byVariant = manifest.assets.associateBy { it.variantId }
		val explicit = items.mapNotNull { item ->
			val asset = item.variantId?.let{byVariant[it]} ?: return@mapNotNull null
            when (item.deliveryPolicy) {
                "download" -> asset
				"automatic" -> if (asset.mimeType.startsWith("image/")) asset else null
                else -> null
            }
		}.distinctBy { it.variantId }.toMutableList()
		manifest.websites.mapNotNull{it.fallbackVariantId?.let(byVariant::get)}.forEach{if(explicit.none{x->x.variantId==it.variantId})explicit+=it}
		val media=mediaDirectory();val used=media.walkTopDown().filter{it.isFile}.sumOf{it.length()};var remaining=minOf((cacheLimitBytes-used).coerceAtLeast(0),(media.usableSpace-minimumFreeBytes).coerceAtLeast(0))-explicit.sumOf{it.fileSize}
		items.filter{it.deliveryPolicy=="automatic"}.mapNotNull{it.variantId?.let(byVariant::get)}.filter{it.mimeType.startsWith("video/")&&it.fileSize<=automaticVideoThresholdBytes}.distinctBy{it.variantId}.forEach{if(it.fileSize<=remaining){explicit+=it;remaining-=it.fileSize}}
		return explicit
    }

    private suspend fun downloadIfNeeded(serverUrl: String, credential: String, asset: ManifestAsset, progress: (Long) -> Unit) {
        val final = finalFile(asset)
        val existing = database.cachedAssets().get(asset.variantId)
        if (existing?.downloadStatus == "ready" && final.exists() && final.length() == asset.fileSize && existing.sha256 == asset.sha256) return
        val part = File(final.absolutePath + ".part")
		val wasActive=existing?.requiredByActiveManifest?:false
        var lastError: Exception? = null
        repeat(4) { attempt ->
            try {
				database.cachedAssets().save(CachedAsset(asset.variantId,asset.assetId,asset.sha256,asset.fileSize,final.absolutePath,"downloading",part.takeIf{it.exists()}?.length()?:0,requiredByActiveManifest=wasActive,requiredByPendingManifest=true))
                api.downloadVariant(serverUrl, asset.downloadPath, credential, part, asset.sha256, asset.fileSize, progress)
                final.delete()
                check(part.renameTo(final)) { "Verified media could not be activated" }
				database.cachedAssets().save(CachedAsset(asset.variantId,asset.assetId,asset.sha256,asset.fileSize,final.absolutePath,"ready",asset.fileSize,System.currentTimeMillis(),requiredByActiveManifest=wasActive,requiredByPendingManifest=true))
                return
            } catch (error: Exception) {
                lastError = error
                if (attempt < 3) delay((1L shl attempt) * 1_000 + Random.nextLong(500))
            }
        }
		database.cachedAssets().save(CachedAsset(asset.variantId,asset.assetId,asset.sha256,asset.fileSize,final.absolutePath,"failed",part.takeIf{it.exists()}?.length()?:0,requiredByActiveManifest=wasActive,requiredByPendingManifest=true,failureReason=lastError?.message))
        throw lastError ?: IllegalStateException("Media download failed")
    }

	private suspend fun cleanupUnneeded() {
        database.cachedAssets().all().filter { !it.requiredByActiveManifest && !it.requiredByPendingManifest }.sortedBy { it.lastUsedAt ?: 0 }.forEach { record ->
            File(record.localPath).delete(); File(record.localPath + ".part").delete(); database.cachedAssets().delete(record.variantId)
		}
	    }
	    suspend fun clearUnprotectedCache():Boolean=runCatching{cleanupUnneeded();true}.getOrDefault(false)
    private fun ensureSpace(requiredBytes: Long) {
        val media = mediaDirectory(); val used = media.walkTopDown().filter { it.isFile }.sumOf { it.length() }
        val cacheAvailable = (cacheLimitBytes - used).coerceAtLeast(0)
        val diskAvailable = (media.usableSpace - minimumFreeBytes).coerceAtLeast(0)
        require(requiredBytes <= minOf(cacheAvailable, diskAvailable)) { "Insufficient storage to prepare this manifest" }
    }
    private fun mediaDirectory() = File(context.filesDir, "media-cache").apply { mkdirs() }
	private fun cacheUsed()=mediaDirectory().walkTopDown().filter{it.isFile}.sumOf{it.length()}
    private fun finalFile(asset: ManifestAsset) = File(mediaDirectory(), "${asset.variantId}.${extension(asset.mimeType)}")
    private fun extension(mime: String) = when (mime) { "video/mp4" -> "mp4"; "image/png" -> "png"; "image/webp" -> "webp"; "image/gif" -> "gif"; else -> "jpg" }
	private fun validateManifest(manifest: PlayerManifest, screenId: String) {
		require(manifest.schemaVersion in 1..9 && manifest.mode == "single-zone" && manifest.screenId == screenId) { "Manifest validation failed" }
		val assets = manifest.assets.associateBy { it.variantId }
		val websites = manifest.websites.associateBy { it.assetId }
		val sources = manifest.sources.associateBy { it.assetId }
		val playlists = manifest.playlists + listOfNotNull(manifest.directFallbackPlaylist, manifest.playlist)
		val playlistIds = playlists.map { it.id }.toSet()
		require(playlistIds.containsAll(manifest.schedules.map { it.playlistId }) && manifest.emergency?.playlistId?.let(playlistIds::contains) != false) { "Manifest references an unavailable playlist" }
		playlists.flatMap { it.items }.forEach { item ->
			when (item.assetType) {
				"website" -> require(websites[item.assetId] != null && (item.durationMs ?: 0) > 0 && item.deliveryPolicy == "stream") { "Website item is invalid" }
				"source" -> require(sources[item.assetId]?.provider in setOf("website", "youtube", "calendar", "rss", "atom", "json", "csv", "clock", "date", "qrcode", "ticker") && item.deliveryPolicy == "stream") { "App item is invalid" }
				else -> require(item.variantId != null && assets[item.variantId]?.assetId == item.assetId) { "Manifest item references an unavailable variant" }
			}
			require(item.fitMode in listOf("contain", "cover", "stretch") && item.transition in listOf("none", "fade") && item.deliveryPolicy in listOf("download", "stream", "automatic") && item.volume in 0f..1f) { "Manifest item settings are invalid" }
			if (item.variantId?.let { assets[it]?.mimeType?.startsWith("image/") } == true) require((item.durationMs ?: 0) > 0) { "Image duration is invalid" }
			if (item.videoEndOffsetMs != null) require(item.videoEndOffsetMs > (item.videoStartOffsetMs ?: 0)) { "Video offsets are invalid" }
		}
		manifest.websites.forEach { site ->
			require(site.allowedHosts.isNotEmpty() && site.allowedHosts.size <= 25 && site.url.length <= 2048 && site.loadTimeoutSeconds in 1..120 && site.zoomPercent in 50..200) { "Website configuration is invalid" }
			site.fallbackVariantId?.let { require(assets[it]?.assetId == site.fallbackImageAssetId) { "Website fallback is invalid" } }
		}
		manifest.sources.filter { it.provider == "calendar" }.forEach { source ->
			val config = Json.decodeFromJsonElement<CalendarSourceConfig>(source.configuration)
			require(config.displayMode in listOf("today", "upcoming", "this_week", "agenda") && config.maxEvents in 1..100 && config.emptyState.length <= 240 && config.data.events.size <= 2000) { "Calendar source configuration is invalid" }
			java.time.ZoneId.of(config.timezone)
			config.data.events.forEach { event ->
				require(event.id.length <= 64 && event.title.length <= 300 && event.location.length <= 300 && event.descriptionExcerpt.length <= 500) { "Calendar event is invalid" }
				val start = Instant.parse(event.start)
				val end = Instant.parse(event.end)
				require(!end.isBefore(start)) { "Calendar event range is invalid" }
			}
		}
		manifest.sources.filter { it.provider in setOf("rss", "atom", "json", "csv") }.forEach { source ->
			val config = Json.decodeFromJsonElement<StructuredSourceConfig>(source.configuration)
			require(config.presentation in setOf("list", "agenda", "cards", "ticker") && config.emptyState.length <= 240 && config.data.records.size <= 200) { "Structured App configuration is invalid" }
			if(config.dateSelection.enabled){require(config.dateSelection.mode in setOf("today","tomorrow","next_available","current_week","custom_range")&&config.dateSelection.noMatchBehavior in setOf("fallback_text","next_available","empty","hide","last_known_good"));java.time.ZoneId.of(config.dateSelection.timezone)}
			config.data.records.forEach { record ->
				require(record.id.length <= 64 && record.title.length <= 240 && record.subtitle.length <= 240 && record.description.length <= 500 && record.values.size <= 12) { "Structured source record is invalid" }
			}
		}
		manifest.sources.forEach { app -> when(app.provider){
			"clock"->{val config=Json.decodeFromJsonElement<ClockAppConfig>(app.configuration);java.time.ZoneId.of(config.timezone);require(config.format in setOf("12","24"))}
			"date"->{val config=Json.decodeFromJsonElement<DateAppConfig>(app.configuration);java.time.ZoneId.of(config.timezone);require(config.format in setOf("full","long","medium","short"))}
			"qrcode"->{val config=Json.decodeFromJsonElement<QRCodeAppConfig>(app.configuration);require(config.value.isNotBlank()&&config.value.length<=2048)}
			"ticker"->{val config=Json.decodeFromJsonElement<TickerAppConfig>(app.configuration);require(sources[config.sourceAssetId]?.provider in setOf("rss","atom","json","csv")&&config.field.length<=80)}
		}}
	}
}
