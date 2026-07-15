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
import org.tilecast.player.activity.PlaybackActivityReporter
import org.tilecast.player.network.CalendarSourceConfig
import org.tilecast.player.network.ClockAppConfig
import org.tilecast.player.network.DateAppConfig
import org.tilecast.player.network.ManifestAsset
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestPlaylist
import org.tilecast.player.network.ManifestSource
import org.tilecast.player.network.ManifestWebsite
import org.tilecast.player.network.QRCodeAppConfig
import org.tilecast.player.network.StructuredSourceConfig
import org.tilecast.player.network.TickerAppConfig
import org.tilecast.player.network.WebsiteSourceConfig
import org.tilecast.player.network.YouTubeSourceConfig
import org.tilecast.player.ui.theme.SignalBackground
import org.tilecast.player.ui.theme.SignalText
import java.io.File
import java.time.Duration
import java.time.Instant

data class PlaybackSession(val content: PreparedContent, val serverUrl: String, val credential: String,val initialCursor:PlaybackCursor=PlaybackCursor(0,0),val initialOffsetMs:Long=0)
data class PlaybackCursor(val index: Int, val cycle: Int)
internal data class SynchronizedPlaybackStart(val cursor:PlaybackCursor,val offsetMs:Long)
internal fun nextPlaybackCursor(cursor: PlaybackCursor, itemCount: Int) = PlaybackCursor((cursor.index + 1) % itemCount, cursor.cycle + 1)

internal fun synchronizedPlaybackStart(playlist:ManifestPlaylist,assets:List<ManifestAsset>,anchor:Instant,now:Instant):SynchronizedPlaybackStart {
    if(playlist.items.isEmpty()||!now.isAfter(anchor))return SynchronizedPlaybackStart(PlaybackCursor(0,0),0)
    val durations=playlist.items.map{item->effectiveDurationMs(item,assets)}
    val cycleDuration=durations.sum().coerceAtLeast(1)
    var elapsed=Duration.between(anchor,now).toMillis().coerceAtLeast(0)%cycleDuration
    var index=0
    while(index<durations.lastIndex&&elapsed>=durations[index]){elapsed-=durations[index];index++}
    return SynchronizedPlaybackStart(PlaybackCursor(index,0),elapsed)
}

internal fun effectiveDurationMs(item:ManifestItem,assets:List<ManifestAsset>):Long {
    item.durationMs?.let{return it.coerceAtLeast(1)}
    if(item.assetType=="website"||item.assetType=="source")return 30_000
    val asset=item.variantId?.let{variant->assets.firstOrNull{it.variantId==variant}}
    if(asset?.mimeType?.startsWith("video/")==true){val start=item.videoStartOffsetMs?:0;val end=item.videoEndOffsetMs?:asset.durationSeconds?.times(1000)?.toLong();if(end!=null)return (end-start).coerceAtLeast(1)}
    return 10_000
}

@Composable fun FullscreenPlayback(session: PlaybackSession, onBoundary: (String, String) -> Unit, onError: (String) -> Unit,onWebsiteStatus:(WebsitePlaybackStatus)->Unit={},onSourceStatus:(SourcePlaybackStatus)->Unit={},onProgress:()->Unit={}) {
    val activityReporter=rememberPlaybackActivityReporter(session)
    session.content.manifest.layout?.let { layout -> FullscreenLayoutPlayback(session, layout, onError, onWebsiteStatus, onSourceStatus, onProgress,activityReporter); return }
    val playlist = session.content.manifest.playlist
    if (playlist == null || playlist.items.isEmpty()) { EmptyPlayback("No content assigned"); return }
    var cursor by remember(session.content.manifest.manifestVersion) { mutableStateOf(session.initialCursor) }
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
        RenderedItem(renderedItem,renderedAsset,renderedWebsite,renderedSource,session,if(targetCursor==session.initialCursor)session.initialOffsetMs else 0,{advance()},{onError(it);advance(true)},onWebsiteStatus,onSourceStatus,onProgress,activityReporter)
    } else key(item.id,cursor.cycle){RenderedItem(item,asset,website,source,session,if(cursor==session.initialCursor)session.initialOffsetMs else 0,{advance()},{onError(it);advance(true)},onWebsiteStatus,onSourceStatus,onProgress,activityReporter)}
}

@Composable internal fun RenderedItem(item:ManifestItem,asset:ManifestAsset?,website:ManifestWebsite?,source:ManifestSource?,session:PlaybackSession,startOffsetMs:Long,onDone:()->Unit,onFailure:(String)->Unit,onWebsiteStatus:(WebsitePlaybackStatus)->Unit,onSourceStatus:(SourcePlaybackStatus)->Unit,onProgress:()->Unit,activityReporter:PlaybackActivityReporter?=null,layoutPlacementId:String=""){
    val tracker=rememberActivityChild(activityReporter,item,source,layoutPlacementId,session.content.manifest.sources)
    val done={tracker?.complete();onDone()}
    val failed: (String) -> Unit = { message -> tracker?.fail(message); onFailure(message) }
    if(source?.provider=="website"){
        val config=runCatching{Json.decodeFromJsonElement<WebsiteSourceConfig>(source.configuration)}.getOrElse{failed("Website source configuration is invalid");return}
        WebsiteItem(item,ManifestWebsite(source.assetId,source.name,config.url,config.allowedHosts,config.javascriptEnabled,config.domStorageEnabled,config.cookiePolicy,config.reloadPolicy,config.refreshIntervalSeconds,config.loadTimeoutSeconds,config.zoomPercent,config.scrollX,config.scrollY,config.customUserAgent,config.backgroundColor,config.failureBehavior,config.fallbackImageAssetId,config.fallbackVariantId),session,done,startOffsetMs){status->onWebsiteStatus(status);onSourceStatus(SourcePlaybackStatus(source.assetId,"website",status.state,status.failureCategory))}
    } else if(source?.provider=="youtube"){
        val config=runCatching{Json.decodeFromJsonElement<YouTubeSourceConfig>(source.configuration)}.getOrElse{failed("YouTube source configuration is invalid");return}
        YouTubeSourceItem(item,source,config,session,done,failed,onSourceStatus,startOffsetMs)
    } else if(source?.provider=="calendar"){
        val config=runCatching{Json.decodeFromJsonElement<CalendarSourceConfig>(source.configuration)}.getOrElse{failed("Calendar source configuration is invalid");return}
        CalendarSourceItem(item,source,config,done,onSourceStatus,startOffsetMs)
    } else if(source?.provider in setOf("rss","atom","json","csv")){
        val structuredSource=source ?: return
        val config=runCatching{Json.decodeFromJsonElement<StructuredSourceConfig>(structuredSource.configuration)}.getOrElse{failed("Structured source configuration is invalid");return}
        StructuredSourceItem(item,structuredSource,config,done,onSourceStatus,startOffsetMs)
    } else if(source?.provider in setOf("clock","date","qrcode","ticker","menu","list","table","agenda")){
        NativeAppItem(item,source ?: return,session,done,failed,onSourceStatus,startOffsetMs)
    } else if(website!=null) WebsiteItem(item,website,session,done,startOffsetMs,onWebsiteStatus)
    else if(asset?.mimeType?.startsWith("image/")==true)ImageItem(item,asset,session,startOffsetMs,done,failed,onProgress)
    else if(asset!=null)VideoItem(item,asset,session,startOffsetMs,done,failed,onProgress)
}

@Composable private fun EmptyPlayback(message: String) { Box(Modifier.fillMaxSize().background(SignalBackground), contentAlignment = Alignment.Center) { androidx.compose.material3.Text(message, color = SignalText) } }
