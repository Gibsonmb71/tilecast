package org.tilecast.player

import android.graphics.Bitmap
import android.os.Bundle
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.provider.Settings
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.activity.compose.LocalActivity
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
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
import org.tilecast.player.reliability.ReliabilityController
import org.tilecast.player.ui.theme.BroadcastAmber
import org.tilecast.player.ui.theme.SignalBackground
import org.tilecast.player.ui.theme.SignalBlue
import org.tilecast.player.ui.theme.SignalDanger
import org.tilecast.player.ui.theme.SignalDimensions
import org.tilecast.player.ui.theme.SignalMuted
import org.tilecast.player.ui.theme.SignalOutlinedButton
import org.tilecast.player.ui.theme.SignalText
import org.tilecast.player.ui.theme.SignalTilePale
import org.tilecast.player.ui.theme.SignalWarning
import org.tilecast.player.ui.theme.SignalButton
import org.tilecast.player.ui.theme.TilecastSignalTheme
import org.tilecast.player.ui.CommissioningScreen
import org.tilecast.player.reliability.BootRecovery
import java.time.Instant
import java.time.Duration

class MainActivity : ComponentActivity() {
    private val model:PlayerViewModel by viewModels()
	private lateinit var reliability:ReliabilityController
	private var adminPrompt by mutableStateOf(false)
	private val escapeKeys=ArrayDeque<Int>()
	private val reliabilityHandler=Handler(Looper.getMainLooper())
	private var restoreKiosk:Runnable?=null
	private val escapeSequence=listOf(KeyEvent.KEYCODE_BACK,KeyEvent.KEYCODE_BACK,KeyEvent.KEYCODE_DPAD_UP,KeyEvent.KEYCODE_DPAD_DOWN,KeyEvent.KEYCODE_DPAD_CENTER)
    private val clockReceiver=object:BroadcastReceiver(){override fun onReceive(context:Context?,intent:Intent?){model.recalculateSchedule()}}
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
		reliability=ReliabilityController(this)
		getSharedPreferences("tilecast-reliability",MODE_PRIVATE).edit().putBoolean("update-active",model.update.value?.state in setOf("waiting_for_permission","waiting_for_user","installing")).apply()
        enableEdgeToEdge()
		WindowCompat.getInsetsController(window,window.decorView).hide(WindowInsetsCompat.Type.systemBars())
        setContent { TilecastSignalTheme { TilecastPlayer(model,adminPrompt,{adminPrompt=false},reliability) } }
    }
    override fun onStart(){super.onStart();getSharedPreferences("tilecast-reliability",MODE_PRIVATE).edit().putBoolean("foreground",true).apply();ContextCompat.registerReceiver(this,clockReceiver,IntentFilter().apply{addAction(Intent.ACTION_TIME_CHANGED);addAction(Intent.ACTION_TIMEZONE_CHANGED)},ContextCompat.RECEIVER_NOT_EXPORTED);model.recalculateSchedule();model.refreshUpdatePermission();model.resumeUpdateSchedule();model.playerConfig.value?.let{reliability.applyWindow(this,it,model.activeHours.value)};reliabilityHandler.postDelayed({BootRecovery.markForegroundHealthy(this);model.refreshCommissioning()},5000)}
    override fun onResume(){super.onResume();model.refreshCommissioning()}
    override fun onStop(){getSharedPreferences("tilecast-reliability",MODE_PRIVATE).edit().putBoolean("foreground",false).putLong("last-foreground-exit",System.currentTimeMillis()).apply();unregisterReceiver(clockReceiver);super.onStop()}
    override fun onWindowFocusChanged(hasFocus:Boolean){super.onWindowFocusChanged(hasFocus);if(hasFocus)model.playerConfig.value?.let{reliability.applyWindow(this,it,model.activeHours.value)}}
    override fun onKeyDown(keyCode:Int,event:KeyEvent?):Boolean {escapeKeys.addLast(keyCode);while(escapeKeys.size>escapeSequence.size)escapeKeys.removeFirst();if(escapeKeys.toList()==escapeSequence){escapeKeys.clear();adminPrompt=true;return true};return if(keyCode==KeyEvent.KEYCODE_BACK)true else super.onKeyDown(keyCode,event)}
	fun openSystemSettings(action:String){val intent=Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);if(action==Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)intent.data=Uri.parse("package:$packageName");runCatching{startActivity(intent)}}
	fun restartPlayer(){startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK));finish()}
	fun installPlayerUpdate(){runCatching{stopLockTask()};getSharedPreferences("tilecast-reliability",MODE_PRIVATE).edit().putBoolean("update-active",true).apply();model.installUpdate()}
	fun applyReliability(config:org.tilecast.player.network.PlayerConfig,activeHours:Boolean){reliability.applyWindow(this,config,activeHours);restoreKiosk?.let(reliabilityHandler::removeCallbacks);reliability.maintenanceUntil()?.let{until->Runnable{reliability.applyWindow(this,config,activeHours)}.also{restoreKiosk=it;reliabilityHandler.postDelayed(it,Duration.between(Instant.now(),until).toMillis().coerceAtLeast(0)+100)}}}
	fun maintenanceChanged(){model.playerConfig.value?.let{applyReliability(it,model.activeHours.value)}}
}

