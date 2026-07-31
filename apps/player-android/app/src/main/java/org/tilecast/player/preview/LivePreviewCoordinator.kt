package org.tilecast.player.preview

import android.app.Activity
import android.graphics.Bitmap
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.tilecast.player.BuildConfig
import org.tilecast.player.data.ConfigurationRepository
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.network.PreviewSession
import org.tilecast.player.network.TilecastApi
import org.tilecast.player.security.KeystoreCredentialStore
import java.io.ByteArrayOutputStream
import java.time.Instant
import kotlin.math.roundToInt

private const val MAX_PREVIEW_WIDTH = 960
private const val MAX_PREVIEW_HEIGHT = 540
private const val MAX_PREVIEW_BYTES = 500 * 1024
private const val SESSION_POLL_MILLIS = 5_000L

internal data class PreviewDimensions(val width: Int, val height: Int)
internal data class EncodedPreview(val bytes: ByteArray, val width: Int, val height: Int)

internal fun previewDimensions(width: Int, height: Int): PreviewDimensions {
    return scaledDimensions(width, height, MAX_PREVIEW_WIDTH, MAX_PREVIEW_HEIGHT)
}

internal class LivePreviewCoordinator(
    private val activity: Activity,
    private val blockReason: () -> String?,
    private val api: TilecastApi = TilecastApi(),
    private val captureSource: PlayerWindowCapture = PlayerWindowCapture(activity),
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val configuration = ConfigurationRepository(PlayerDatabase.get(activity).configuration())
    private val credentials = KeystoreCredentialStore(activity)
    private var pollingJob: Job? = null
    private var lastCaptureElapsed = 0L
    private var forceCaptureSeen = false

    fun start() {
        if (pollingJob?.isActive == true) return
        pollingJob = scope.launch { pollSessions() }
    }

    fun stop() {
        pollingJob?.cancel()
        pollingJob = null
        lastCaptureElapsed = 0L
        forceCaptureSeen = false
    }

    fun close() {
        stop()
        scope.cancel()
    }

    private suspend fun pollSessions() {
        while (scope.isActive) {
            val saved = runCatching { configuration.getOrCreate() }.getOrNull()
            val serverUrl = saved?.serverUrl
            val credential = credentials.read()
            if (serverUrl == null || credential == null) {
                delay(SESSION_POLL_MILLIS)
                continue
            }
            val session = runCatching { api.previewSession(serverUrl, credential) }.getOrNull()
            if (session == null || !session.isActive()) {
                lastCaptureElapsed = 0L
                forceCaptureSeen = false
                delay(SESSION_POLL_MILLIS)
                continue
            }

            if (!session.captureNow) forceCaptureSeen = false
            val now = SystemClock.elapsedRealtime()
            val intervalMillis = session.captureIntervalSeconds.coerceAtLeast(10) * 1_000L
            val forceDue = session.captureNow && !forceCaptureSeen
            val intervalDue = lastCaptureElapsed == 0L || now - lastCaptureElapsed >= intervalMillis
            if (forceDue || intervalDue) {
                if (forceDue) forceCaptureSeen = true
                if (captureAndUpload(serverUrl, credential)) {
                    lastCaptureElapsed = SystemClock.elapsedRealtime()
                } else if (forceDue) {
                    forceCaptureSeen = false
                }
            }
            delay(SESSION_POLL_MILLIS)
        }
    }

    private fun PreviewSession.isActive(): Boolean {
        if (!active) return false
        val expiry = expiresAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return false
        return expiry.isAfter(Instant.now())
    }

    private suspend fun captureAndUpload(serverUrl: String, credential: String): Boolean {
        blockReason()?.let { reason ->
            return runCatching {
                api.uploadPreview(
                    serverUrl = serverUrl,
                    credential = credential,
                    playerVersion = BuildConfig.VERSION_NAME,
                    failureStatus = reason,
                )
            }.isSuccess
        }

        return when (val captured = captureSource.capture(MAX_PREVIEW_WIDTH, MAX_PREVIEW_HEIGHT)) {
            is WindowCapture.Failure -> runCatching {
                api.uploadPreview(
                    serverUrl = serverUrl,
                    credential = credential,
                    playerVersion = BuildConfig.VERSION_NAME,
                    failureStatus = captured.status,
                )
            }.isSuccess
            is WindowCapture.Success -> {
                try {
                    blockReason()?.let { reason ->
                        return runCatching {
                            api.uploadPreview(
                                serverUrl = serverUrl,
                                credential = credential,
                                playerVersion = BuildConfig.VERSION_NAME,
                                failureStatus = reason,
                            )
                        }.isSuccess
                    }
                    val encoded = withContext(Dispatchers.Default) { encodePreview(captured.bitmap) }
                    if (encoded == null) {
                        runCatching {
                            api.uploadPreview(
                                serverUrl = serverUrl,
                                credential = credential,
                                playerVersion = BuildConfig.VERSION_NAME,
                                failureStatus = "image_too_large",
                            )
                        }.isSuccess
                    } else {
                        runCatching {
                            api.uploadPreview(
                                serverUrl = serverUrl,
                                credential = credential,
                                playerVersion = BuildConfig.VERSION_NAME,
                                capturedAt = Instant.now().toString(),
                                width = encoded.width,
                                height = encoded.height,
                                image = encoded.bytes,
                            )
                        }.isSuccess
                    }
                } finally {
                    captured.bitmap.recycle()
                }
            }
        }
    }

}

internal fun encodePreview(source: Bitmap): EncodedPreview? {
    var current = source
    var ownsCurrent = false
    try {
        repeat(6) {
            for (quality in intArrayOf(75, 65, 55, 45)) {
                val output = ByteArrayOutputStream()
                if (current.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                    val bytes = output.toByteArray()
                    if (bytes.size <= MAX_PREVIEW_BYTES) {
                        return EncodedPreview(bytes, current.width, current.height)
                    }
                }
            }
            if (current.width <= 240 || current.height <= 135) return null
            val next = Bitmap.createScaledBitmap(
                current,
                (current.width * 0.8).roundToInt().coerceAtLeast(1),
                (current.height * 0.8).roundToInt().coerceAtLeast(1),
                true,
            )
            if (ownsCurrent) current.recycle()
            current = next
            ownsCurrent = true
        }
        return null
    } finally {
        if (ownsCurrent) current.recycle()
    }
}
