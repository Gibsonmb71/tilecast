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
@Serializable data class HeartbeatRequest(val screenWidth: Int, val screenHeight: Int, val availableStorageBytes: Long? = null, val uptimeSeconds: Long? = null, val playerVersion: String)

class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)