@Composable fun TilecastPlayer(model: PlayerViewModel,adminPrompt:Boolean=false,dismissAdmin:()->Unit={},reliability:ReliabilityController?=null) {
    val state by model.state.collectAsStateWithLifecycle()
	val content by model.content.collectAsStateWithLifecycle()
	val disabled by model.playbackDisabled.collectAsStateWithLifecycle()
	val identify by model.identify.collectAsStateWithLifecycle()
	val config by model.playerConfig.collectAsStateWithLifecycle()
	val update by model.update.collectAsStateWithLifecycle()
	val activeHours by model.activeHours.collectAsStateWithLifecycle()
	val safeMode by model.safeMode.collectAsStateWithLifecycle()
	val commissioning by model.commissioning.collectAsStateWithLifecycle()
	val brandedBackground=config?.branding?.backgroundColor?.let{runCatching{Color(android.graphics.Color.parseColor(it))}.getOrNull()}?:SignalBackground
	val brandedText=config?.branding?.textColor?.let{runCatching{Color(android.graphics.Color.parseColor(it))}.getOrNull()}?:SignalText
	val activity=LocalActivity.current as? MainActivity
	LaunchedEffect(config,activeHours){config?.let{activity?.applyReliability(it,activeHours)}}
	if(adminPrompt&&reliability!=null){AdministratorMaintenance(reliability,dismissAdmin);return}
	if(commissioning.required){CommissioningScreen(commissioning,model::setCommissioningPin,{activity?.openSystemSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS)},{activity?.openSystemSettings(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)},model::refreshCommissioning,model::advanceCommissioning,{model.runSelfTest(); Unit},model::completeCommissioning);return}
	if(identify!=null){Box(Modifier.fillMaxSize().background(Color.Black),contentAlignment=Alignment.Center){Text(identify!!,color=Color.White,style=MaterialTheme.typography.displayLarge)};return}
	if(update?.state in setOf("waiting_for_permission","waiting_for_user","installing")){UpdateApproval(update!!,model::openUpdatePermission,{activity?.installPlayerUpdate()?:model.installUpdate()});return}
	if(safeMode){Box(Modifier.fillMaxSize().background(brandedBackground),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally){TilecastBrand();Spacer(Modifier.height(28.dp));Text("Player recovery mode",color=brandedText,style=MaterialTheme.typography.headlineLarge);Text("Tilecast remains paired and connected. Use Studio or the local maintenance menu to retry.",color=brandedText);Text("Diagnostic code: TC-RCV-10",color=SignalWarning)}};return}
	if(!activeHours){val offHoursBackground=if(config?.power?.blackScreenFallback!=false)Color.Black else brandedBackground;Box(Modifier.fillMaxSize().background(offHoursBackground),contentAlignment=Alignment.Center){Text(config?.branding?.footerText.orEmpty(),color=if(offHoursBackground==Color.Black)Color.DarkGray else brandedText)};return}
	if (content != null) {
		FullscreenPlayback(content!!, model::playbackBoundary, model::playbackError,model::websitePlaybackStatus,model::sourcePlaybackStatus,model::playbackProgress)
		return
	}
	if(disabled){Box(Modifier.fillMaxSize().background(brandedBackground),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally){TilecastBrand();Spacer(Modifier.height(28.dp));Text(config?.branding?.disabledTitle?:"Playback disabled",color=brandedText,style=MaterialTheme.typography.headlineLarge);Text(config?.branding?.disabledMessage?:"This screen remains connected to Tilecast Studio.",color=brandedText)}};return}
	val stateBackground = if (state is PlayerState.PairedIdle) brandedBackground else SignalBackground
	Box(Modifier.fillMaxSize().background(stateBackground).padding(horizontal = SignalDimensions.ScreenHorizontal, vertical = SignalDimensions.ScreenVertical)) {
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

@Composable private fun AdministratorMaintenance(reliability:ReliabilityController,dismiss:()->Unit){var pin by remember{mutableStateOf("")};var unlocked by remember{mutableStateOf(false)};var error by remember{mutableStateOf<String?>(null)};val activity=LocalActivity.current as? MainActivity ?: return;val model:PlayerViewModel=viewModel();Box(Modifier.fillMaxSize().background(SignalBackground).padding(72.dp),contentAlignment=Alignment.Center){if(!unlocked)Column(Modifier.fillMaxWidth(.6f),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(16.dp)){Text(if(reliability.hasAdminPin())"Administrator maintenance" else "Set local administrator PIN",color=SignalText,fontSize=36.sp);Text("This local PIN only opens bounded Tilecast maintenance tools. Incorrect attempts are rate-limited.",color=SignalMuted,textAlign=TextAlign.Center);OutlinedTextField(value=pin,onValueChange={pin=it.filter(Char::isDigit).take(12)},label={Text("PIN")},visualTransformation=PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.NumberPassword),singleLine=true);error?.let{Text(it,color=SignalDanger)};Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){SignalOutlinedButton(onClick=dismiss){Text("Cancel")};SignalButton(onClick={val valid=if(reliability.hasAdminPin())reliability.verifyAdminPin(pin.toCharArray()) else runCatching{reliability.setAdminPin(pin.toCharArray());true}.getOrDefault(false);if(valid){reliability.beginMaintenance(15);unlocked=true;pin=""}else error="PIN was incorrect or is temporarily locked"},enabled=pin.length>=4){Text(if(reliability.hasAdminPin())"Unlock" else "Set PIN")}}}else Column(Modifier.fillMaxWidth(.8f),verticalArrangement=Arrangement.spacedBy(12.dp)){Text("Tilecast maintenance",color=SignalText,fontSize=38.sp);Text("This session expires automatically. Accessibility return and off-hours sleep are paused.",color=SignalMuted);Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){SignalButton(onClick={activity.openSystemSettings(Settings.ACTION_SETTINGS)}){Text("Android Settings")};SignalButton(onClick={activity.openSystemSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS)}){Text("Accessibility Settings")};SignalButton(onClick={activity.openSystemSettings(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)}){Text("Install permission")}};Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){SignalOutlinedButton(onClick={reliability.setSafeMode(false)}){Text("Clear safe mode")};SignalOutlinedButton(onClick={model.runSetupAgain();dismiss()}){Text("Run setup again")};SignalOutlinedButton(onClick={activity.restartPlayer()}){Text("Restart Tilecast")};SignalButton(onClick=dismiss){Text("Return to playback")}}}}}

