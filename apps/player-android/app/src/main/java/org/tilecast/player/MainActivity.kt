package org.tilecast.player

import android.graphics.Bitmap
import android.os.Bundle
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.content.ContextCompat
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay
import org.tilecast.player.core.DiscoveredServer
import org.tilecast.player.core.PlayerState
import org.tilecast.player.content.FullscreenPlayback
import java.time.Instant
import java.time.Duration

class MainActivity : ComponentActivity() {
    private val model:PlayerViewModel by viewModels()
    private val clockReceiver=object:BroadcastReceiver(){override fun onReceive(context:Context?,intent:Intent?){model.recalculateSchedule()}}
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
		WindowCompat.getInsetsController(window,window.decorView).hide(WindowInsetsCompat.Type.systemBars())
        setContent { TilecastTheme { TilecastPlayer(model) } }
    }
    override fun onStart(){super.onStart();ContextCompat.registerReceiver(this,clockReceiver,IntentFilter().apply{addAction(Intent.ACTION_TIME_CHANGED);addAction(Intent.ACTION_TIMEZONE_CHANGED)},ContextCompat.RECEIVER_NOT_EXPORTED);model.recalculateSchedule()}
    override fun onStop(){unregisterReceiver(clockReceiver);super.onStop()}
}

private val background = Color(0xFF13231E)
private val surface = Color(0xFF1C3029)
private val text = Color(0xFFF1F5F3)
private val muted = Color(0xFFB5C5BF)
private val accent = Color(0xFF78BFA6)
private val warning = Color(0xFFE9CF79)

@Composable private fun TilecastTheme(content: @Composable () -> Unit) { MaterialTheme(colorScheme = darkColorScheme(primary = accent, background = background, surface = surface, onBackground = text, onSurface = text), content = content) }

@Composable fun TilecastPlayer(model: PlayerViewModel) {
    val state by model.state.collectAsStateWithLifecycle()
	val content by model.content.collectAsStateWithLifecycle()
	val disabled by model.playbackDisabled.collectAsStateWithLifecycle()
	val identify by model.identify.collectAsStateWithLifecycle()
	val config by model.playerConfig.collectAsStateWithLifecycle()
	val brandedBackground=config?.branding?.backgroundColor?.let{runCatching{Color(android.graphics.Color.parseColor(it))}.getOrNull()}?:background
	val brandedText=config?.branding?.textColor?.let{runCatching{Color(android.graphics.Color.parseColor(it))}.getOrNull()}?:text
	if(identify!=null){Box(Modifier.fillMaxSize().background(Color.Black),contentAlignment=Alignment.Center){Text(identify!!,color=Color.White,style=MaterialTheme.typography.displayLarge)};return}
	if (content != null) {
		FullscreenPlayback(content!!, model::playbackBoundary, model::playbackError,model::websitePlaybackStatus)
		return
	}
	if(disabled){Box(Modifier.fillMaxSize().background(brandedBackground),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally){TilecastBrand();Spacer(Modifier.height(28.dp));Text(config?.branding?.disabledTitle?:"Playback disabled",color=brandedText,style=MaterialTheme.typography.headlineLarge);Text(config?.branding?.disabledMessage?:"This screen remains connected to Tilecast Studio.",color=brandedText)}};return}
    Box(Modifier.fillMaxSize().background(brandedBackground).padding(horizontal = 72.dp, vertical = 52.dp)) {
        Column(Modifier.fillMaxSize()) {
            TilecastBrand()
            Spacer(Modifier.height(42.dp))
            Crossfade(state, label = "player-state") { current ->
                when (current) {
                    PlayerState.Unconfigured, PlayerState.Discovering -> LoadingState("Looking for Tilecast servers…")
                    is PlayerState.ServerSelection -> ServerSelection(current.servers, model::chooseServer, model::showManualEntry, model::discover)
                    is PlayerState.ManualServerEntry -> ManualEntry(model::validateServer, model::discover, current.error)
                    is PlayerState.ValidatingServer -> LoadingState("Checking ${current.serverUrl}…")
                    is PlayerState.ServerConfirmation -> ServerConfirmation(current, model::requestPairing, model::discover)
                    PlayerState.PairingRequest -> LoadingState("Requesting a secure pairing code…")
                    is PlayerState.WaitingForApproval -> PairingState(current, model::cancelPairing)
                    PlayerState.Enrolling -> LoadingState("Securing this player…")
                    is PlayerState.PairedConnecting -> LoadingState("Connecting ${current.screenName}…")
                    is PlayerState.PairedIdle -> IdleState(current)
                    is PlayerState.CredentialRevoked -> RevokedState(current.screenName, model::reconnectAfterRevocation)
                    is PlayerState.ServerIdentityMismatch -> IdentityMismatch(current.expected, current.actual, model::resetServer)
                    is PlayerState.ConnectionError -> ErrorState(current.message, model::discover)
                }
            }
        }
    }
}

