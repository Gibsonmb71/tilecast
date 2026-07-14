package org.tilecast.player.content

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import okhttp3.OkHttpClient
import okhttp3.Request
import org.tilecast.player.network.ManifestAsset
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestSource
import org.tilecast.player.network.ManifestWebsite
import org.tilecast.player.network.WebsiteSourceConfig
import org.tilecast.player.network.YouTubeSourceConfig
import org.tilecast.player.ui.theme.SignalBackground
import org.tilecast.player.ui.theme.SignalText
import java.io.File

data class PlaybackSession(val content: PreparedContent, val serverUrl: String, val credential: String)
internal data class PlaybackCursor(val index: Int, val cycle: Int)
internal fun nextPlaybackCursor(cursor: PlaybackCursor, itemCount: Int) =
    PlaybackCursor((cursor.index + 1) % itemCount, cursor.cycle + 1)

@Composable fun FullscreenPlayback(session: PlaybackSession, onBoundary: (String, String) -> Unit, onError: (String) -> Unit,onWebsiteStatus:(WebsitePlaybackStatus)->Unit={},onSourceStatus:(SourcePlaybackStatus)->Unit={},onProgress:()->Unit={}) {
    val playlist = session.content.manifest.playlist
    if (playlist == null || playlist.items.isEmpty()) { EmptyPlayback("No content assigned"); return }
    var cursor by remember(session.content.manifest.manifestVersion) { mutableStateOf(PlaybackCursor(0, 0)) }
    var consecutiveFailures by remember { mutableIntStateOf(0) }
	val item = playlist.items[cursor.index.coerceIn(0, playlist.items.lastIndex)]
	val website=session.content.manifest.websites.firstOrNull{it.assetId==item.assetId}
    val source=session.content.manifest.sources.firstOrNull{it.assetId==item.assetId}
    val asset = item.variantId?.let{variant->session.content.manifest.assets.firstOrNull { it.variantId == variant }}
	LaunchedEffect(item.id){onBoundary(item.id,item.assetId)}
    fun advance(failed: Boolean = false) {
        consecutiveFailures = if (failed) consecutiveFailures + 1 else 0
        cursor = nextPlaybackCursor(cursor, playlist.items.size)
    }
    if (asset == null&&website==null&&source==null) { LaunchedEffect(item.id) { onError("Manifest item has no asset"); delay(1_000); advance(true) }; return }
    if (consecutiveFailures >= playlist.items.size) { EmptyPlayback("No playable content"); LaunchedEffect(consecutiveFailures) { delay(5_000); consecutiveFailures = 0 } ; return }
	if(item.transition=="fade") Crossfade(cursor, label = "playlist-item") { targetCursor ->
		val renderedItem = playlist.items[targetCursor.index];val renderedAsset = renderedItem.variantId?.let{variant->session.content.manifest.assets.firstOrNull { it.variantId == variant }};val renderedWebsite=session.content.manifest.websites.firstOrNull{it.assetId==renderedItem.assetId};val renderedSource=session.content.manifest.sources.firstOrNull{it.assetId==renderedItem.assetId}
		RenderedItem(renderedItem,renderedAsset,renderedWebsite,renderedSource,session,{advance()},{onError(it);advance(true)},onWebsiteStatus,onSourceStatus,onProgress)
	} else key(item.id,cursor.cycle){RenderedItem(item,asset,website,source,session,{advance()},{onError(it);advance(true)},onWebsiteStatus,onSourceStatus,onProgress)}
}

@Composable private fun RenderedItem(item:ManifestItem,asset:ManifestAsset?,website:ManifestWebsite?,source:ManifestSource?,session:PlaybackSession,onDone:()->Unit,onFailure:(String)->Unit,onWebsiteStatus:(WebsitePlaybackStatus)->Unit,onSourceStatus:(SourcePlaybackStatus)->Unit,onProgress:()->Unit){
    if(source?.provider=="website"){
        val config=runCatching{Json.decodeFromJsonElement<WebsiteSourceConfig>(source.configuration)}.getOrElse{onFailure("Website source configuration is invalid");return}
        WebsiteItem(item,ManifestWebsite(source.assetId,source.name,config.url,config.allowedHosts,config.javascriptEnabled,config.domStorageEnabled,config.cookiePolicy,config.reloadPolicy,config.refreshIntervalSeconds,config.loadTimeoutSeconds,config.zoomPercent,config.scrollX,config.scrollY,config.customUserAgent,config.backgroundColor,config.failureBehavior,config.fallbackImageAssetId,config.fallbackVariantId),session,onDone){status->onWebsiteStatus(status);onSourceStatus(SourcePlaybackStatus(source.assetId,"website",status.state,status.failureCategory))}
    } else if(source?.provider=="youtube"){
        val config=runCatching{Json.decodeFromJsonElement<YouTubeSourceConfig>(source.configuration)}.getOrElse{onFailure("YouTube source configuration is invalid");return}
        YouTubeSourceItem(item,source,config,session,onDone,onFailure,onSourceStatus)
    } else if(website!=null) WebsiteItem(item,website,session,onDone,onWebsiteStatus)
    else if(asset?.mimeType?.startsWith("image/")==true)ImageItem(item,asset,session,onDone,onFailure,onProgress)
    else if(asset!=null)VideoItem(item,asset,session,onDone,onFailure,onProgress)
}