@Composable private fun UpdateApproval(state:org.tilecast.player.content.UpdateUiState,permission:()->Unit,install:()->Unit){Box(Modifier.fillMaxSize().background(SignalBackground).padding(72.dp),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(20.dp)){TilecastBrand();Text("Tilecast Player update",color=SignalText,fontSize=44.sp,fontWeight=FontWeight.SemiBold);Text("${state.currentVersion} → ${state.newVersion}",color=SignalBlue,fontSize=28.sp);Text(state.message,color=SignalMuted,fontSize=21.sp);when{state.permissionRequired->SignalButton(onClick=permission){Text("Open install permission settings")};state.installReady->SignalButton(onClick=install){Text("Install update")};else->CircularProgressIndicator()};Text("Android may require confirmation. Tilecast cannot approve the system installer for you.",color=SignalWarning,fontSize=16.sp)}}}

@Composable private fun TilecastBrand() { Row(verticalAlignment = Alignment.CenterVertically) { Row(Modifier.size(31.dp).border(1.dp, SignalBlue, RoundedCornerShape(3.dp)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) { Box(Modifier.width(8.dp).fillMaxSize().background(BroadcastAmber)); Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(3.dp)) { Box(Modifier.weight(1f).fillMaxWidth().background(SignalBlue)); Box(Modifier.weight(1f).fillMaxWidth().background(SignalTilePale)) } }; Spacer(Modifier.width(13.dp)); Text("Tilecast", color = SignalText, fontSize = 28.sp, fontWeight = FontWeight.Bold) } }

