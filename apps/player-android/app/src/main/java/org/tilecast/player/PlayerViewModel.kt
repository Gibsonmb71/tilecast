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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
import org.tilecast.player.content.ManifestSyncManager
import org.tilecast.player.content.PlaybackSession
import org.tilecast.player.content.PreparedContent
import org.tilecast.player.content.SyncProgress
import org.tilecast.player.content.ScheduleEngine
import org.tilecast.player.content.WebsitePlaybackStatus
import org.tilecast.player.content.WebsiteDataManager
import org.tilecast.player.content.CommandCoordinator
import org.tilecast.player.content.CommandOutcome
import org.tilecast.player.content.EmergencyController
import org.tilecast.player.content.PlayerConfigManager
import org.tilecast.player.network.PlayerConfig
import java.time.Duration
import java.time.Instant
import java.util.Locale
import java.util.TimeZone

class PlayerViewModel(application: Application) : AndroidViewModel(application) {
    private val machine = PlayerStateMachine()
    private val mutableState = MutableStateFlow<PlayerState>(PlayerState.Unconfigured)
    val state: StateFlow<PlayerState> = mutableState.asStateFlow()
    private val configuration = ConfigurationRepository(PlayerDatabase.get(application).configuration())
	private val database = PlayerDatabase.get(application)
	private val synchronizer = ManifestSyncManager(application, database, api = TilecastApi(), cacheLimitBytes=BuildConfig.MEDIA_CACHE_BYTES, minimumFreeBytes=BuildConfig.MINIMUM_FREE_BYTES, automaticVideoThresholdBytes=BuildConfig.AUTOMATIC_VIDEO_THRESHOLD_BYTES, concurrentDownloads=BuildConfig.CONCURRENT_DOWNLOADS)
    private val credentials: CredentialStore = KeystoreCredentialStore(application)
    private val api = TilecastApi()
    private val discovery = LanDiscovery(application)
    private val backoff = ReconnectBackoff()
    private var current: PlayerConfiguration? = null
    private var selectedIdentity: ServerIdentity? = null
    private var selectedUrl: NormalizedServerUrl? = null
    private var socket: WebSocket? = null
    private var reconnectJob: Job? = null
	private val mutableContent = MutableStateFlow<PlaybackSession?>(null)
	val content: StateFlow<PlaybackSession?> = mutableContent.asStateFlow()
	private var pendingContent: PreparedContent? = null
	private var syncJob: Job? = null
	private var manifestPollJob: Job? = null
	private var syncProgress = SyncProgress()
	private var lastPlaybackError: String? = null
	private var currentItemId: String? = null
	private var currentAssetId: String? = null
	private var activeManifestVersion: Long? = null
	private var assignedPlaylistId: String? = null
	private var scheduleContent: PreparedContent? = null
	private var scheduleJob: Job? = null
	private var currentScheduleId: String? = null
	private var currentPlaylistId: String? = null
	private var selectionSource: String = "none"
	private var nextTransition: Instant? = null
	private var scheduleError: String? = null
	private var clockOffsetSeconds: Long? = null
	private var websiteStatus=WebsitePlaybackStatus()
	private val commandCoordinator=CommandCoordinator(application,api)
	private val mutablePlaybackDisabled=MutableStateFlow(commandCoordinator.playbackDisabled)
	val playbackDisabled:StateFlow<Boolean> = mutablePlaybackDisabled.asStateFlow()
	private val mutableIdentify=MutableStateFlow<String?>(null)
	val identify:StateFlow<String?> = mutableIdentify.asStateFlow()
	private var emergencyJob:Job?=null
	private var activeEmergencyId:String?=null
	private var emergencyState:String?=null
	private var lastCommandId:String?=null
	private var lastCommandState:String?=null
	private var lastCommandResult:String?=null
	private var lastCommandCompletedAt:String?=null
	private val configManager=PlayerConfigManager(database,api)
	private val mutablePlayerConfig=MutableStateFlow<PlayerConfig?>(null)
	val playerConfig:StateFlow<PlayerConfig?> = mutablePlayerConfig.asStateFlow()
	private var configPollJob:Job?=null
	private var activeConfigRevision:Long?=null
	private var configurationError:String?=null
	private var lastStatusSentAt:Long=0

