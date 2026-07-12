package org.tilecast.player

import android.app.Application
import android.os.Build
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.put
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.tilecast.player.core.DiscoveredServer
import org.tilecast.player.core.NormalizedServerUrl
import org.tilecast.player.core.PlayerEvent
import org.tilecast.player.core.PlayerState
import org.tilecast.player.core.PlayerStateMachine
import org.tilecast.player.core.ReconnectBackoff
import org.tilecast.player.core.ServerUrlPolicy
import org.tilecast.player.data.ConfigurationRepository
import org.tilecast.player.data.PlayerConfiguration
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.network.ApiException
import org.tilecast.player.network.DeviceMetadata
import org.tilecast.player.network.HeartbeatRequest
import org.tilecast.player.network.LanDiscovery
import org.tilecast.player.network.ServerIdentity
import org.tilecast.player.network.TilecastApi
import org.tilecast.player.security.CredentialStore
import org.tilecast.player.security.KeystoreCredentialStore
import java.util.Locale
import java.util.TimeZone

class PlayerViewModel(application: Application) : AndroidViewModel(application) {
    private val machine = PlayerStateMachine()
    private val mutableState = MutableStateFlow<PlayerState>(PlayerState.Unconfigured)
    val state: StateFlow<PlayerState> = mutableState.asStateFlow()
    private val configuration = ConfigurationRepository(PlayerDatabase.get(application).configuration())
    private val credentials: CredentialStore = KeystoreCredentialStore(application)
    private val api = TilecastApi()
    private val discovery = LanDiscovery(application)
    private val backoff = ReconnectBackoff()
    private var current: PlayerConfiguration? = null
    private var selectedIdentity: ServerIdentity? = null
    private var selectedUrl: NormalizedServerUrl? = null
    private var socket: WebSocket? = null
    private var reconnectJob: Job? = null

    init { viewModelScope.launch { bootstrap() } }

    private fun emit(event: PlayerEvent) { mutableState.value = machine.transition(event) }

    private suspend fun bootstrap() {
        current = configuration.getOrCreate()
        val saved = current ?: return
        if (saved.serverUrl == null) { discover(); return }
        emit(PlayerEvent.Validate(saved.serverUrl))
        try {
            val identity = api.identity(saved.serverUrl)
            if (saved.serverInstallationId != null && saved.serverInstallationId != identity.installationId) {
                emit(PlayerEvent.IdentityChanged(saved.serverInstallationId, identity.installationId)); return
            }
            selectedIdentity = identity
            selectedUrl = ServerUrlPolicy.normalize(saved.serverUrl).getOrThrow()
            val credential = credentials.read()
            if (credential != null && saved.screenName != null) connectPaired(saved, credential) else emit(PlayerEvent.IdentityConfirmed(selectedUrl!!, identity))
        } catch (error: Exception) { emit(PlayerEvent.Failed(error.message ?: "Could not reach the Tilecast server")) }
    }

    fun discover() { viewModelScope.launch {
        emit(PlayerEvent.Start)
        val found = linkedMapOf<String, DiscoveredServer>()
        withTimeoutOrNull(5_000) { discovery.discover().catch { }.collect { found[it.baseUrl] = it } }
        emit(PlayerEvent.DiscoveryFinished(found.values.toList()))
    } }

    fun showManualEntry() = emit(PlayerEvent.EnterManualAddress)

    fun validateServer(value: String) { viewModelScope.launch {
        val normalized = ServerUrlPolicy.normalize(value).getOrElse { emit(PlayerEvent.Failed(it.message ?: "Invalid server address")); return@launch }
        emit(PlayerEvent.Validate(normalized.value))
        try {
            val identity = api.identity(normalized.value)
            require(identity.product == "tilecast" && identity.apiVersion == "v1") { "This address is not a compatible Tilecast server" }
            selectedUrl = normalized; selectedIdentity = identity
            emit(PlayerEvent.IdentityConfirmed(normalized, identity))
        } catch (error: Exception) { emit(PlayerEvent.Failed(error.message ?: "Could not connect to Tilecast")) }
    } }

    fun chooseServer(server: DiscoveredServer) = validateServer(server.baseUrl)

    fun requestPairing() { viewModelScope.launch {
        val url = selectedUrl ?: return@launch; val identity = selectedIdentity ?: return@launch; val saved = current ?: configuration.getOrCreate()
        emit(PlayerEvent.RequestPairing)
        try {
            current = configuration.saveServer(saved, url.value, identity.installationId, identity.organizationName)
            val session = api.createPairing(url.value, identity.installationId, deviceMetadata(saved.playerInstallationId))
            emit(PlayerEvent.PairingCreated(url.value, identity.organizationName, session))
            pollPairing(session.id, session.pollSecret, session.pollingIntervalSeconds)
        } catch (error: Exception) { emit(PlayerEvent.Failed(error.message ?: "Pairing request failed")) }
    } }

    private suspend fun pollPairing(sessionId: String, pollSecret: String, interval: Int) {
        val url = selectedUrl?.value ?: return
        while (true) {
            delay(interval.coerceAtLeast(2) * 1_000L)
            try {
                val result = api.pollPairing(url, sessionId, pollSecret)
                when (result.status) {
                    "pending", "approved" -> continue
                    "rejected" -> { emit(PlayerEvent.Failed(result.failureReason ?: "The pairing request was rejected")); return }
                    "expired", "cancelled" -> { emit(PlayerEvent.Failed("The pairing code expired. Request a new code.")); return }
                    "claimed" -> {
                        val token = result.enrollmentToken ?: return
                        emit(PlayerEvent.EnrollmentStarted)
                        val enrollment = api.enroll(url, sessionId, token)
                        credentials.save(enrollment.deviceCredential)
                        current = configuration.saveEnrollment(current ?: return, enrollment.screenId, enrollment.screenName)
                        emit(PlayerEvent.Enrolled(enrollment.screenName))
                        connectPaired(current!!, enrollment.deviceCredential)
                        return
                    }
                }
            } catch (error: ApiException) {
                if (error.status in 400..499) { emit(PlayerEvent.Failed(error.message)); return }
            } catch (_: Exception) { /* transient loss: keep the visible code and retry */ }
        }
    }