@Composable private fun LoadingState(message: String) { Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) { CircularProgressIndicator(color = SignalBlue); Spacer(Modifier.width(20.dp)); Text(message, color = SignalText, fontSize = 25.sp) } }

@Composable private fun ServerSelection(servers: List<DiscoveredServer>, choose: (DiscoveredServer) -> Unit, manual: () -> Unit, refresh: () -> Unit) { Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(50.dp)) { Column(Modifier.weight(1f)) { Text("Connect this display", color = SignalText, fontSize = 42.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(12.dp)); Text("Choose a Tilecast server found on this network or enter its address.", color = SignalMuted, fontSize = 21.sp); Spacer(Modifier.height(30.dp)); Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { SignalButton(onClick = manual) { Text("Enter server address", fontSize = 18.sp) }; SignalOutlinedButton(onClick = refresh) { Text("Refresh", fontSize = 18.sp) } } }; Column(Modifier.weight(1f)) { Text("Nearby servers", color = SignalMuted, fontSize = 17.sp); Spacer(Modifier.height(12.dp)); if (servers.isEmpty()) Text("No servers discovered. Multicast discovery may be blocked on this network.", color = SignalMuted, fontSize = 19.sp) else LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) { items(servers, key = { it.baseUrl }) { server -> SignalOutlinedButton(onClick = { choose(server) }, modifier = Modifier.fillMaxWidth().height(68.dp)) { Column(Modifier.fillMaxWidth()) { Text(server.name, fontSize = 19.sp); Text(server.baseUrl, color = SignalMuted, fontSize = 14.sp) } } } } } } }

@Composable private fun ManualEntry(connect: (String) -> Unit, back: () -> Unit, error: String?) { var address by remember { mutableStateOf("") }; Column(Modifier.fillMaxWidth(0.72f)) { Text("Enter the Tilecast server address", color = SignalText, fontSize = 36.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(10.dp)); Text("Examples: https://signage.example.com or http://192.168.1.50:8080", color = SignalMuted, fontSize = 19.sp); Spacer(Modifier.height(25.dp)); OutlinedTextField(value = address, onValueChange = { address = it }, label = { Text("Server address") }, singleLine = true, modifier = Modifier.fillMaxWidth().height(72.dp), textStyle = MaterialTheme.typography.headlineSmall); error?.let { Text(it, color = SignalDanger, fontSize = 17.sp) }; Spacer(Modifier.height(22.dp)); Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { SignalButton(onClick = { connect(address) }, enabled = address.isNotBlank()) { Text("Continue", fontSize = 18.sp) }; SignalOutlinedButton(onClick = back) { Text("Back", fontSize = 18.sp) } } } }

@Composable private fun ServerConfirmation(state: PlayerState.ServerConfirmation, connect: () -> Unit, back: () -> Unit) { Column(Modifier.fillMaxWidth(0.75f)) { Text("Connect to ${state.identity.organizationName}?", color = SignalText, fontSize = 38.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(18.dp)); InfoRow("Server", state.serverUrl.value); InfoRow("Connection", if (state.serverUrl.localInsecure) "Local HTTP — traffic is not encrypted" else "Secure HTTPS"); if (state.serverUrl.localInsecure) { Spacer(Modifier.height(16.dp)); Text("Only continue if you trust this local network. Tilecast will never silently downgrade an HTTPS address.", color = SignalWarning, fontSize = 18.sp) }; Spacer(Modifier.height(28.dp)); Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { SignalButton(onClick = connect) { Text("Connect and pair", fontSize = 18.sp) }; SignalOutlinedButton(onClick = back) { Text("Back", fontSize = 18.sp) } } } }

