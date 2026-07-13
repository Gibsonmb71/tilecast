package org.tilecast.player.content

import android.annotation.SuppressLint
import android.graphics.BitmapFactory
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestSource
import org.tilecast.player.network.YouTubeSourceConfig

private class YouTubeBridge(private val callback: (String, String?) -> Unit) {
    @JavascriptInterface fun report(state: String, detail: String?) = callback(state, detail)
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun YouTubeSourceItem(
    item: ManifestItem,
    source: ManifestSource,
    config: YouTubeSourceConfig,
    session: PlaybackSession,
    onDone: () -> Unit,
    onFailure: (String) -> Unit,
    onStatus: (SourcePlaybackStatus) -> Unit,
) {
    var state by remember(item.id) { mutableStateOf("loading") }
    var error by remember(item.id) { mutableStateOf<String?>(null) }
    val report: (String, String?) -> Unit = { next, detail ->
        state = next
        error = detail
        onStatus(SourcePlaybackStatus(source.assetId, "youtube", next, detail))
        if (next == "ended" && item.durationMs == null && config.fixedDurationSeconds == null) onDone()
    }
    DisposableEffect(item.id) { onDispose { onStatus(SourcePlaybackStatus()) } }
    LaunchedEffect(item.id) {
        delay(config.loadTimeoutSeconds())
        if (state == "loading") report("autoplay_blocked", "youtube_autoplay_blocked")
    }
    val duration = item.durationMs ?: config.fixedDurationSeconds?.times(1000L)
    if (duration != null) LaunchedEffect(item.id, duration) { delay(duration); onDone() }
    if (error != null) {
        if (config.failureBehavior == "skip") {
            LaunchedEffect(error) { onFailure("YouTube source failed") }
            return
        }
        val fallback = config.fallbackVariantId?.let(session.content.localFiles::get)
        val bitmap = remember(fallback) { fallback?.let(BitmapFactory::decodeFile) }
        if (config.failureBehavior == "fallback_image" && bitmap != null) {
            Image(bitmap.asImageBitmap(), null, Modifier.fillMaxSize().background(Color.Black), contentScale = ContentScale.Fit)
            return
        }
        Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            Text("YouTube unavailable", color = Color.White)
        }
        return
    }
    val origin = session.serverUrl.trimEnd('/')
    val html = remember(item.id, source.configVersion) { youtubeHTML(config, origin) }
    AndroidView(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        factory = { context ->
            WebView(context).apply {
                setBackgroundColor(android.graphics.Color.BLACK)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                settings.cacheMode = WebSettings.LOAD_DEFAULT
                webChromeClient = WebChromeClient()
                webViewClient = WebViewClient()
                addJavascriptInterface(YouTubeBridge(report), "Tilecast")
                loadDataWithBaseURL("$origin/", html, "text/html", "UTF-8", null)
            }
        },
        update = {},
        onRelease = { view ->
            view.loadUrl("about:blank")
            view.removeJavascriptInterface("Tilecast")
            view.stopLoading()
            view.destroy()
        },
    )
}

private fun YouTubeSourceConfig.loadTimeoutSeconds() = 30_000L

internal fun youtubeHTML(config: YouTubeSourceConfig, origin: String): String {
    val id = if (config.kind == "playlist") config.playlistId.orEmpty() else config.videoId.orEmpty()
    val listOptions = if (config.kind == "playlist") "listType:'playlist',list:'$id'," else "videoId:'$id',"
    val loopPlaylist = if (config.loop && config.kind == "video") ",playlist:'$id'" else ""
    val captions = if (config.captions) "cc_load_policy:1,cc_lang_pref:'${config.captionLanguage}'," else "cc_load_policy:0,"
    val end = config.endSeconds?.let { "end:$it," }.orEmpty()
    return """<!doctype html><html><head><meta name="referrer" content="origin"><style>html,body,#player{margin:0;width:100%;height:100%;overflow:hidden;background:#000}</style></head><body><div id="player"></div><script src="https://www.youtube.com/iframe_api"></script><script>
      var player; function send(s,d){try{Tilecast.report(s,d||null)}catch(e){}}
      function onYouTubeIframeAPIReady(){player=new YT.Player('player',{${listOptions}playerVars:{autoplay:1,playsinline:1,controls:${if (config.controls) 1 else 0},disablekb:1,fs:0,rel:0,start:${config.startSeconds},${end}loop:${if (config.loop) 1 else 0}$loopPlaylist,origin:'$origin',$captions},events:{onReady:function(e){${if (config.muted) "e.target.mute();" else "e.target.unMute();"}e.target.setVolume(${config.volume});e.target.playVideo();send('ready')},onStateChange:function(e){var m={0:'ended',1:'playing',2:'paused',3:'buffering',5:'ready'};send(m[e.data]||'waiting')},onError:function(e){send('player_error','youtube_'+e.data)}}});}
    </script></body></html>"""
}
