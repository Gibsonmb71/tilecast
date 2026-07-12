package org.tilecast.player.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class TilecastApi(
    private val client: OkHttpClient = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build(),
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
) {
    private val mediaType = "application/json".toMediaType()

    suspend fun identity(serverUrl: String): ServerIdentity = get(serverUrl, "/api/v1/system/identity")

    suspend fun createPairing(serverUrl: String, installationId: String, metadata: DeviceMetadata): PairingSession =
        post(serverUrl, "/api/v1/player/pairing-sessions", json.encodeToString(PairingCreateRequest.serializer(), PairingCreateRequest(installationId, metadata)))

    suspend fun pollPairing(serverUrl: String, sessionId: String, pollSecret: String): PairingPoll =
        get(serverUrl, "/api/v1/player/pairing-sessions/$sessionId", "Pairing $pollSecret")

    suspend fun enroll(serverUrl: String, sessionId: String, token: String): EnrollmentResult =
        post(serverUrl, "/api/v1/player/enroll", json.encodeToString(EnrollmentRequest.serializer(), EnrollmentRequest(sessionId, token)))

    suspend fun heartbeat(serverUrl: String, credential: String, heartbeat: HeartbeatRequest) {
        post<kotlinx.serialization.json.JsonObject>(serverUrl, "/api/v1/player/heartbeat", json.encodeToString(HeartbeatRequest.serializer(), heartbeat), "Bearer $credential")
    }

    fun socket(serverUrl: String, credential: String, listener: okhttp3.WebSocketListener): okhttp3.WebSocket {
        val socketUrl = serverUrl.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://") + "/api/v1/player/socket"
        return client.newWebSocket(Request.Builder().url(socketUrl).header("Authorization", "Bearer $credential").build(), listener)
    }

    private suspend inline fun <reified T> get(serverUrl: String, path: String, authorization: String? = null): T = execute(
        Request.Builder().url(serverUrl + path).apply { if (authorization != null) header("Authorization", authorization) }.get().build(),
    )

    private suspend inline fun <reified T> post(serverUrl: String, path: String, body: String, authorization: String? = null): T = execute(
        Request.Builder().url(serverUrl + path).apply { if (authorization != null) header("Authorization", authorization) }.post(body.toRequestBody(mediaType)).build(),
    )

    private suspend inline fun <reified T> execute(request: Request): T = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val error = runCatching { json.decodeFromString(ErrorEnvelope.serializer(), body).error }.getOrNull()
                throw ApiException(response.code, error?.code ?: "http_${response.code}", error?.message ?: "Tilecast returned HTTP ${response.code}")
            }
            json.decodeFromString(DataEnvelope.serializer(kotlinx.serialization.serializer<T>()), body).data
        }
    }
}