@Composable private fun TilecastBrand() { Row(verticalAlignment = Alignment.CenterVertically) { Row(Modifier.size(31.dp).border(1.dp, accent, RoundedCornerShape(3.dp)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) { Box(Modifier.width(8.dp).fillMaxSize().background(warning)); Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(3.dp)) { Box(Modifier.weight(1f).fillMaxWidth().background(accent)); Box(Modifier.weight(1f).fillMaxWidth().background(text)) } }; Spacer(Modifier.width(13.dp)); Text("Tilecast", color = text, fontSize = 28.sp, fontWeight = FontWeight.Bold) } }

@Composable private fun LoadingState(message: String) { Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) { CircularProgressIndicator(color = accent); Spacer(Modifier.width(20.dp)); Text(message, color = text, fontSize = 25.sp) } }

@Composable private fun ServerSelection(servers: List<DiscoveredServer>, choose: (DiscoveredServer) -> Unit, manual: () -> Unit, refresh: () -> Unit) { Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(50.dp)) { Column(Modifier.weight(1f)) { Text("Connect this display", color = text, fontSize = 42.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(12.dp)); Text("Choose a Tilecast server found on this network or enter its address.", color = muted, fontSize = 21.sp); Spacer(Modifier.height(30.dp)); Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { Button(onClick = manual) { Text("Enter server address", fontSize = 18.sp) }; OutlinedButton(onClick = refresh) { Text("Refresh", fontSize = 18.sp) } } }; Column(Modifier.weight(1f)) { Text("Nearby servers", color = muted, fontSize = 17.sp); Spacer(Modifier.height(12.dp)); if (servers.isEmpty()) Text("No servers discovered. Multicast discovery may be blocked on this network.", color = muted, fontSize = 19.sp) else LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) { items(servers, key = { it.baseUrl }) { server -> OutlinedButton(onClick = { choose(server) }, modifier = Modifier.fillMaxWidth().height(68.dp)) { Column(Modifier.fillMaxWidth()) { Text(server.name, fontSize = 19.sp); Text(server.baseUrl, color = muted, fontSize = 14.sp) } } } } } } }

@Composable private fun ManualEntry(connect: (String) -> Unit, back: () -> Unit, error: String?) { var address by remember { mutableStateOf("") }; Column(Modifier.fillMaxWidth(0.72f)) { Text("Enter the Tilecast server address", color = text, fontSize = 36.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(10.dp)); Text("Examples: https://signage.example.com or http://192.168.1.50:8080", color = muted, fontSize = 19.sp); Spacer(Modifier.height(25.dp)); OutlinedTextField(value = address, onValueChange = { address = it }, label = { Text("Server address") }, singleLine = true, modifier = Modifier.fillMaxWidth().height(72.dp), textStyle = MaterialTheme.typography.headlineSmall); error?.let { Text(it, color = Color(0xFFFFAAA4), fontSize = 17.sp) }; Spacer(Modifier.height(22.dp)); Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { Button(onClick = { connect(address) }, enabled = address.isNotBlank()) { Text("Continue", fontSize = 18.sp) }; OutlinedButton(onClick = back) { Text("Back", fontSize = 18.sp) } } } }

@Composable private fun ServerConfirmation(state: PlayerState.ServerConfirmation, connect: () -> Unit, back: () -> Unit) { Column(Modifier.fillMaxWidth(0.75f)) { Text("Connect to ${state.identity.organizationName}?", color = text, fontSize = 38.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(18.dp)); InfoRow("Server", state.serverUrl.value); InfoRow("Connection", if (state.serverUrl.localInsecure) "Local HTTP — traffic is not encrypted" else "Secure HTTPS"); if (state.serverUrl.localInsecure) { Spacer(Modifier.height(16.dp)); Text("Only continue if you trust this local network. Tilecast will never silently downgrade an HTTPS address.", color = warning, fontSize = 18.sp) }; Spacer(Modifier.height(28.dp)); Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { Button(onClick = connect) { Text("Connect and pair", fontSize = 18.sp) }; OutlinedButton(onClick = back) { Text("Back", fontSize = 18.sp) } } } }

