package org.tilecast.player.preview

import android.app.Activity
import android.graphics.Bitmap
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.tilecast.player.data.ConfigurationRepository
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.network.LiveStreamSession
import org.tilecast.player.network.TilecastApi
import org.tilecast.player.security.KeystoreCredentialStore
import java.io.ByteArrayOutputStream
import java.time.Instant
import kotlin.math.roundToInt

private const val ACTIVE_RECONCILE_MILLIS = 5_000L
private const val IDLE_RECONCILE_MILLIS = 15_000L
private const val MIN_FRAME_INTERVAL_MILLIS = 125
private const val MIN_CAPTURE_PAUSE_MILLIS = 25L
private const val LOCAL_MAX_WIDTH = 640
private const val LOCAL_MAX_HEIGHT = 360
private const val LOCAL_MAX_FRAME_BYTES = 100 * 1024

/**
 * A separate, storage-free live video-like channel for Studio. Frames leave
 * only through the authenticated player socket and exist only while Studio
 * renews the short session lease.
 */
internal class LiveStreamCoordinator(
    activity: Activity,
    private val blockReason: () -> String?,
    private val sendFrame: (String, Long, Int, Int, ByteArray) -> Boolean,
    private val api: TilecastApi = TilecastApi(),
    private val captureSource: PlayerWindowCapture = PlayerWindowCapture(activity),
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val configuration = ConfigurationRepository(PlayerDatabase.get(activity).configuration())
    private val credentials = KeystoreCredentialStore(activity)
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var pollingJob: Job? = null
    private var captureJob: Job? = null
    private var session: LiveStreamSession? = null

    fun start() {
        if (pollingJob?.isActive == true) return
        pollingJob = scope.launch { reconcileSessions() }
    }

    fun sessionChanged() {
        wake.trySend(Unit)
    }

    fun stop() {
        pollingJob?.cancel()
        pollingJob = null
        captureJob?.cancel()
        captureJob = null
        session = null
    }

    fun close() {
        stop()
        scope.cancel()
    }

    private suspend fun reconcileSessions() {
        while (scope.isActive) {
            val saved = runCatching { configuration.getOrCreate() }.getOrNull()
            val serverUrl = saved?.serverUrl
            val credential = credentials.read()
            val current = if (serverUrl != null && credential != null) {
                runCatching { api.liveStreamSession(serverUrl, credential) }.getOrNull()
            } else {
                null
            }
            applySession(current?.takeIf { it.isSessionActive() })
            val delayMillis = if (session != null) ACTIVE_RECONCILE_MILLIS else IDLE_RECONCILE_MILLIS
            withTimeoutOrNull(delayMillis) { wake.receive() }
        }
    }

    private fun applySession(next: LiveStreamSession?) {
        if (session?.id == next?.id) {
            session = next
            return
        }
        captureJob?.cancel()
        captureJob = null
        session = next
        if (next != null) {
            captureJob = scope.launch { captureFrames(next.id ?: return@launch) }
        }
    }

    private suspend fun captureFrames(sessionId: String) {
        while (scope.isActive) {
            val current = session
            if (current?.id != sessionId || !current.isSessionActive()) return
            val interval = current.frameIntervalMillis.coerceAtLeast(MIN_FRAME_INTERVAL_MILLIS)
            val startedAt = SystemClock.elapsedRealtime()
            if (blockReason() == null) {
                when (
                    val captured = captureSource.capture(
                        current.maxWidth.coerceIn(1, LOCAL_MAX_WIDTH),
                        current.maxHeight.coerceIn(1, LOCAL_MAX_HEIGHT),
                    )
                ) {
                    is WindowCapture.Failure -> Unit
                    is WindowCapture.Success -> {
                        try {
                            val encoded = withContext(Dispatchers.Default) {
                                encodeLiveStreamFrame(
                                    captured.bitmap,
                                    current.maxFrameBytes.coerceIn(1, LOCAL_MAX_FRAME_BYTES),
                                )
                            }
                            if (encoded != null && blockReason() == null && session?.id == sessionId) {
                                sendFrame(
                                    sessionId,
                                    System.currentTimeMillis(),
                                    encoded.width,
                                    encoded.height,
                                    encoded.bytes,
                                )
                            }
                        } finally {
                            captured.bitmap.recycle()
                        }
                    }
                }
            }
            val elapsed = SystemClock.elapsedRealtime() - startedAt
            delay((interval - elapsed).coerceAtLeast(MIN_CAPTURE_PAUSE_MILLIS))
        }
    }

    private fun LiveStreamSession.isSessionActive(): Boolean {
        if (!active || id.isNullOrBlank()) return false
        val expiry = expiresAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return false
        return expiry.isAfter(Instant.now())
    }
}

internal fun encodeLiveStreamFrame(source: Bitmap, maxBytes: Int): EncodedPreview? {
    var current = source
    var ownsCurrent = false
    try {
        repeat(4) {
            for (quality in intArrayOf(50, 42, 34, 28)) {
                val output = ByteArrayOutputStream()
                if (current.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                    val bytes = output.toByteArray()
                    if (bytes.size <= maxBytes) {
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
