package org.tilecast.player.content

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import org.tilecast.player.activity.PlaybackActivityReporter
import org.tilecast.player.network.ManifestAsset
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestLayout
import org.tilecast.player.network.ManifestPlaylist
import java.time.Instant

@Composable
fun FullscreenLayoutPlayback(
    session: PlaybackSession,
    layout: ManifestLayout,
    onError: (String) -> Unit,
    onWebsiteStatus: (WebsitePlaybackStatus) -> Unit = {},
    onWidgetStatus: (WidgetPlaybackStatus) -> Unit = {},
    onProgress: () -> Unit = {},
    activityReporter: PlaybackActivityReporter? = null,
) {
    val document = layout.document
    val widgets = session.content.manifest.widgets.associateBy { it.assetId }
    // One cached Data Source dataset is shared by every text binding in the Layout.
    val structured = session.content.manifest.dataSources.mapNotNull { source ->
        source.toLayoutStructuredSource()?.let { source.id to it }
    }.toMap()
    // A Layout renders continuously and may contain no item that reports progress on its own
    // (primitives, text bindings); heartbeat while composed so the stall watchdog only fires
    // when rendering has genuinely stopped.
    LaunchedEffect(layout.id) { while (true) { onProgress(); kotlinx.coroutines.delay(15_000) } }
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(structured) {
        while (true) {
            now = Instant.now()
            kotlinx.coroutines.delay(30_000)
        }
    }
    val hiddenGroups = document.placements.filter {
        it.primitive?.kind == "group" && it.primitive.binding?.hideWhenEmpty == true
    }.filter { group ->
        val binding = group.primitive?.binding ?: return@filter false
        structured[binding.dataSourceId]?.let { resolveLayoutBinding(binding, it, now).isBlank() } ?: true
    }.map { it.id }.toSet()
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val sourceRatio = document.canvas.width.toFloat() / document.canvas.height
        val targetRatio = maxWidth.value / maxHeight.value
        val canvasWidth = if (targetRatio > sourceRatio) maxHeight * sourceRatio else maxWidth
        val canvasHeight = if (targetRatio > sourceRatio) maxHeight else maxWidth / sourceRatio
        val scaleX = canvasWidth.value / document.canvas.width
        val scaleY = canvasHeight.value / document.canvas.height
        Box(Modifier.size(canvasWidth, canvasHeight).background(layoutColor(document.canvas.backgroundColor))) {
            document.placements.filter {
                it.visible &&
                    it.primitive?.kind != "group" &&
                    (it.groupId == null || it.groupId !in hiddenGroups)
            }.sortedBy { it.layer }.forEach { placement ->
                if (placement.type == "primitive") {
                    placement.primitive?.binding?.dataSourceId?.let { dataSourceId ->
                        session.content.manifest.dataSources.firstOrNull { it.id == dataSourceId }?.let { dataSource ->
                            LayoutBindingActivity(activityReporter, placement.id, dataSource)
                        }
                    }
                    LayoutPrimitiveCanvas(
                        document = document,
                        modifier = Modifier.fillMaxSize().zIndex(placement.layer.toFloat()),
                        structuredSources = structured,
                        placementIds = setOf(placement.id),
                        drawBackground = false,
                    )
                    return@forEach
                }
                val modifier = Modifier
                    .offset((placement.x * scaleX).dp, (placement.y * scaleY).dp)
                    .size((placement.width * scaleX).dp, (placement.height * scaleY).dp)
                    .zIndex(placement.layer.toFloat())
                    .alpha(placement.opacity)
                    .clip(RoundedCornerShape((placement.playback?.cornerRadius ?: 0f).dp))
                Box(modifier) {
                    when (placement.type) {
                        "playlistZone" -> session.content.manifest.playlists.firstOrNull { it.id == placement.playlistId }?.let { playlist ->
                            PlaylistZone(session, playlist, placement.id, placement.playback?.muted ?: true, onError, onWebsiteStatus, onWidgetStatus, onProgress, activityReporter)
                        }
                        "widget" -> widgets[placement.widgetId]?.let { widget ->
                            val item = ManifestItem("layout-${placement.id}", widget.assetId, assetType = "widget", durationMs = Long.MAX_VALUE, fitMode = placement.playback?.fit ?: "contain", transition = "none", audioEnabled = !(placement.playback?.muted ?: true), volume = 1f, deliveryPolicy = "stream")
                            RenderedItem(item, null, session.content.manifest.websites.firstOrNull { it.assetId == widget.assetId }, widget, session, 0, {}, onError, onWebsiteStatus, onWidgetStatus, onProgress, activityReporter, placement.id)
                        }
                        "asset" -> session.content.manifest.assets.firstOrNull { it.assetId == placement.assetId }?.let { asset ->
                            val item = ManifestItem("layout-${placement.id}", asset.assetId, asset.variantId, if (asset.mimeType.startsWith("video/")) "video" else "image", if (asset.mimeType.startsWith("image/")) Long.MAX_VALUE else null, placement.playback?.fit ?: "contain", "none", !(placement.playback?.muted ?: true), 1f, deliveryPolicy = "download")
                            LayoutAssetItem(session, item, asset, placement.id, onError, onWebsiteStatus, onWidgetStatus, onProgress, activityReporter)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlaylistZone(
    session: PlaybackSession,
    playlist: ManifestPlaylist,
    placementId: String,
    muted: Boolean,
    onError: (String) -> Unit,
    onWebsiteStatus: (WebsitePlaybackStatus) -> Unit,
    onWidgetStatus: (WidgetPlaybackStatus) -> Unit,
    onProgress: () -> Unit,
    activityReporter: PlaybackActivityReporter?,
) {
    if (playlist.items.isEmpty()) return
    val syncGroup = session.content.manifest.syncGroup
    val synchronizedTimeline = remember(
        playlist.id,
        playlist.revision,
        syncGroup?.playbackEpoch,
        session.startedAtElapsedRealtimeMs,
    ) {
        syncGroup?.playbackEpoch?.let { value -> runCatching { Instant.parse(value) }.getOrNull() }?.let { anchor ->
            SynchronizedPlaybackTimeline.fromAnchor(
                playlist = playlist,
                assets = session.content.manifest.assets,
                anchor = anchor,
                serverClockOffsetSeconds = session.content.serverClockOffsetSeconds,
                startedAtElapsedRealtimeMs = session.startedAtElapsedRealtimeMs,
                startedAtWallClock = session.startedAtWallClock,
            )
        }
    }
    var cursor by remember(playlist.id, playlist.revision) { mutableStateOf(PlaybackCursor(0, 0)) }
    var synchronizedOffsetMs by remember(playlist.id, playlist.revision) { mutableStateOf(0L) }
    LaunchedEffect(synchronizedTimeline) {
        val timeline = synchronizedTimeline ?: return@LaunchedEffect
        while (true) {
            val expected = timeline.positionAt(SystemClock.elapsedRealtime())
            if (cursor != expected.cursor) cursor = expected.cursor
            if (synchronizedOffsetMs != expected.offsetMs) synchronizedOffsetMs = expected.offsetMs
            kotlinx.coroutines.delay(100)
        }
    }
    val sourceItem = playlist.items[cursor.index.coerceIn(0, playlist.items.lastIndex)]
    val item = if (muted) sourceItem.copy(audioEnabled = false, volume = 0f) else sourceItem
    val asset = item.variantId?.let { id -> session.content.manifest.assets.firstOrNull { it.variantId == id } }
    val website = session.content.manifest.websites.firstOrNull { it.assetId == item.assetId }
    val widget = session.content.manifest.widgets.firstOrNull { it.assetId == item.assetId }
    fun advance() {
        if (synchronizedTimeline == null) cursor = nextPlaybackCursor(cursor, playlist.items.size)
    }
    key(item.id, cursor.cycle) {
        RenderedItem(
            item,
            asset,
            website,
            widget,
            session,
            if (synchronizedTimeline != null) synchronizedOffsetMs else 0,
            { advance() },
            { onError(it); advance() },
            onWebsiteStatus,
            onWidgetStatus,
            onProgress,
            activityReporter,
            placementId,
            synchronizedPositionMs = synchronizedOffsetMs.takeIf { synchronizedTimeline != null },
        )
    }
}

@Composable
private fun LayoutAssetItem(
    session: PlaybackSession,
    item: ManifestItem,
    asset: ManifestAsset,
    placementId: String,
    onError: (String) -> Unit,
    onWebsiteStatus: (WebsitePlaybackStatus) -> Unit,
    onWidgetStatus: (WidgetPlaybackStatus) -> Unit,
    onProgress: () -> Unit,
    activityReporter: PlaybackActivityReporter?,
) {
    val syncGroup = session.content.manifest.syncGroup
    if (!asset.mimeType.startsWith("video/") || syncGroup == null) {
        RenderedItem(item, asset, null, null, session, 0, {}, onError, onWebsiteStatus, onWidgetStatus, onProgress, activityReporter, placementId)
        return
    }
    val playlist = remember(item.id, asset.variantId) {
        ManifestPlaylist("layout-asset-$placementId", 1, "Layout asset", listOf(item))
    }
    val synchronizedTimeline = remember(
        playlist.id,
        syncGroup.playbackEpoch,
        session.startedAtElapsedRealtimeMs,
    ) {
        runCatching { Instant.parse(syncGroup.playbackEpoch) }.getOrNull()?.let { anchor ->
            SynchronizedPlaybackTimeline.fromAnchor(
                playlist = playlist,
                assets = session.content.manifest.assets,
                anchor = anchor,
                serverClockOffsetSeconds = session.content.serverClockOffsetSeconds,
                startedAtElapsedRealtimeMs = session.startedAtElapsedRealtimeMs,
                startedAtWallClock = session.startedAtWallClock,
            )
        }
    }
    if (synchronizedTimeline == null) {
        RenderedItem(item, asset, null, null, session, 0, {}, onError, onWebsiteStatus, onWidgetStatus, onProgress, activityReporter, placementId)
        return
    }
    var cursor by remember(playlist.id) { mutableStateOf(PlaybackCursor(0, 0)) }
    var synchronizedOffsetMs by remember(playlist.id) { mutableStateOf(0L) }
    LaunchedEffect(synchronizedTimeline) {
        while (true) {
            val expected = synchronizedTimeline.positionAt(SystemClock.elapsedRealtime())
            if (cursor != expected.cursor) cursor = expected.cursor
            if (synchronizedOffsetMs != expected.offsetMs) synchronizedOffsetMs = expected.offsetMs
            kotlinx.coroutines.delay(100)
        }
    }
    key(item.id, cursor.cycle) {
        RenderedItem(
            item,
            asset,
            null,
            null,
            session,
            synchronizedOffsetMs,
            {},
            onError,
            onWebsiteStatus,
            onWidgetStatus,
            onProgress,
            activityReporter,
            placementId,
            synchronizedPositionMs = synchronizedOffsetMs,
        )
    }
}

@Composable
private fun LayoutBindingActivity(
    activityReporter: PlaybackActivityReporter?,
    placementId: String,
    dataSource: org.tilecast.player.network.ManifestDataSource,
) {
    val item = remember(placementId, dataSource.id) {
        ManifestItem(
            id = "layout-$placementId",
            assetId = dataSource.id,
            assetType = "dataSource",
            durationMs = Long.MAX_VALUE,
            fitMode = "contain",
            transition = "none",
            audioEnabled = false,
            volume = 0f,
            deliveryPolicy = "stream",
        )
    }
    rememberActivityChild(activityReporter, item, null, placementId, emptyList(), dataSource)
}