@Composable private fun PairingState(state: PlayerState.WaitingForApproval, cancel: () -> Unit) { var remaining by remember { mutableLongStateOf(Duration.between(Instant.parse(state.pairing.serverTime), Instant.parse(state.pairing.expiresAt)).seconds) }; LaunchedEffect(state.pairing.id) { val initial = remaining; val started = SystemClock.elapsedRealtime(); while (true) { remaining = (initial - (SystemClock.elapsedRealtime() - started) / 1_000).coerceAtLeast(0); delay(1_000) } }; Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(state.organizationName, color = muted, fontSize = 20.sp); Text("Pair this screen", color = text, fontSize = 40.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(20.dp)); Text(state.pairing.code.chunked(3).joinToString(" "), color = warning, fontSize = 72.sp, fontWeight = FontWeight.Bold, letterSpacing = 8.sp); Text("Enter this code in Tilecast Studio", color = text, fontSize = 22.sp); Spacer(Modifier.height(20.dp)); Text("Expires in ${remaining / 60}:${(remaining % 60).toString().padStart(2, '0')}  ·  Connected to ${state.serverUrl}", color = muted, fontSize = 17.sp); Spacer(Modifier.height(25.dp)); OutlinedButton(onClick = cancel) { Text("Cancel or change server", fontSize = 17.sp) } }; Column(horizontalAlignment = Alignment.CenterHorizontally) { Image(qrCode(state.pairing.approvalUrl).asImageBitmap(), "QR code for pairing approval", Modifier.size(230.dp).background(Color.White).padding(12.dp)); Spacer(Modifier.height(10.dp)); Text("Scan to approve", color = muted, fontSize = 17.sp) } } }

@Composable private fun IdleState(state: PlayerState.PairedIdle) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(state.screenName, color = muted, fontSize = 20.sp); Spacer(Modifier.height(15.dp)); Text("No content assigned", color = text, fontSize = 48.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(10.dp)); Text(if (state.connected) "Connected to Tilecast · Waiting for an assignment" else "Reconnecting to Tilecast…", color = if (state.connected) accent else warning, fontSize = 20.sp); state.detail?.let { Text(it, color = muted, fontSize = 16.sp) } } } }
@Composable private fun RevokedState(name: String?, reconnect: () -> Unit) { CenterMessage("Pairing was revoked", "${name ?: "This screen"} was removed or revoked in Tilecast Studio. Pair it again to restore access.", "Pair again", reconnect) }
@Composable private fun IdentityMismatch(expected: String, actual: String, reset: () -> Unit) { CenterMessage("Server identity changed", "This address now belongs to a different Tilecast installation. Stored credentials were not sent. Expected $expected, received $actual.", "Reset connection", reset) }
@Composable private fun ErrorState(message: String, retry: () -> Unit) { CenterMessage("Connection problem", message, "Choose server", retry) }
@Composable private fun CenterMessage(title: String, message: String, action: String, onClick: () -> Unit) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(Modifier.fillMaxWidth(.7f), horizontalAlignment = Alignment.CenterHorizontally) { Text(title, color = text, fontSize = 38.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center); Spacer(Modifier.height(12.dp)); Text(message, color = muted, fontSize = 20.sp, textAlign = TextAlign.Center); Spacer(Modifier.height(25.dp)); Button(onClick = onClick) { Text(action, fontSize = 18.sp) } } } }
@Composable private fun InfoRow(label: String, value: String) { Row(Modifier.fillMaxWidth().padding(vertical = 9.dp)) { Text(label, color = muted, fontSize = 18.sp, modifier = Modifier.width(150.dp)); Text(value, color = text, fontSize = 18.sp) } }

private fun qrCode(value: String): Bitmap { val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 420, 420); return Bitmap.createBitmap(420, 420, Bitmap.Config.RGB_565).apply { for (x in 0 until 420) for (y in 0 until 420) setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE) } }