@Composable private fun PairingState(state: PlayerState.WaitingForApproval, cancel: () -> Unit) { var remaining by remember { mutableLongStateOf(Duration.between(Instant.parse(state.pairing.serverTime), Instant.parse(state.pairing.expiresAt)).seconds) }; LaunchedEffect(state.pairing.id) { val initial = remaining; val started = SystemClock.elapsedRealtime(); while (true) { remaining = (initial - (SystemClock.elapsedRealtime() - started) / 1_000).coerceAtLeast(0); delay(1_000) } }; Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(state.organizationName, color = SignalMuted, fontSize = 20.sp); Text("Pair this screen", color = SignalText, fontSize = 40.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(20.dp)); Text(state.pairing.code.chunked(3).joinToString(" "), color = BroadcastAmber, fontSize = 72.sp, fontWeight = FontWeight.Bold, letterSpacing = 8.sp); Text("Enter this code in Tilecast Studio", color = SignalText, fontSize = 22.sp); Spacer(Modifier.height(20.dp)); Text("Expires in ${remaining / 60}:${(remaining % 60).toString().padStart(2, '0')}  ·  Connected to ${state.serverUrl}", color = SignalMuted, fontSize = 17.sp); Spacer(Modifier.height(25.dp)); SignalOutlinedButton(onClick = cancel) { Text("Cancel or change server", fontSize = 17.sp) } }; Column(horizontalAlignment = Alignment.CenterHorizontally) { Image(qrCode(state.pairing.approvalUrl).asImageBitmap(), "QR code for pairing approval", Modifier.size(230.dp).background(Color.White).padding(12.dp)); Spacer(Modifier.height(10.dp)); Text("Scan to approve", color = SignalMuted, fontSize = 17.sp) } } }

@Composable private fun IdleState(state: PlayerState.PairedIdle) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(state.screenName, color = SignalMuted, fontSize = 20.sp); Spacer(Modifier.height(15.dp)); Text("No content assigned", color = SignalText, fontSize = 48.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(10.dp)); Text(if (state.connected) "Connected to Tilecast · Waiting for an assignment" else "Reconnecting to Tilecast…", color = if (state.connected) SignalBlue else SignalWarning, fontSize = 20.sp); state.detail?.let { Text(it, color = SignalMuted, fontSize = 16.sp) } } } }
@Composable private fun RevokedState(name: String?, reconnect: () -> Unit) { CenterMessage("Pairing was revoked", "${name ?: "This screen"} was removed or revoked in Tilecast Studio. Pair it again to restore access.", "Pair again", reconnect) }
@Composable private fun IdentityMismatch(expected: String, actual: String, reset: () -> Unit) { CenterMessage("Server identity changed", "This address now belongs to a different Tilecast installation. Stored credentials were not sent. Expected $expected, received $actual.", "Reset connection", reset) }
@Composable private fun ErrorState(message: String, retry: () -> Unit) { CenterMessage("Connection problem", message, "Choose server", retry) }
@Composable private fun CenterMessage(title: String, message: String, action: String, onClick: () -> Unit) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(Modifier.fillMaxWidth(.7f), horizontalAlignment = Alignment.CenterHorizontally) { Text(title, color = SignalText, fontSize = 38.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center); Spacer(Modifier.height(12.dp)); Text(message, color = SignalMuted, fontSize = 20.sp, textAlign = TextAlign.Center); Spacer(Modifier.height(25.dp)); SignalButton(onClick = onClick) { Text(action, fontSize = 18.sp) } } } }
@Composable private fun InfoRow(label: String, value: String) { Row(Modifier.fillMaxWidth().padding(vertical = 9.dp)) { Text(label, color = SignalMuted, fontSize = 18.sp, modifier = Modifier.width(150.dp)); Text(value, color = SignalText, fontSize = 18.sp) } }

private fun qrCode(value: String): Bitmap { val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 420, 420); return Bitmap.createBitmap(420, 420, Bitmap.Config.RGB_565).apply { for (x in 0 until 420) for (y in 0 until 420) setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE) } }
