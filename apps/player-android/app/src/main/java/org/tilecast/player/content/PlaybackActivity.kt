package org.tilecast.player.content

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import org.tilecast.player.activity.PlaybackActivityReporter
import org.tilecast.player.activity.PlayerActivityQueue
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestSource
import org.tilecast.player.network.DisplayAppConfig
import org.tilecast.player.network.TickerAppConfig
import org.tilecast.player.network.StructuredSourceConfig
import java.security.MessageDigest
import java.time.LocalDate

private val activityFlushScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

@Composable
internal fun rememberPlaybackActivityReporter(session: PlaybackSession): PlaybackActivityReporter {
    val context = LocalContext.current
    val manifest = session.content.manifest
    val presentationType = if (manifest.layout != null) "layout" else "playlist"
    val presentationId = manifest.layout?.id ?: manifest.playlist?.id.orEmpty()
    val presentationRevision = manifest.layout?.revision?.toString() ?: manifest.playlist?.revision?.toString().orEmpty()
    val reporter = remember(manifest.manifestVersion, presentationId, presentationRevision) {
        PlaybackActivityReporter(
            queue = PlayerActivityQueue.get(context),
            manifestVersion = manifest.manifestVersion,
            presentationType = presentationType,
            presentationId = presentationId,
            presentationRevision = presentationRevision,
            trigger = when {
                manifest.emergency != null -> "emergency"
                manifest.schedules.isNotEmpty() -> "schedule"
                else -> "direct_assignment"
            },
            scheduleId = manifest.schedules.firstOrNull()?.id.orEmpty(),
            emergencyId = manifest.emergency?.id.orEmpty(),
        )
    }
    LaunchedEffect(reporter) {
        while (true) {
            PlayerActivityQueue.get(context).flushConfigured()
            delay(30_000)
        }
    }
    DisposableEffect(reporter) {
        reporter.presentationStarted()
        activityFlushScope.launch { PlayerActivityQueue.get(context).flushConfigured() }
        onDispose {
            reporter.presentationStopped("partial")
            activityFlushScope.launch { PlayerActivityQueue.get(context).flushConfigured() }
        }
    }
    return reporter
}

internal data class DateAwareAttribution(
    val sourceId: String = "",
    val selectedRecordId: String = "",
    val sourceCachedAt: String? = null,
    val sourceRevision: String = "",
    val snapshotHash: String = "",
)

@Composable
internal fun rememberActivityChild(
    reporter: PlaybackActivityReporter?,
    item: ManifestItem,
    source: ManifestSource?,
    layoutPlacementId: String,
    allSources: List<ManifestSource>,
): ActivityChildTracker? {
    if (reporter == null) return null
    val attribution = remember(source?.assetId, source?.configuration, allSources) { dateAwareAttribution(source, allSources) }
    val contentType = when {
        source != null -> "widget"
        item.assetType == "source" || item.assetType == "website" -> "widget"
        else -> "media"
    }
    val tracker = remember(item.id, item.assetId, layoutPlacementId, reporter) {
        val session = reporter.childStarted(
            contentType = contentType,
            contentId = item.assetId,
            playlistItemId = if (layoutPlacementId.isEmpty()) item.id else item.id.takeUnless { it.startsWith("layout-") }.orEmpty(),
            layoutPlacementId = layoutPlacementId,
            expectedDurationMs = item.durationMs?.takeUnless { it == Long.MAX_VALUE },
            sourceId = attribution.sourceId,
            selectedRecordId = attribution.selectedRecordId,
            sourceCachedAt = attribution.sourceCachedAt,
            sourceRevision = attribution.sourceRevision,
            snapshotHash = attribution.snapshotHash,
        )
        ActivityChildTracker(session)
    }
    DisposableEffect(tracker) {
        onDispose { tracker.finishIfNeeded("completed") }
    }
    return tracker
}

internal class ActivityChildTracker(
    private val session: PlaybackActivityReporter.ChildSession,
) {
    private var finished = false
    private val startedElapsed = SystemClock.elapsedRealtime()

    fun complete() = finishIfNeeded("completed")
    fun skip() = finishIfNeeded("skipped")
    fun fail(message: String) = finishIfNeeded("failed", "renderer_failure", message)

    fun finishIfNeeded(result: String, code: String = "", message: String = "") {
        if (finished) return
        finished = true
        session.finish(result, code, message)
    }

    fun elapsedMs(): Long = SystemClock.elapsedRealtime() - startedElapsed
}

private fun dateAwareAttribution(source: ManifestSource?, allSources: List<ManifestSource>): DateAwareAttribution {
    if (source == null) return DateAwareAttribution()
    val attributedSource = when (source.provider) {
        "menu", "list", "table", "agenda" -> runCatching {
            Json.decodeFromJsonElement<DisplayAppConfig>(source.configuration).sourceAssetId
        }.getOrNull()?.let { id -> allSources.firstOrNull { it.assetId == id } }
        "ticker" -> runCatching {
            Json.decodeFromJsonElement<TickerAppConfig>(source.configuration).sourceAssetId
        }.getOrNull()?.let { id -> allSources.firstOrNull { it.assetId == id } }
        else -> source
    } ?: return DateAwareAttribution(sourceId = source.assetId)
    if (attributedSource.provider !in setOf("rss", "atom", "json", "csv")) {
        return DateAwareAttribution(sourceId = attributedSource.assetId)
    }
    val configuration = runCatching {
        Json.decodeFromJsonElement<StructuredSourceConfig>(attributedSource.configuration)
    }.getOrNull() ?: return DateAwareAttribution(sourceId = attributedSource.assetId)
    val today = LocalDate.now().toString()
    val selected = if (configuration.dateSelection.enabled) {
        configuration.data.records.firstOrNull { it.date.startsWith(today) }
            ?: configuration.data.records.firstOrNull()
    } else {
        configuration.data.records.firstOrNull()
    }
    val seed = listOf(
        attributedSource.assetId,
        selected?.id.orEmpty(),
        today,
        configuration.data.cachedAt.orEmpty(),
    ).joinToString("|")
    val hash = MessageDigest.getInstance("SHA-256")
        .digest(seed.toByteArray())
        .joinToString("") { "%02x".format(it) }
    return DateAwareAttribution(
        sourceId = attributedSource.assetId,
        selectedRecordId = selected?.id.orEmpty(),
        sourceCachedAt = configuration.data.cachedAt,
        sourceRevision = configuration.data.cachedAt.orEmpty(),
        snapshotHash = hash,
    )
}