    private suspend fun connectPaired(saved: PlayerConfiguration, credential: String) {
        val url = saved.serverUrl ?: return; val screenName = saved.screenName ?: return
        emit(PlayerEvent.Enrolled(screenName))
        try {
            api.heartbeat(url, credential, heartbeat())
        } catch (error: ApiException) {
            if (error.code == "device_credential_revoked") { revokeLocally(screenName); return }
            if (error.code == "screen_disabled") { emit(PlayerEvent.Disconnected(screenName, "This screen is disabled in Tilecast Studio")); return }
            if (error.status in 400..499) { emit(PlayerEvent.Failed(error.message)); return }
        } catch (_: Exception) { }
        openSocket(url, screenName, credential, 0)
    }

    private fun openSocket(url: String, screenName: String, credential: String, attempt: Int) {
        socket?.cancel()
        socket = api.socket(url, credential, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectJob?.cancel(); reconnectJob = null
                webSocket.send("{\"type\":\"player.hello\",\"protocolVersion\":1,\"playerVersion\":\"${BuildConfig.VERSION_NAME}\"}")
                webSocket.send(Json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), statusMessage()))
                viewModelScope.launch { emit(PlayerEvent.Connected(screenName)) }
            }
            override fun onMessage(webSocket: WebSocket, text: String) { if (text.contains("server.ping")) webSocket.send("{\"type\":\"player.pong\"}") }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
                scheduleReconnect(url, screenName, credential, attempt + 1, reason)
            }
            override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
                if (response?.code == 401) { viewModelScope.launch { verifyAfterAuthFailure(url, screenName, credential) }; return }
                scheduleReconnect(url, screenName, credential, attempt + 1, error.message)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { scheduleReconnect(url, screenName, credential, attempt + 1, reason) }
        })
    }

    private fun scheduleReconnect(url: String, name: String, credential: String, attempt: Int, reason: String?) {
        if (reconnectJob?.isActive == true) return
        reconnectJob = viewModelScope.launch {
            emit(PlayerEvent.Disconnected(name, reason))
            delay(backoff.delayMillis(attempt))
            try {
                val actual = api.identity(url)
                val expected = current?.serverInstallationId
                if (expected != null && actual.installationId != expected) {
                    emit(PlayerEvent.IdentityChanged(expected, actual.installationId))
                    return@launch
                }
                openSocket(url, name, credential, attempt)
            } catch (_: Exception) {
                reconnectJob = null
                scheduleReconnect(url, name, credential, attempt + 1, "Server unavailable")
            }
        }
    }

    private suspend fun verifyAfterAuthFailure(url: String, name: String, credential: String) {
        try { api.heartbeat(url, credential, heartbeat()); scheduleReconnect(url, name, credential, 1, "Connection interrupted") }
        catch (error: ApiException) { if (error.code == "device_credential_revoked") revokeLocally(name) else emit(PlayerEvent.Disconnected(name, error.message)) }
    }

    private suspend fun revokeLocally(screenName: String?) { socket?.cancel(); credentials.clear(); configuration.clearPairing(); emit(PlayerEvent.Revoked(screenName)) }
    fun reconnectAfterRevocation() { viewModelScope.launch { credentials.clear(); configuration.clearPairing(); selectedIdentity?.let { emit(PlayerEvent.IdentityConfirmed(selectedUrl ?: return@launch, it)) } ?: discover() } }
    fun cancelPairing() { discover() }
    fun resetServer() { viewModelScope.launch { socket?.cancel(); credentials.clear(); configuration.reset(); current = configuration.getOrCreate(); discover() } }

    private fun deviceMetadata(playerId: String): DeviceMetadata { val metrics = getApplication<Application>().resources.displayMetrics; return DeviceMetadata(playerId, if (Build.MANUFACTURER.equals("Amazon", true)) "fire-tv" else "android-tv", Build.MANUFACTURER ?: "Unknown", Build.MODEL ?: "Unknown", Build.VERSION.RELEASE ?: Build.VERSION.SDK_INT.toString(), BuildConfig.VERSION_NAME, metrics.widthPixels, metrics.heightPixels, metrics.density, Locale.getDefault().toLanguageTag(), TimeZone.getDefault().id) }
    private fun heartbeat(): HeartbeatRequest { val app = getApplication<Application>(); val metrics = app.resources.displayMetrics; return HeartbeatRequest(metrics.widthPixels, metrics.heightPixels, app.filesDir.usableSpace, SystemClock.elapsedRealtime() / 1000, BuildConfig.VERSION_NAME) }
    private fun statusMessage() = kotlinx.serialization.json.buildJsonObject { put("type", "player.status"); put("payload", kotlinx.serialization.json.buildJsonObject { val h = heartbeat(); put("screenWidth", h.screenWidth); put("screenHeight", h.screenHeight); put("availableStorageBytes", h.availableStorageBytes ?: 0); put("uptimeSeconds", h.uptimeSeconds ?: 0); put("playerVersion", h.playerVersion) }) }
}
