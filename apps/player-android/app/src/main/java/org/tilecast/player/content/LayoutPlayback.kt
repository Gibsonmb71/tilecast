package org.tilecast.player.content

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.zIndex
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestLayout
import org.tilecast.player.network.ManifestPlaylist
import org.tilecast.player.network.StructuredSourceConfig
import java.time.Instant

@Composable
fun FullscreenLayoutPlayback(
    session: PlaybackSession,
    layout: ManifestLayout,
    onError: (String) -> Unit,
    onWebsiteStatus: (WebsitePlaybackStatus) -> Unit = {},
    onWidgetStatus: (WidgetPlaybackStatus) -> Unit = {},
    onProgress: () -> Unit = {},
) {
    val document = layout.document
    val widgets = session.content.manifest.widgets.associateBy { it.assetId }
    // One cached Data Source dataset is shared by every text binding in the Layout.
    val structured = session.content.manifest.dataSources.filter { it.provider == "csv" || it.provider == "json" }.mapNotNull { source ->
        runCatching { source.id to Json.decodeFromJsonElement<StructuredSourceConfig>(source.configuration) }.getOrNull()
    }.toMap()
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
                            IndependentPlaylistZone(session, playlist, placement.playback?.muted ?: true, onError, onWebsiteStatus, onWidgetStatus, onProgress)
                        }
                        "widget" -> widgets[placement.widgetId]?.let { widget ->
                            val item = ManifestItem("layout-${placement.id}", widget.assetId, assetType = "widget", durationMs = Long.MAX_VALUE, fitMode = placement.playback?.fit ?: "contain", transition = "none", audioEnabled = !(placement.playback?.muted ?: true), volume = 1f, deliveryPolicy = "stream")
                            RenderedItem(item, null, session.content.manifest.websites.firstOrNull { it.assetId == widget.assetId }, widget, session, 0, {}, onError, onWebsiteStatus, onWidgetStatus, onProgress)
                        }
                        "asset" -> session.content.manifest.assets.firstOrNull { it.assetId == placement.assetId }?.let { asset ->
                            val item = ManifestItem("layout-${placement.id}", asset.assetId, asset.variantId, if (asset.mimeType.startsWith("video/")) "video" else "image", if (asset.mimeType.startsWith("image/")) Long.MAX_VALUE else null, placement.playback?.fit ?: "contain", "none", !(placement.playback?.muted ?: true), 1f, deliveryPolicy = "download")
                            RenderedItem(item, asset, null, null, session, 0, {}, onError, onWebsiteStatus, onWidgetStatus, onProgress)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun IndependentPlaylistZone(session: PlaybackSession, playlist: ManifestPlaylist, muted: Boolean, onError: (String) -> Unit, onWebsiteStatus: (WebsitePlaybackStatus) -> Unit, onWidgetStatus: (WidgetPlaybackStatus) -> Unit, onProgress: () -> Unit) {
    if (playlist.items.isEmpty()) return
    var index by remember(playlist.id, playlist.revision) { mutableIntStateOf(0) }
    val sourceItem = playlist.items[index.coerceIn(0, playlist.items.lastIndex)]
    val item = if (muted) sourceItem.copy(audioEnabled = false, volume = 0f) else sourceItem
    val asset = item.variantId?.let { id -> session.content.manifest.assets.firstOrNull { it.variantId == id } }
    val website = session.content.manifest.websites.firstOrNull { it.assetId == item.assetId }
    val widget = session.content.manifest.widgets.firstOrNull { it.assetId == item.assetId }
    RenderedItem(item, asset, website, widget, session, 0, { index = (index + 1) % playlist.items.size }, { onError(it); index = (index + 1) % playlist.items.size }, onWebsiteStatus, onWidgetStatus, onProgress)
}
