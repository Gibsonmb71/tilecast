package org.tilecast.player.content

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.webkit.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestWebsite
import org.tilecast.player.ui.theme.SignalBackground
import java.io.File
import java.time.Instant

data class WebsitePlaybackStatus(val assetId:String?=null,val state:String="idle",val loadStartedAt:String?=null,val loadCompletedAt:String?=null,val failureCategory:String?=null,val blockedNavigationCount:Int=0,val currentHost:String?=null,val fallbackShown:Boolean=false,val rendererRecoveryCount:Int=0)

object WebsiteNavigationPolicy {
    fun allows(raw:String,site:ManifestWebsite):Boolean=runCatching{val uri=java.net.URI(raw);if(uri.userInfo!=null||uri.host.isNullOrBlank())return false;val original=java.net.URI(site.url);val scheme=uri.scheme?.lowercase();if(scheme!="https"&&!(scheme=="http"&&original.scheme=="http"))return false;val port=uri.port;if(port!=-1&&port!=if(scheme=="https")443 else 80)return false;site.allowedHosts.any{it.equals(uri.host?.trimEnd('.'),true)}}.getOrDefault(false)
}

object WebsiteDataManager {
    fun clear(context:Context,complete:(Boolean)->Unit){android.os.Handler(android.os.Looper.getMainLooper()).post{runCatching{CookieManager.getInstance().removeAllCookies{WebStorage.getInstance().deleteAllData();val web=WebView(context.applicationContext);web.clearCache(true);web.clearHistory();web.destroy();complete(true)}}.onFailure{complete(false)}}}
}