    init { viewModelScope.launch { bootstrap() } }

    private fun emit(event: PlayerEvent) { mutableState.value = machine.transition(event) }

    private suspend fun bootstrap() {
        current = configuration.getOrCreate()
        val saved = current ?: return
		val storedCredential = credentials.read()
		mutablePlayerConfig.value=configManager.loadActive();mutablePlayerConfig.value?.let(::applyPlayerConfig)
		if (saved.serverUrl != null && storedCredential != null) {
			synchronizer.loadActive()?.let { active -> activeManifestVersion=active.manifest.manifestVersion;activateScheduleSelection(active,saved.serverUrl,storedCredential) }
		}
        if (saved.serverUrl == null) { discover(); return }
        emit(PlayerEvent.Validate(saved.serverUrl))
        try {
            val identity = api.identity(saved.serverUrl)
            if (saved.serverInstallationId != null && saved.serverInstallationId != identity.installationId) {
                emit(PlayerEvent.IdentityChanged(saved.serverInstallationId, identity.installationId)); return
            }
            selectedIdentity = identity
            selectedUrl = ServerUrlPolicy.normalize(saved.serverUrl).getOrThrow()
            val credential = storedCredential
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
        mutableContent.value = mutableContent.value?.copy(serverUrl = url, credential = credential)
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
				viewModelScope.launch { reconcileManifest(url, credential) }
				viewModelScope.launch { runCommands(url, credential) }
				viewModelScope.launch { reconcilePlayerConfig(url,credential) }
				manifestPollJob?.cancel(); manifestPollJob=viewModelScope.launch { while (true) { delay(5*60*1000L); reconcileManifest(url,credential) } }
				configPollJob?.cancel();configPollJob=viewModelScope.launch{while(true){delay((mutablePlayerConfig.value?.sync?.manifestReconciliationSeconds?:300)*1000L);reconcilePlayerConfig(url,credential)}}
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
				if (text.contains("server.ping")) { webSocket.send("{\"type\":\"player.pong\"}");val interval=(mutablePlayerConfig.value?.sync?.statusReportSeconds?:60)*1000L;if(System.currentTimeMillis()-lastStatusSentAt>=interval){webSocket.send(Json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), statusMessage()));lastStatusSentAt=System.currentTimeMillis()} }
				if (text.contains("manifest.changed")) viewModelScope.launch { reconcileManifest(url, credential) }
				if(text.contains("commands.available"))viewModelScope.launch{runCommands(url,credential)}
				if(text.contains("config.changed"))viewModelScope.launch{reconcilePlayerConfig(url,credential)}
			}
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
				manifestPollJob?.cancel()
				configPollJob?.cancel()
                webSocket.close(code, reason)
                scheduleReconnect(url, screenName, credential, attempt + 1, reason)
            }
            override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
				manifestPollJob?.cancel()
				configPollJob?.cancel()
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
    fun resetServer() { viewModelScope.launch { socket?.cancel(); credentials.clear(); WebsiteDataManager.clear(getApplication()){};configuration.reset(); current = configuration.getOrCreate(); discover() } }

	private suspend fun reconcileManifest(url: String, credential: String) {
		if (syncJob?.isActive == true) return
		syncJob = viewModelScope.launch {
			val screenId = current?.screenId ?: return@launch
			try { val prepared = synchronizer.reconcile(url, credential, screenId) { syncProgress = it }; if (prepared != null) { val emergencyChanged=prepared.manifest.emergency?.id!=activeEmergencyId;if (mutableContent.value == null||emergencyChanged) activatePrepared(prepared, url, credential) else pendingContent = prepared } }
			catch(error:Exception){syncProgress=SyncProgress(cacheUsedBytes=syncProgress.cacheUsedBytes,error=error.message?:"Manifest synchronization failed")}
		}
		syncJob?.join()
	}

	private suspend fun activatePrepared(prepared: PreparedContent, url: String, credential: String) {
		synchronizer.activate(prepared)
		activeManifestVersion=prepared.manifest.manifestVersion
		clockOffsetSeconds=prepared.serverClockOffsetSeconds
		pendingContent = null
		activateScheduleSelection(prepared,url,credential)
		syncProgress = SyncProgress(cacheUsedBytes = syncProgress.cacheUsedBytes)
	}

	private fun activateScheduleSelection(prepared:PreparedContent,url:String,credential:String){
		scheduleContent=prepared;scheduleJob?.cancel();emergencyJob?.cancel()
		val emergency=EmergencyController.evaluate(Instant.now(),prepared.manifest.emergency,true)
		val selection=ScheduleEngine.resolve(Instant.now(),prepared.manifest.schedules,prepared.manifest.directFallbackPlaylist?.id?:prepared.manifest.playlist?.id)
		val available=prepared.manifest.playlists+listOfNotNull(prepared.manifest.directFallbackPlaylist,prepared.manifest.playlist)
		var playlist=available.firstOrNull{it.id==(emergency.playlistId?:selection.playlistId)}
		currentScheduleId=selection.scheduleId;currentPlaylistId=selection.playlistId;assignedPlaylistId=prepared.manifest.directFallbackPlaylist?.id;selectionSource=selection.source;nextTransition=selection.nextTransition;scheduleError=selection.error
		if(emergency.active){activeEmergencyId=prepared.manifest.emergency?.id;emergencyState="active";currentScheduleId=null;currentPlaylistId=playlist?.id;selectionSource="emergency";nextTransition=emergency.nextTransition}else{activeEmergencyId=null;emergencyState=null}
		if(selection.source=="schedule"&&(playlist==null||playlist.items.isEmpty())){playlist=prepared.manifest.directFallbackPlaylist?.takeIf{it.items.isNotEmpty()};currentPlaylistId=playlist?.id;selectionSource=if(playlist!=null)"direct_fallback" else "none";scheduleError="Scheduled playlist has no playable items"}
		val selected=PreparedContent(prepared.manifest.copy(playlist=playlist),prepared.localFiles,prepared.serverClockOffsetSeconds)
		mutableContent.value=if(mutablePlaybackDisabled.value&&!emergency.active)null else playlist?.takeIf{it.items.isNotEmpty()}?.let{PlaybackSession(selected,url,credential)}
		selection.nextTransition?.let{transition->scheduleJob=viewModelScope.launch{delay(Duration.between(Instant.now(),transition).toMillis().coerceAtLeast(0)+50);scheduleContent?.let{activateScheduleSelection(it,url,credential)}}}
		emergency.nextTransition?.let{transition->emergencyJob=viewModelScope.launch{delay(Duration.between(Instant.now(),transition).toMillis().coerceAtLeast(0)+50);scheduleContent?.let{activateScheduleSelection(it,url,credential)}}}
	}

	private suspend fun runCommands(url:String,credential:String){commandCoordinator.fetchAndRun(url,credential){command->
		lastCommandId=command.id;lastCommandState="running"
		val outcome=when(command.type){
			"sync_now"->{reconcileManifest(url,credential);CommandOutcome(true,"manifest_sync_started","Manifest synchronization started")}
			"reload_playback"->{val active=mutableContent.value;mutableContent.value=null;delay(100);mutableContent.value=active;CommandOutcome(true,"playback_reloaded","Playback reloaded")}
			"identify_screen"->{val seconds=command.payload["durationSeconds"]?:30;val location=mutablePlayerConfig.value?.playback?.takeIf{it.identifyShowsLocation}?.screenLocation.orEmpty();mutableIdentify.value="${current?.screenName ?: "Tilecast screen"}${if(location.isNotEmpty())"\n$location" else ""}\n${current?.screenId?.takeLast(8).orEmpty()}";viewModelScope.launch{delay(seconds*1000L);mutableIdentify.value=null};CommandOutcome(true,"screen_identified","Identification overlay displayed")}
			"clear_media_cache"->{val success=synchronizer.clearUnprotectedCache();reconcileManifest(url,credential);CommandOutcome(success,if(success)"cache_cleared" else "cache_cleanup_partial",if(success)"Unprotected media cache cleared" else "Some protected content was retained")}
			"clear_website_data"->{var success=false;WebsiteDataManager.clear(getApplication()){success=it};delay(250);CommandOutcome(success,if(success)"website_data_cleared" else "website_data_clear_failed",if(success)"Website data cleared" else "Website data could not be cleared")}
			"disable_playback"->{commandCoordinator.setPlaybackDisabled(true);mutablePlaybackDisabled.value=true;scheduleContent?.let{activateScheduleSelection(it,url,credential)};CommandOutcome(true,"playback_disabled","Playback disabled")}
			"enable_playback"->{commandCoordinator.setPlaybackDisabled(false);mutablePlaybackDisabled.value=false;scheduleContent?.let{activateScheduleSelection(it,url,credential)};CommandOutcome(true,"playback_enabled","Playback enabled")}
			else->CommandOutcome(false,"command_unsupported","Command is not supported")}
		lastCommandState=if(outcome.success)"succeeded" else "failed";lastCommandResult=outcome.code;lastCommandCompletedAt=Instant.now().toString();outcome
	}}
	private suspend fun reconcilePlayerConfig(url:String,credential:String){try{configManager.reconcile(url,credential)?.let{mutablePlayerConfig.value=it;applyPlayerConfig(it)};configurationError=null}catch(_:Exception){configurationError="Player configuration could not be applied"}}
	private fun applyPlayerConfig(config:PlayerConfig){activeConfigRevision=config.configRevision;synchronizer.applyPolicy(config.cache.maximumBytes,config.cache.minimumFreeBytes,config.cache.automaticThresholdBytes,config.cache.concurrentDownloads);if(config.website.clearOnRestart)WebsiteDataManager.clear(getApplication()){} }

	fun playbackBoundary(itemId: String, assetId: String) {
		currentItemId=itemId;currentAssetId=assetId
		val pending=pendingContent ?: return
		val url=current?.serverUrl ?: return;val credential=credentials.read() ?: return
		viewModelScope.launch { activatePrepared(pending,url,credential) }
	}
	fun playbackError(message:String){lastPlaybackError=message}
	fun websitePlaybackStatus(status:WebsitePlaybackStatus){websiteStatus=status}
	fun recalculateSchedule(){val prepared=scheduleContent?:return;val url=current?.serverUrl?:return;val credential=credentials.read()?:return;activateScheduleSelection(prepared,url,credential)}

    private fun deviceMetadata(playerId: String): DeviceMetadata { val metrics = getApplication<Application>().resources.displayMetrics; return DeviceMetadata(playerId, if (Build.MANUFACTURER.equals("Amazon", true)) "fire-tv" else "android-tv", Build.MANUFACTURER ?: "Unknown", Build.MODEL ?: "Unknown", Build.VERSION.RELEASE ?: Build.VERSION.SDK_INT.toString(), BuildConfig.VERSION_NAME, metrics.widthPixels, metrics.heightPixels, metrics.density, Locale.getDefault().toLanguageTag(), TimeZone.getDefault().id) }
	private fun heartbeat(): HeartbeatRequest { val app = getApplication<Application>(); val metrics = app.resources.displayMetrics; return HeartbeatRequest(metrics.widthPixels, metrics.heightPixels, app.filesDir.usableSpace, SystemClock.elapsedRealtime() / 1000, BuildConfig.VERSION_NAME,activeManifestVersion=activeManifestVersion,pendingManifestVersion=pendingContent?.manifest?.manifestVersion,assignedPlaylistId=assignedPlaylistId,currentItemId=currentItemId,currentAssetId=currentAssetId,playbackState=if(mutableContent.value!=null)"playing" else if(mutablePlaybackDisabled.value)"disabled" else "idle",downloadQueueCount=syncProgress.queueCount,downloadedBytes=syncProgress.downloadedBytes,requiredBytes=syncProgress.requiredBytes,cacheUsedBytes=syncProgress.cacheUsedBytes,cacheLimitBytes=mutablePlayerConfig.value?.cache?.maximumBytes?:BuildConfig.MEDIA_CACHE_BYTES,lastSynchronizationError=syncProgress.error,lastPlaybackError=lastPlaybackError,currentScheduleId=currentScheduleId,currentPlaylistId=currentPlaylistId,selectionSource=selectionSource,nextTransitionAt=nextTransition?.toString(),deviceClockOffsetSeconds=clockOffsetSeconds,scheduleEvaluationError=scheduleError,scheduleManifestVersion=activeManifestVersion,currentWebsiteAssetId=websiteStatus.assetId,websiteState=websiteStatus.state,websiteLoadStartedAt=websiteStatus.loadStartedAt,websiteLoadCompletedAt=websiteStatus.loadCompletedAt,websiteFailureCategory=websiteStatus.failureCategory,websiteBlockedNavigationCount=websiteStatus.blockedNavigationCount,websiteCurrentHost=websiteStatus.currentHost,websiteFallbackShown=websiteStatus.fallbackShown,websiteRendererRecoveryCount=websiteStatus.rendererRecoveryCount,activeEmergencyId=activeEmergencyId,emergencyState=emergencyState,emergencyPreparationProgress=if(emergencyState=="active")100 else null,playbackDisabled=mutablePlaybackDisabled.value,lastCommandId=lastCommandId,lastCommandState=lastCommandState,lastCommandResult=lastCommandResult,lastCommandCompletedAt=lastCommandCompletedAt,activeConfigRevision=activeConfigRevision,configurationError=configurationError) }
    private fun statusMessage() = kotlinx.serialization.json.buildJsonObject {
		put("type", "player.status")
		put("payload", kotlinx.serialization.json.buildJsonObject {
			val h = heartbeat(); put("screenWidth", h.screenWidth); put("screenHeight", h.screenHeight)
			put("availableStorageBytes", h.availableStorageBytes ?: 0); put("uptimeSeconds", h.uptimeSeconds ?: 0); put("playerVersion", h.playerVersion)
			activeManifestVersion?.let { put("activeManifestVersion", it) }; assignedPlaylistId?.let { put("assignedPlaylistId", it) }
			pendingContent?.let { put("pendingManifestVersion", it.manifest.manifestVersion) }; currentItemId?.let { put("currentItemId", it) }; currentAssetId?.let { put("currentAssetId", it) }
			put("playbackState", if (mutableContent.value != null) "playing" else "idle"); put("downloadQueueCount", syncProgress.queueCount); put("downloadedBytes", syncProgress.downloadedBytes); put("requiredBytes", syncProgress.requiredBytes)
			put("cacheUsedBytes", syncProgress.cacheUsedBytes); put("cacheLimitBytes", BuildConfig.MEDIA_CACHE_BYTES); syncProgress.error?.let { put("lastSynchronizationError", it) }; lastPlaybackError?.let { put("lastPlaybackError", it) }
			currentScheduleId?.let{put("currentScheduleId",it)};currentPlaylistId?.let{put("currentPlaylistId",it)};put("selectionSource",selectionSource);nextTransition?.let{put("nextTransitionAt",it.toString())};clockOffsetSeconds?.let{put("deviceClockOffsetSeconds",it)};scheduleError?.let{put("scheduleEvaluationError",it)};activeManifestVersion?.let{put("scheduleManifestVersion",it)}
			websiteStatus.assetId?.let{put("currentWebsiteAssetId",it)};put("websiteState",websiteStatus.state);websiteStatus.loadStartedAt?.let{put("websiteLoadStartedAt",it)};websiteStatus.loadCompletedAt?.let{put("websiteLoadCompletedAt",it)};websiteStatus.failureCategory?.let{put("websiteFailureCategory",it)};put("websiteBlockedNavigationCount",websiteStatus.blockedNavigationCount);websiteStatus.currentHost?.let{put("websiteCurrentHost",it)};put("websiteFallbackShown",websiteStatus.fallbackShown);put("websiteRendererRecoveryCount",websiteStatus.rendererRecoveryCount)
			activeEmergencyId?.let{put("activeEmergencyId",it)};emergencyState?.let{put("emergencyState",it)};if(emergencyState=="active")put("emergencyPreparationProgress",100);put("playbackDisabled",mutablePlaybackDisabled.value);lastCommandId?.let{put("lastCommandId",it)};lastCommandState?.let{put("lastCommandState",it)};lastCommandResult?.let{put("lastCommandResult",it)};lastCommandCompletedAt?.let{put("lastCommandCompletedAt",it)}
			activeConfigRevision?.let{put("activeConfigRevision",it)};configurationError?.let{put("configurationError",it)}
		})
	}
}