@Composable private fun EmptyPlayback(message: String) { Box(Modifier.fillMaxSize().background(SignalBackground), contentAlignment = Alignment.Center) { androidx.compose.material3.Text(message, color = SignalText) } }

@Composable private fun ImageItem(item: ManifestItem, asset: ManifestAsset, session: PlaybackSession, onDone: () -> Unit, onFailure: (String) -> Unit, onProgress: () -> Unit) {
	val variantId=item.variantId?:return
    var bitmap by remember(item.id) { mutableStateOf(session.content.localFiles[variantId]?.let { BitmapFactory.decodeFile(it) }) }
    LaunchedEffect(item.id) {
		if (bitmap == null) bitmap = runCatching { withContext(Dispatchers.IO) {
            session.content.localFiles[variantId]?.let { BitmapFactory.decodeFile(it) } ?: OkHttpClient().newCall(Request.Builder().url(session.serverUrl + asset.downloadPath).header("Authorization", "Bearer ${session.credential}").build()).execute().use { response -> if (!response.isSuccessful) error("Image stream unavailable"); BitmapFactory.decodeStream(response.body?.byteStream()) }
        } }.getOrElse { onFailure("Image could not be displayed"); return@LaunchedEffect }
        onProgress(); delay(item.durationMs ?: 10_000); onDone()
    }
    bitmap?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize().background(Color.Black), contentScale = scale(item.fitMode)) }
}

@OptIn(UnstableApi::class)
@Composable private fun VideoItem(item: ManifestItem, asset: ManifestAsset, session: PlaybackSession, onDone: () -> Unit, onFailure: (String) -> Unit, onProgress: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val player = remember(item.id) {
        val http = OkHttpDataSource.Factory(OkHttpClient()).setDefaultRequestProperties(mapOf("Authorization" to "Bearer ${session.credential}"))
        val source = DefaultMediaSourceFactory(DefaultDataSource.Factory(context, http))
        ExoPlayer.Builder(context).setMediaSourceFactory(source).build().apply {
            volume = if (item.audioEnabled) item.volume else 0f
            setMediaItem(MediaItem.fromUri(item.variantId?.let{session.content.localFiles[it]}?.let { Uri.fromFile(File(it)) } ?: Uri.parse(session.serverUrl + asset.downloadPath)))
            prepare(); seekTo(item.videoStartOffsetMs ?: 0); playWhenReady = true
        }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_ENDED) onDone() }
            override fun onPlayerError(error: PlaybackException) { onFailure("Video playback failed") }
        }; player.addListener(listener); onDispose { player.removeListener(listener); player.release() }
    }
    LaunchedEffect(player) {
        var previousPosition = -1L
        while (true) {
            delay(5_000)
            val position = player.currentPosition
            if (player.isPlaying && position > previousPosition) onProgress()
            previousPosition = position
        }
    }
    item.videoEndOffsetMs?.let { end -> LaunchedEffect(player, end) { while (true) { delay(250); if (player.currentPosition >= end) { player.pause(); onDone(); break } } } }
    AndroidView(factory = { PlayerView(it).apply { useController=false; this.player=player; resizeMode=resize(item.fitMode) } }, modifier=Modifier.fillMaxSize(), update={it.resizeMode=resize(item.fitMode)})
}
private fun scale(mode:String)=when(mode){"cover"->ContentScale.Crop;"stretch"->ContentScale.FillBounds;else->ContentScale.Fit}
@UnstableApi private fun resize(mode:String)=when(mode){"cover"->AspectRatioFrameLayout.RESIZE_MODE_ZOOM;"stretch"->AspectRatioFrameLayout.RESIZE_MODE_FILL;else->AspectRatioFrameLayout.RESIZE_MODE_FIT}
