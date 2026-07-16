package org.tilecast.player.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

private val activityJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }
private val activityClient = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()

suspend fun TilecastApi.activityEvents(serverUrl: String, credential: String, batch: PlayerActivityBatch): PlayerActivityAck = withContext(Dispatchers.IO) {
    val request = Request.Builder()
        .url(serverUrl + "/api/v1/player/activity-events")
        .header("Authorization", "Bearer $credential")
        .post(activityJson.encodeToString(PlayerActivityBatch.serializer(), batch).toRequestBody("application/json".toMediaType()))
        .build()
    activityClient.newCall(request).execute().use { response ->
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) throw ApiException(response.code, "activity_upload_failed", "Player activity upload failed with HTTP ${response.code}")
        activityJson.decodeFromString(DataEnvelope.serializer(PlayerActivityAck.serializer()), body).data
    }
}