@SuppressLint("SetJavaScriptEnabled")
@Composable fun WebsiteItem(item:ManifestItem,site:ManifestWebsite,session:PlaybackSession,onDone:()->Unit,onStatus:(WebsitePlaybackStatus)->Unit){
    var failed by remember(item.id){mutableStateOf<String?>(null)};var loaded by remember(item.id){mutableStateOf(false)};var blocked by remember(item.id){mutableIntStateOf(0)};var rendererRecoveries by remember(item.id){mutableIntStateOf(0)};var activeWebView by remember(item.id){mutableStateOf<WebView?>(null)};val started=remember(item.id){Instant.now().toString()}
    fun report(state:String,category:String?=null,fallback:Boolean=false,host:String?=Uri.parse(site.url).host){onStatus(WebsitePlaybackStatus(site.assetId,state,started,if(state=="loaded")Instant.now().toString() else null,category,blocked,host,fallback,rendererRecoveries))}
    DisposableEffect(item.id){onDispose{onStatus(WebsitePlaybackStatus())}}
    LaunchedEffect(item.id){report("loading");delay(site.loadTimeoutSeconds*1000L);if(!loaded&&failed==null){failed="load_timeout";report("timed_out","load_timeout")}}
    LaunchedEffect(item.id,item.durationMs){delay(item.durationMs?:30_000);onDone()}
    if(failed!=null&&!loaded){if(site.failureBehavior=="skip"){LaunchedEffect(failed){onDone()};return};val fallbackPath=site.fallbackVariantId?.let{session.content.localFiles[it]};if(site.failureBehavior=="fallback_image"&&fallbackPath!=null){val bitmap=remember(fallbackPath){BitmapFactory.decodeFile(fallbackPath)};if(bitmap!=null){report("showing_fallback",failed,true);Image(bitmap.asImageBitmap(),null,Modifier.fillMaxSize().background(Color.Black),contentScale=when(item.fitMode){"cover"->ContentScale.Crop;"stretch"->ContentScale.FillBounds;else->ContentScale.Fit});return}};Box(Modifier.fillMaxSize().background(parseColor(site.backgroundColor)),contentAlignment=Alignment.Center){Text("Website unavailable",color=Color.White)};return}
    AndroidView(modifier=Modifier.fillMaxSize().background(parseColor(site.backgroundColor)),factory={context->WebView(context).apply{activeWebView=this
        setBackgroundColor(android.graphics.Color.parseColor(site.backgroundColor));isFocusable=false;isFocusableInTouchMode=false
        settings.javaScriptEnabled=site.javascriptEnabled;settings.domStorageEnabled=site.domStorageEnabled;settings.allowFileAccess=false;settings.allowContentAccess=false;settings.allowFileAccessFromFileURLs=false;settings.allowUniversalAccessFromFileURLs=false;settings.javaScriptCanOpenWindowsAutomatically=false;settings.setSupportMultipleWindows(false);settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW;settings.cacheMode=if(site.reloadPolicy=="load_once")WebSettings.LOAD_CACHE_ELSE_NETWORK else WebSettings.LOAD_DEFAULT;settings.saveFormData=false;settings.setGeolocationEnabled(false);settings.mediaPlaybackRequiresUserGesture=true;settings.textZoom=100;settings.userAgentString=site.customUserAgent.takeIf{it.isNotBlank()}?:settings.userAgentString
        if(Build.VERSION.SDK_INT>=26)settings.safeBrowsingEnabled=true
        CookieManager.getInstance().setAcceptCookie(site.cookiePolicy!="disabled");CookieManager.getInstance().setAcceptThirdPartyCookies(this,site.cookiePolicy=="first_and_third_party")
        webChromeClient=object:WebChromeClient(){override fun onPermissionRequest(request:PermissionRequest){request.deny()};override fun onGeolocationPermissionsShowPrompt(origin:String,callback:GeolocationPermissions.Callback){callback.invoke(origin,false,false)};override fun onCreateWindow(view:WebView,isDialog:Boolean,isUserGesture:Boolean,resultMsg:android.os.Message)=false;override fun onShowFileChooser(webView:WebView,filePathCallback:ValueCallback<Array<Uri>>,fileChooserParams:FileChooserParams):Boolean{filePathCallback.onReceiveValue(null);return false};override fun onJsAlert(view:WebView,url:String,message:String,result:JsResult):Boolean{result.cancel();return true};override fun onJsConfirm(view:WebView,url:String,message:String,result:JsResult):Boolean{result.cancel();return true}}
        setDownloadListener{_,_,_,_,_->}
        webViewClient=object:WebViewClient(){fun fail(category:String,state:String="failed"){if(site.failureBehavior!="last_success")loaded=false;failed=category;report(state,category)};override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean{if(WebsiteNavigationPolicy.allows(request.url.toString(),site))return false;blocked++;fail("blocked_navigation","blocked");return true};override fun onPageFinished(view:WebView,url:String){loaded=true;failed=null;view.setInitialScale(site.zoomPercent);view.post{view.scrollTo(site.scrollX,site.scrollY)};report("loaded",host=Uri.parse(url).host)};override fun onReceivedError(view:WebView,request:WebResourceRequest,error:WebResourceError){if(request.isForMainFrame)fail(if(isOffline(view.context))"offline" else mapError(error.errorCode))};override fun onReceivedHttpError(view:WebView,request:WebResourceRequest,response:WebResourceResponse){if(request.isForMainFrame&&response.statusCode>=400)fail("http_error")};override fun onReceivedSslError(view:WebView,handler:SslErrorHandler,error:SslError){handler.cancel();fail("tls_failure")};override fun onRenderProcessGone(view:WebView,detail:RenderProcessGoneDetail):Boolean{rendererRecoveries++;fail("renderer_crash");view.destroy();return true}}
        loadUrl(site.url)
    }},update={_ ->},onRelease={web->activeWebView=null;web.stopLoading();web.loadUrl("about:blank");web.clearHistory();web.removeAllViews();web.destroy()})
    if(site.reloadPolicy=="interval"&&site.refreshIntervalSeconds!=null){val interval=site.refreshIntervalSeconds;LaunchedEffect(item.id,interval){while(true){delay(interval*1000L);report("refreshing");activeWebView?.reload()}}}
}
private fun mapError(code:Int)=when(code){WebViewClient.ERROR_HOST_LOOKUP->"dns_failure";WebViewClient.ERROR_CONNECT->"connection_failure";WebViewClient.ERROR_TIMEOUT->"load_timeout";WebViewClient.ERROR_FAILED_SSL_HANDSHAKE->"tls_failure";WebViewClient.ERROR_UNSUPPORTED_SCHEME->"unsupported_scheme";else->"unknown_webview_error"}
private fun parseColor(value:String)=runCatching{Color(android.graphics.Color.parseColor(value))}.getOrDefault(SignalBackground)
private fun isOffline(context:Context):Boolean{val manager=context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager;val network=manager.activeNetwork?:return true;return manager.getNetworkCapabilities(network)?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)!=true}
