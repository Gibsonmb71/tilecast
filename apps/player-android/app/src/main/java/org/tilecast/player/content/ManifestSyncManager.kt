package org.tilecast.player.content

import android.content.Context
import androidx.room.withTransaction
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.tilecast.player.data.CachedAsset
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.data.StoredManifest
import org.tilecast.player.network.ManifestAsset
import org.tilecast.player.network.CalendarSourceConfig
import org.tilecast.player.network.StructuredSourceConfig
import org.tilecast.player.network.ClockWidgetConfig
import org.tilecast.player.network.DateWidgetConfig
import org.tilecast.player.network.QRCodeWidgetConfig
import org.tilecast.player.network.TickerWidgetConfig
import org.tilecast.player.network.DisplayWidgetConfig
import org.tilecast.player.network.CountdownWidgetConfig
import org.tilecast.player.network.MetricWidgetConfig
import org.tilecast.player.network.CardsWidgetConfig
import org.tilecast.player.network.WeatherWidgetConfig
import org.tilecast.player.network.TypedRecordData
import org.tilecast.player.network.PlayerManifest
import org.tilecast.player.network.TilecastApi
import java.io.File
import java.time.Duration
import java.time.Instant
import kotlin.random.Random
import java.util.concurrent.ConcurrentHashMap

data class PreparedContent(val manifest: PlayerManifest, val localFiles: Map<String, String>,val serverClockOffsetSeconds:Long?=null)
data class SyncProgress(val pendingVersion: Long? = null, val queueCount: Int = 0, val downloadedBytes: Long = 0, val requiredBytes: Long = 0, val cacheUsedBytes: Long = 0, val error: String? = null)

internal fun manifestEtagForRequest(activeCacheVerified: Boolean, etag: String?): String? =
    etag.takeIf { activeCacheVerified }

internal data class ActiveCacheValidation(
    val localFiles: Map<String, String>,
    val complete: Boolean,
)

internal fun validateActiveCache(
    records: Collection<CachedAsset>,
    verify: (CachedAsset) -> Boolean = { record ->
        ContentPolicy.verify(File(record.localPath), record.expectedFileSize, record.sha256)
    },
): ActiveCacheValidation {
    val required = records.filter { it.requiredByActiveManifest }
    val local = required
        .filter { it.downloadStatus == "ready" && verify(it) }
        .associate { it.variantId to it.localPath }
    return ActiveCacheValidation(local, local.size == required.size)
}

internal fun selectManifestDownloads(
    manifest: PlayerManifest,
    cacheUsedBytes: Long,
    usableSpaceBytes: Long,
    cacheLimitBytes: Long,
    minimumFreeBytes: Long,
    automaticVideoThresholdBytes: Long,
): List<ManifestAsset> {
    val items = (manifest.playlists.flatMap { it.items } + manifest.directFallbackPlaylist?.items.orEmpty() + manifest.playlist?.items.orEmpty()).distinctBy { it.id }
    val byVariant = manifest.assets.associateBy { it.variantId }
    val byAsset = manifest.assets.associateBy { it.assetId }
    val explicit = items.mapNotNull { item ->
        val asset = item.variantId?.let { byVariant[it] } ?: return@mapNotNull null
        when (item.deliveryPolicy) {
            "download" -> asset
            "automatic" -> if (asset.mimeType.startsWith("image/")) asset else null
            else -> null
        }
    }.distinctBy { it.variantId }.toMutableList()
    fun add(asset: ManifestAsset) {
        if (explicit.none { it.variantId == asset.variantId }) explicit += asset
    }
    manifest.websites.mapNotNull { it.fallbackVariantId?.let(byVariant::get) }.forEach(::add)
    fun presentationAssets(node: org.tilecast.player.network.PresentationNode): List<String> {
        val own = if (node.type == "asset_image") listOfNotNull(node.props["variantId"]?.jsonPrimitive?.contentOrNull) else emptyList()
        return own + node.children.flatMap(::presentationAssets)
    }
    manifest.widgets.flatMap { widget -> widget.presentation?.native?.root?.let(::presentationAssets).orEmpty() }
        .mapNotNull(byVariant::get)
        .forEach(::add)
    val layouts = (manifest.layouts + listOfNotNull(manifest.layout, manifest.directFallbackLayout)).distinctBy { it.id }
    layouts.flatMap { layout ->
        listOfNotNull(layout.document.canvas.backgroundAssetId) + layout.document.placements
            .filter { it.type == "asset" }
            .mapNotNull { it.assetId }
    }.mapNotNull(byAsset::get).forEach(::add)

    var remaining = minOf(
        (cacheLimitBytes - cacheUsedBytes).coerceAtLeast(0),
        (usableSpaceBytes - minimumFreeBytes).coerceAtLeast(0),
    ) - explicit.sumOf { it.fileSize }
    items.filter { it.deliveryPolicy == "automatic" }
        .mapNotNull { it.variantId?.let(byVariant::get) }
        .filter { it.mimeType.startsWith("video/") && it.fileSize <= automaticVideoThresholdBytes }
        .distinctBy { it.variantId }
        .forEach { asset -> if (asset.fileSize <= remaining) { explicit += asset; remaining -= asset.fileSize } }
    return explicit
}

