package org.tilecast.player.network

import kotlinx.serialization.Serializable

@Serializable data class DataEnvelope<T>(val data: T)
@Serializable data class ErrorEnvelope(val error: ApiErrorBody? = null)
@Serializable data class ApiErrorBody(val code: String = "unknown_error", val message: String = "Tilecast could not complete the request")
@Serializable data class ServerIdentity(val product: String, val installationId: String, val organizationName: String, val apiVersion: String, val pairingEnabled: Boolean)
@Serializable data class DeviceMetadata(val playerInstallationId: String, val platform: String, val manufacturer: String, val model: String, val androidVersion: String, val playerVersion: String, val screenWidth: Int, val screenHeight: Int, val density: Float, val locale: String, val timezone: String)
@Serializable data class PairingCreateRequest(val installationId: String, val metadata: DeviceMetadata)
@Serializable data class PairingSession(val id: String, val code: String, val pollSecret: String, val expiresAt: String, val serverTime: String, val pollingIntervalSeconds: Int, val approvalUrl: String, val organizationName: String)
@Serializable data class PairingPoll(val status: String, val expiresAt: String, val screenId: String? = null, val enrollmentToken: String? = null, val failureReason: String? = null)
@Serializable data class EnrollmentRequest(val pairingSessionId: String, val enrollmentToken: String)
@Serializable data class EnrollmentResult(val screenId: String, val screenName: String, val deviceCredential: String)
@Serializable data class HeartbeatRequest(val screenWidth: Int, val screenHeight: Int, val availableStorageBytes: Long? = null, val uptimeSeconds: Long? = null, val playerVersion: String,
    val activeManifestVersion: Long? = null, val pendingManifestVersion: Long? = null, val assignedPlaylistId: String? = null,
    val currentItemId: String? = null, val currentAssetId: String? = null, val playbackState: String? = null,
    val downloadQueueCount: Int? = null, val downloadedBytes: Long? = null, val requiredBytes: Long? = null,
    val cacheUsedBytes: Long? = null, val cacheLimitBytes: Long? = null, val lastSynchronizationError: String? = null, val lastPlaybackError: String? = null,
    val currentScheduleId:String?=null,val currentPlaylistId:String?=null,val selectionSource:String?=null,val nextTransitionAt:String?=null,val deviceClockOffsetSeconds:Long?=null,val scheduleEvaluationError:String?=null,val scheduleManifestVersion:Long?=null,
    val currentWebsiteAssetId:String?=null,val websiteState:String?=null,val websiteLoadStartedAt:String?=null,val websiteLoadCompletedAt:String?=null,val websiteFailureCategory:String?=null,val websiteBlockedNavigationCount:Int?=null,val websiteCurrentHost:String?=null,val websiteFallbackShown:Boolean?=null,val websiteRendererRecoveryCount:Int?=null)

@Serializable data class PlayerManifest(val schemaVersion: Int, val manifestVersion: Long, val screenId: String, val generatedAt: String, val mode: String, val playlist: ManifestPlaylist? = null, val directFallbackPlaylist:ManifestPlaylist?=null,val playlists:List<ManifestPlaylist> = emptyList(),val schedules:List<ManifestSchedule> = emptyList(),val assets: List<ManifestAsset> = emptyList(),val websites:List<ManifestWebsite> = emptyList(),val serverTime:String?=null,val prefetchHorizonDays:Int=14,val activationGraceSeconds:Int=30)
@Serializable data class ManifestPlaylist(val id: String, val revision: Long, val name: String, val items: List<ManifestItem>)
@Serializable data class ManifestSchedule(val id:String,val playlistId:String,val type:String,val timezone:String,val priority:Int,val specificity:Int,val startDate:String?=null,val endDate:String?=null,val oneTimeStart:String?=null,val oneTimeEnd:String?=null,val dailyStart:String?=null,val dailyEnd:String?=null,val daysOfWeek:List<Int> = emptyList())
@Serializable data class ManifestItem(val id: String, val assetId: String, val variantId: String?=null,val assetType:String="", val durationMs: Long? = null, val fitMode: String, val transition: String, val audioEnabled: Boolean, val volume: Float, val videoStartOffsetMs: Long? = null, val videoEndOffsetMs: Long? = null, val deliveryPolicy: String)
@Serializable data class ManifestWebsite(val assetId:String,val name:String,val url:String,val allowedHosts:List<String>,val javascriptEnabled:Boolean,val domStorageEnabled:Boolean,val cookiePolicy:String,val reloadPolicy:String,val refreshIntervalSeconds:Int?=null,val loadTimeoutSeconds:Int,val zoomPercent:Int,val scrollX:Int,val scrollY:Int,val customUserAgent:String="",val backgroundColor:String="#13231E",val failureBehavior:String,val fallbackImageAssetId:String?=null,val fallbackVariantId:String?=null)
@Serializable data class ManifestAsset(val assetId: String, val variantId: String, val mimeType: String, val sha256: String, val fileSize: Long, val width: Int? = null, val height: Int? = null, val durationSeconds: Double? = null, val downloadPath: String)
data class ManifestResponse(val manifest: PlayerManifest?, val rawJson: String?, val etag: String?, val notModified: Boolean)

@Serializable data class PlayerRuntimeStatus(
    val activeManifestVersion: Long? = null, val pendingManifestVersion: Long? = null, val assignedPlaylistId: String? = null,
    val currentItemId: String? = null, val currentAssetId: String? = null, val playbackState: String? = null,
    val downloadQueueCount: Int? = null, val downloadedBytes: Long? = null, val requiredBytes: Long? = null,
    val cacheUsedBytes: Long? = null, val cacheLimitBytes: Long? = null, val lastSynchronizationError: String? = null,
    val lastPlaybackError: String? = null,val currentScheduleId:String?=null,val currentPlaylistId:String?=null,val selectionSource:String?=null,val nextTransitionAt:String?=null,val deviceClockOffsetSeconds:Long?=null,val scheduleEvaluationError:String?=null,val scheduleManifestVersion:Long?=null,
    val currentWebsiteAssetId:String?=null,val websiteState:String?=null,val websiteLoadStartedAt:String?=null,val websiteLoadCompletedAt:String?=null,val websiteFailureCategory:String?=null,val websiteBlockedNavigationCount:Int?=null,val websiteCurrentHost:String?=null,val websiteFallbackShown:Boolean?=null,val websiteRendererRecoveryCount:Int?=null,
)

class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)