class ManifestSyncManager(
    private val context: Context,
    private val database: PlayerDatabase,
    private val api: TilecastApi,
    private var cacheLimitBytes: Long = 8L * 1024 * 1024 * 1024,
    private var minimumFreeBytes: Long = 1024L * 1024 * 1024,
    private var automaticVideoThresholdBytes: Long = 256L * 1024 * 1024,
    private var concurrentDownloads: Int = 2,
) {
	private var activeCacheVerified = false
	fun applyPolicy(maximumBytes:Long,minimumFree:Long,automaticThreshold:Long,downloads:Int){cacheLimitBytes=maximumBytes;minimumFreeBytes=minimumFree;automaticVideoThresholdBytes=automaticThreshold;concurrentDownloads=downloads}
	fun invalidateActiveCacheVerification() { activeCacheVerified = false }
	suspend fun clear() {
		database.withTransaction {
			database.manifests().clear()
			database.cachedAssets().clear()
		}
		mediaDirectory().listFiles()?.forEach { it.delete() }
		activeCacheVerified = false
	}
    suspend fun loadActive(): PreparedContent? {
        val stored = database.manifests().active() ?: run { activeCacheVerified = false; return null }
        val manifest = runCatching { api.decodeManifest(stored.rawJson) }.getOrNull() ?: run { activeCacheVerified = false; return null }
        if (manifest.schemaVersion !in setOf(11,12,13,14)) { activeCacheVerified = false; return null }
        val validation = withContext(Dispatchers.IO) {
            validateActiveCache(database.cachedAssets().all())
        }
        if (!validation.complete) { activeCacheVerified = false; return null }
        activeCacheVerified = true
        return PreparedContent(manifest, validation.localFiles)
    }

    suspend fun reconcile(serverUrl: String, credential: String, screenId: String, progress: (SyncProgress) -> Unit): PreparedContent? {
        val current = database.manifests().active()
        val response = api.manifest(serverUrl, credential, manifestEtagForRequest(activeCacheVerified,current?.etag))
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
            val missingBytes=required.sumOf{asset->val record=database.cachedAssets().get(asset.variantId);if(record?.downloadStatus=="ready"&&isValidCachedFile(File(record.localPath),asset.fileSize,asset.sha256))0L else asset.fileSize}
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
        } catch (error: CancellationException) {
            throw error
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
		activeCacheVerified = true
    }

	private fun selectDownloads(manifest: PlayerManifest): List<ManifestAsset> {
		val media=mediaDirectory()
		return selectManifestDownloads(manifest,media.walkTopDown().filter{it.isFile}.sumOf{it.length()},media.usableSpace,cacheLimitBytes,minimumFreeBytes,automaticVideoThresholdBytes)
    }

    private suspend fun downloadIfNeeded(serverUrl: String, credential: String, asset: ManifestAsset, progress: (Long) -> Unit) {
        val final = finalFile(asset)
        val existing = database.cachedAssets().get(asset.variantId)
        if (existing?.downloadStatus == "ready" && isValidCachedFile(final,asset.fileSize,asset.sha256)) return
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
            } catch (error: CancellationException) {
                throw error
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
	    suspend fun clearUnprotectedCache():Boolean=try{cleanupUnneeded();true}catch(error:CancellationException){throw error}catch(_:Exception){false}
    private fun ensureSpace(requiredBytes: Long) {
        val media = mediaDirectory(); val used = media.walkTopDown().filter { it.isFile }.sumOf { it.length() }
        val cacheAvailable = (cacheLimitBytes - used).coerceAtLeast(0)
        val diskAvailable = (media.usableSpace - minimumFreeBytes).coerceAtLeast(0)
        require(requiredBytes <= minOf(cacheAvailable, diskAvailable)) { "Insufficient storage to prepare this manifest" }
    }
    private fun mediaDirectory() = File(context.filesDir, "media-cache").apply { mkdirs() }
	private fun isValidCachedFile(file:File,size:Long,sha256:String)=runCatching{ContentPolicy.verify(file,size,sha256)}.getOrDefault(false)
	private fun cacheUsed()=mediaDirectory().walkTopDown().filter{it.isFile}.sumOf{it.length()}
    private fun finalFile(asset: ManifestAsset) = File(mediaDirectory(), "${asset.variantId}.${extension(asset.mimeType)}")
    private fun extension(mime: String) = when (mime) { "video/mp4" -> "mp4"; "image/png" -> "png"; "image/webp" -> "webp"; "image/gif" -> "gif"; else -> "jpg" }
	private fun validateManifest(manifest: PlayerManifest, screenId: String) {
		require(manifest.schemaVersion in setOf(11,12,13,14) && manifest.mode in setOf("single-zone", "presentation") && manifest.screenId == screenId) { "Manifest validation failed" }
		val assets = manifest.assets.associateBy { it.variantId }
		val websites = manifest.websites.associateBy { it.assetId }
		val widgets = manifest.widgets.associateBy { it.assetId }
		val dataSources = manifest.dataSources.associateBy { it.id }
		val playlists = manifest.playlists + listOfNotNull(manifest.directFallbackPlaylist, manifest.playlist)
		val playlistIds = playlists.map { it.id }.toSet()
		val layoutIds = manifest.layouts.map { it.id }.toSet()
		require(manifest.schedules.all { schedule -> schedule.layoutId?.let(layoutIds::contains) ?: (schedule.playlistId?.let(playlistIds::contains) ?: false) } && manifest.effectiveTakeover?.playlistId?.let(playlistIds::contains) != false) { "Manifest references an unavailable presentation" }
		manifest.layouts.forEach { layout ->
			LayoutValidator.validate(layout.document)
			require(layout.document.placements.all { placement -> when (placement.type) { "widget" -> placement.widgetId?.let(widgets::containsKey) == true; "asset" -> manifest.assets.any { it.assetId == placement.assetId }; "playlistZone" -> placement.playlistId?.let(playlistIds::contains) == true; else -> true } }) { "Layout dependency is unavailable" }
			require(layout.document.placements.all { placement -> placement.primitive?.binding?.dataSourceId?.let(dataSources::containsKey) != false }) { "Layout binding Data Source is unavailable" }
		}
		require(manifest.layout?.id?.let(layoutIds::contains) != false && manifest.directFallbackLayout?.id?.let(layoutIds::contains) != false) { "Root Layout is unavailable" }
		playlists.flatMap { it.items }.forEach { item ->
			when (item.assetType) {
				"layout" -> require(item.layoutId?.let(layoutIds::contains) == true && (item.durationMs ?: 0) > 0 && item.deliveryPolicy == "stream") { "Layout item is invalid" }
				"website" -> require(websites[item.assetId] != null && (item.durationMs ?: 0) > 0 && item.deliveryPolicy == "stream") { "Website item is invalid" }
				"widget" -> require((if(manifest.schemaVersion>=13) widgets[item.assetId]?.presentation!=null else widgets[item.assetId]?.provider in setOf("website", "youtube", "clock", "date", "qrcode", "countdown", "ticker", "menu", "list", "table", "agenda", "metric", "cards", "weather")) && item.deliveryPolicy == "stream") { "Widget item is invalid" }
				else -> require(item.variantId != null && assets[item.variantId]?.assetId == item.assetId) { "Manifest item references an unavailable variant" }
			}
			require(item.fitMode in listOf("contain", "cover", "stretch") && item.transition in (if (manifest.schemaVersion >= 14) listOf("none", "fade", "crossfade") else listOf("none", "fade")) && item.deliveryPolicy in listOf("download", "stream", "automatic") && item.volume in 0f..1f) { "Manifest item settings are invalid" }
			val availableFrom = item.availableFrom?.let(Instant::parse)
			val expiresAt = item.expiresAt?.let(Instant::parse)
			require(availableFrom == null || expiresAt == null || availableFrom.isBefore(expiresAt)) { "Manifest item availability is invalid" }
			if (item.variantId?.let { assets[it]?.mimeType?.startsWith("image/") } == true) require((item.durationMs ?: 0) > 0) { "Image duration is invalid" }
			if (item.videoEndOffsetMs != null) require(item.videoEndOffsetMs > (item.videoStartOffsetMs ?: 0)) { "Video offsets are invalid" }
		}
		manifest.websites.forEach { site ->
			require(site.allowedHosts.isNotEmpty() && site.allowedHosts.size <= 25 && site.url.length <= 2048 && site.loadTimeoutSeconds in 1..120 && site.zoomPercent in 50..200) { "Website configuration is invalid" }
			site.fallbackVariantId?.let { require(assets[it]?.assetId == site.fallbackImageAssetId) { "Website fallback is invalid" } }
		}
		if(manifest.schemaVersion==11) manifest.dataSources.filter { it.provider == "calendar" }.forEach { source ->
			val config = Json.decodeFromJsonElement<CalendarSourceConfig>(source.configuration)
			require(config.displayMode in listOf("today", "upcoming", "this_week", "agenda") && config.maxEvents in 1..100 && config.emptyState.length <= 240 && config.data.events.size <= 2000) { "Calendar Data Source configuration is invalid" }
			java.time.ZoneId.of(config.timezone)
			config.data.events.forEach { event ->
				require(event.id.length <= 64 && event.title.length <= 300 && event.location.length <= 300 && event.descriptionExcerpt.length <= 500) { "Calendar event is invalid" }
				val start = Instant.parse(event.start)
				val end = Instant.parse(event.end)
				require(!end.isBefore(start)) { "Calendar event range is invalid" }
			}
		}
		if(manifest.schemaVersion==11) manifest.dataSources.filter { it.provider in setOf("rss", "atom", "json", "csv") }.forEach { source ->
			val config = Json.decodeFromJsonElement<StructuredSourceConfig>(source.configuration)
			require(config.emptyState.length <= 240 && config.data.records.size <= 200) { "Structured Data Source configuration is invalid" }
			if(config.dateSelection.enabled){require(config.dateSelection.mode in setOf("today","tomorrow","next_available","current_week","custom_range")&&config.dateSelection.noMatchBehavior in setOf("fallback_text","next_available","empty","hide","last_known_good"));java.time.ZoneId.of(config.dateSelection.timezone)}
			config.data.records.forEach { record ->
				require(record.id.length <= 64 && record.title.length <= 240 && record.subtitle.length <= 240 && record.description.length <= 500 && record.values.size <= 12) { "Structured Data Source record is invalid" }
			}
		}
		if(manifest.schemaVersion==12) manifest.dataSources.forEach { source ->
			val data=Json.decodeFromJsonElement<TypedRecordData>(source.configuration)
			require(data.fields.size<=20&&data.records.size<=2000&&data.fields.map{it.key}.toSet().size==data.fields.size)
			require(data.fields.all{it.type in setOf("text","number","integer","percent","currency","boolean","date","datetime","url")})
			require(data.records.all{it.id.length<=80&&it.values.size<=20&&it.values.values.all{value->value.length<=500}})
			data.dateSelection?.let{selection->require(selection.mode in setOf("today","tomorrow","next_available","current_week","custom_range"));java.time.ZoneId.of(selection.timezone)}
		}
		if(manifest.schemaVersion>=13){
			manifest.dataSources.forEach{source->validateDataDocument(source.dataDocument?:error("Data document is missing"))}
			manifest.widgets.forEach{widget->validatePresentation(widget.presentation?:error("Presentation is missing"),dataSources)}
			return
		}
		manifest.widgets.forEach { widget -> when(widget.provider){
			"clock"->{val config=Json.decodeFromJsonElement<ClockWidgetConfig>(widget.configuration);java.time.ZoneId.of(config.timezone);require(config.format in setOf("12","24"))}
			"date"->{val config=Json.decodeFromJsonElement<DateWidgetConfig>(widget.configuration);java.time.ZoneId.of(config.timezone);require(config.format in setOf("full","long","medium","short"))}
			"qrcode"->{val config=Json.decodeFromJsonElement<QRCodeWidgetConfig>(widget.configuration);require(config.value.isNotBlank()&&config.value.length<=2048)}
			"countdown"->{val config=Json.decodeFromJsonElement<CountdownWidgetConfig>(widget.configuration);java.time.ZoneId.of(config.timezone);require(config.mode in setOf("countdown","count_up"));require(config.recurrence in setOf("none","daily","weekly","monthly","yearly"));require(config.layout in setOf("stacked","horizontal","countdown_only"));require(config.mode=="countdown"||config.recurrence=="none")}
			"ticker"->{val config=Json.decodeFromJsonElement<TickerWidgetConfig>(widget.configuration);require(dataSources[config.dataSourceId]!=null&&(config.fields.ifEmpty{listOf(config.field)}).size in 1..3)}
			"menu", "table", "list", "agenda"->{val config=Json.decodeFromJsonElement<DisplayWidgetConfig>(widget.configuration);require(dataSources[config.dataSourceId]!=null&&config.fields.isNotEmpty()&&config.fields.size<=12&&config.maximumItems in 1..100)}
			"metric"->{val config=Json.decodeFromJsonElement<MetricWidgetConfig>(widget.configuration);require(dataSources[config.dataSourceId]!=null&&config.valueField.isNotBlank())}
			"cards"->{val config=Json.decodeFromJsonElement<CardsWidgetConfig>(widget.configuration);require(dataSources[config.dataSourceId]!=null&&config.titleField.isNotBlank()&&config.columns in 1..4&&config.maximumItems in 1..12)}
			"weather"->{val config=Json.decodeFromJsonElement<WeatherWidgetConfig>(widget.configuration);require(dataSources[config.dataSourceId]?.provider=="weather"&&config.forecastDays in 0..7)}
		}}
	}

	private fun validateDataDocument(document:org.tilecast.player.network.DataDocument){
		require(document.schemaVersion==1&&document.datasets.size<=16)
		document.datasets.forEach{dataset->
			require(dataset.id.length in 1..80&&dataset.kind in setOf("scalar","records","time_series","list","object"))
			require(dataset.fields.size<=16&&dataset.records.size<=2000&&dataset.points.size<=5000)
			require(dataset.fields.map{it.key}.toSet().size==dataset.fields.size)
			require(dataset.fields.all{it.type in setOf("text","number","integer","percent","currency","boolean","date","datetime","duration","url","asset","null")})
			dataset.records.forEach{record->require(record.id.length in 1..80&&record.values.size<=16);record.values.values.forEach{validateValue(it,0)}}
			dataset.scalar?.let{validateValue(it,0)};dataset.value?.let{validateValue(it,0)}
			dataset.points.forEach{point->Instant.parse(point.at);require((point.value!=null) xor point.values.isNotEmpty());point.value?.let{validateValue(it,0)};require(point.values.size<=16);point.values.values.forEach{validateValue(it,0)}}
			dataset.dateSelection?.let{selection->require(selection.field.length<=80&&selection.mode in setOf("today","tomorrow","next_available","current_week","custom_range"));java.time.ZoneId.of(selection.timezone)}
		}
	}

	private fun validateValue(value:org.tilecast.player.network.DocumentValue,depth:Int){
		require(depth<=6&&value.kind in setOf("text","number","integer","percent","currency","boolean","date","datetime","duration","url","asset","null","list","object"))
		value.text?.let{require(it.length<=4096)}
		value.date?.let{java.time.LocalDate.parse(it)}
		value.datetime?.let{Instant.parse(it)}
		value.url?.let{require(android.net.Uri.parse(it).scheme in setOf("http","https"))}
		require(value.list.size<=200&&value.objectValue.size<=64)
		value.list.forEach{validateValue(it,depth+1)};value.objectValue.values.forEach{validateValue(it,depth+1)}
	}

	private fun validatePresentation(presentation:org.tilecast.player.network.WidgetPresentation,dataSources:Map<String,org.tilecast.player.network.ManifestDataSource>){
		require(presentation.schemaVersion==1&&presentation.kind in setOf("native","web"))
		presentation.requiredCapabilities.forEach{(capability,version)->
			val supported=if(capability=="web.remote")PresentationCapabilities.webRuntimeVersion else PresentationCapabilities.native[capability]?:0
			require(supported>=version){"Missing presentation capability $capability@$version"}
		}
		if(presentation.kind=="native"){
			val root=presentation.native?.root?:error("Native root is missing")
			var nodes=0;var animations=0
			fun visit(value:org.tilecast.player.network.PresentationNode,depth:Int){
				require(depth<=24);nodes++;require(nodes<=500)
				require(value.type in setOf("surface","box","row","column","stack","grid","spacer","divider","text","icon","asset_image","badge","progress","qr_code","marquee","line_chart","bar_chart","donut_chart","repeat","conditional","grouped_sections"))
				value.binding?.let { binding ->
					require(binding.source in setOf("literal","dataset","repeat","repeat_index","environment"))
					require(binding.fields.size <= 16 && binding.value.length <= 4096 && binding.path.length <= 180)
					require(binding.selector in setOf("all","current","next","upcoming","current_or_next"))
					require(binding.startField.length <= 80 && binding.endField.length <= 80)
					// A temporal selector without its instants silently selects nothing, so an
					// incomplete selector is rejected before the manifest activates.
					require(binding.selector=="all"||binding.startField.isNotBlank())
					require(binding.selector!="current"||binding.endField.isNotBlank())
				}
				value.condition?.let { condition ->
					require(condition.op in setOf("equals","not_equals","empty","not_empty","greater_than","greater_or_equal","less_than","less_or_equal","before","after"))
				}
				if(value.type=="marquee")animations++
				value.repeat?.let{repeat->
					require(repeat.limit in 1..200&&repeat.offset in 0..2000&&repeat.dataset.substringBefore(':') in dataSources)
					require(repeat.selector in setOf("all","current","next","upcoming","current_or_next"))
					require(repeat.startField.length<=80&&repeat.endField.length<=80)
					require(repeat.selector=="all"||repeat.startField.isNotBlank())
					require(repeat.selector!="current"||repeat.endField.isNotBlank())
				}
				value.children.forEach{visit(it,depth+1)}
			}
			visit(root,0);require(animations<=4)
		}else{
			val web=presentation.web?:error("Web descriptor is missing")
			require(web.mode in setOf("remote","bundle")&&web.allowedHosts.size<=25&&web.loadTimeoutSeconds in 1..120&&web.warmSeconds in 0..300)
			if(web.mode=="remote")require(web.onlineOnly&&android.net.Uri.parse(web.url).scheme=="https")
			else require(web.packageSize in 1..PresentationCapabilities.webBundleLimitBytes&&Regex("^[0-9a-f]{64}$").matches(web.integritySha256))
		}
	}
}
