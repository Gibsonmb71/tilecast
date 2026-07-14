package org.tilecast.player.preview

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.tilecast.player.BuildConfig
import org.tilecast.player.data.ConfigurationRepository
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.network.PreviewSession
import org.tilecast.player.network.TilecastApi
import org.tilecast.player.security.KeystoreCredentialStore
import java.io.ByteArrayOutputStream
import java.time.Instant
import kotlin.coroutines.resume
import kotlin.math.min
import kotlin.math.roundToInt

private const val MAX_PREVIEW_WIDTH = 960
private const val MAX_PREVIEW_HEIGHT = 540
private const val MAX_PREVIEW_BYTES = 500 * 1024
private const val SESSION_POLL_MILLIS = 5_000L

internal data class PreviewDimensions(val width: Int, val height: Int)
internal data class EncodedPreview(val bytes: ByteArray, val width: Int, val height: Int)

internal fun previewDimensions(width: Int, height: Int): PreviewDimensions {
    require(width > 0 && height > 0)
    val scale = min(1.0, min(MAX_PREVIEW_WIDTH.toDouble() / width, MAX_PREVIEW_HEIGHT.toDouble() / height))
    return PreviewDimensions(
        width = (width * scale).roundToInt().coerceAtLeast(1),
        height = (height * scale).roundToInt().coerceAtLeast(1),
    )
}

class LivePreviewCoordinator(
    private val activity: Activity,
    private val blockReason: () -> String?,
    private val api: TilecastApi = TilecastApi(),
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val configuration = ConfigurationRepository(PlayerDatabase.get(activity).configuration())
    private val credentials = KeystoreCredentialStore(activity)
    private val mainHandler = Handler(Looper.getMainLooper())
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

        return when (val captured = captureWindow()) {
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

    private suspend fun captureWindow(): WindowCapture = withContext(Dispatchers.Main.immediate) {
        val view = activity.window.decorView
        if (!view.isAttachedToWindow || view.width < 1 || view.height < 1) {
            return@withContext WindowCapture.Failure("window_unavailable")
        }
        val dimensions = previewDimensions(view.width, view.height)
        val bitmap = runCatching {
            Bitmap.createBitmap(dimensions.width, dimensions.height, Bitmap.Config.ARGB_8888)
        }.getOrElse { return@withContext WindowCapture.Failure("bitmap_allocation_failed") }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            captureWithPixelCopy(view, bitmap)
        } else {
            captureWithCanvas(view, bitmap)
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private suspend fun captureWithPixelCopy(root: View, bitmap: Bitmap): WindowCapture {
        val windowResult = copyWindow(bitmap)
        if (windowResult != PixelCopy.SUCCESS) {
            bitmap.recycle()
            return WindowCapture.Failure("pixel_copy_$windowResult")
        }

        val surfaces = visibleSurfaceViews(root)
        overlaySurfaceViews(root, surfaces, bitmap)
        if (surfaces.isNotEmpty() && isNearlyBlack(bitmap)) {
            delay(250)
            if (copyWindow(bitmap) == PixelCopy.SUCCESS) {
                overlaySurfaceViews(root, surfaces, bitmap)
            }
        }
        if (surfaces.isNotEmpty() && isNearlyBlack(bitmap)) {
            bitmap.recycle()
            return WindowCapture.Failure("blank_video_frame")
        }
        return WindowCapture.Success(bitmap)
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private suspend fun copyWindow(bitmap: Bitmap): Int =
        suspendCancellableCoroutine { continuation ->
            PixelCopy.request(
                activity.window,
                bitmap,
                { result -> if (continuation.isActive) continuation.resume(result) },
                mainHandler,
            )
        }

    @RequiresApi(Build.VERSION_CODES.O)
    private suspend fun copySurface(surface: SurfaceView, bitmap: Bitmap): Int =
        suspendCancellableCoroutine { continuation ->
            PixelCopy.request(
                surface,
                bitmap,
                { result -> if (continuation.isActive) continuation.resume(result) },
                mainHandler,
            )
        }

    @RequiresApi(Build.VERSION_CODES.O)
    private suspend fun overlaySurfaceViews(root: View, surfaces: List<SurfaceView>, destination: Bitmap) {
        if (surfaces.isEmpty()) return
        val rootLocation = IntArray(2).also(root::getLocationInWindow)
        val scaleX = destination.width.toFloat() / root.width
        val scaleY = destination.height.toFloat() / root.height
        val canvas = Canvas(destination)
        for (surface in surfaces) {
            val location = IntArray(2).also(surface::getLocationInWindow)
            val width = (surface.width * scaleX).roundToInt().coerceAtLeast(1)
            val height = (surface.height * scaleY).roundToInt().coerceAtLeast(1)
            val layer = runCatching {
                Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            }.getOrNull() ?: continue
            try {
                if (copySurface(surface, layer) != PixelCopy.SUCCESS) continue
                val left = (location[0] - rootLocation[0]) * scaleX
                val top = (location[1] - rootLocation[1]) * scaleY
                canvas.drawBitmap(layer, left, top, null)
            } finally {
                layer.recycle()
            }
        }
    }

    private fun captureWithCanvas(view: View, bitmap: Bitmap): WindowCapture = runCatching {
        val canvas = Canvas(bitmap)
        canvas.scale(bitmap.width.toFloat() / view.width, bitmap.height.toFloat() / view.height)
        view.draw(canvas)
        WindowCapture.Success(bitmap)
    }.getOrElse {
        bitmap.recycle()
        WindowCapture.Failure("view_draw_failed")
    }
}

private fun visibleSurfaceViews(root: View): List<SurfaceView> {
    val result = mutableListOf<SurfaceView>()
    fun visit(view: View) {
        if (view is SurfaceView && view.isShown && view.width > 0 && view.height > 0) result += view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) visit(view.getChildAt(index))
        }
    }
    visit(root)
    return result
}

internal fun isNearlyBlack(bitmap: Bitmap): Boolean {
    val columns = 12
    val rows = 8
    var dark = 0
    var sampled = 0
    for (column in 0 until columns) {
        val x = ((column + 0.5f) * bitmap.width / columns).toInt().coerceIn(0, bitmap.width - 1)
        for (row in 0 until rows) {
            val y = ((row + 0.5f) * bitmap.height / rows).toInt().coerceIn(0, bitmap.height - 1)
            val pixel = bitmap.getPixel(x, y)
            val brightness = (android.graphics.Color.red(pixel) + android.graphics.Color.green(pixel) + android.graphics.Color.blue(pixel)) / 3
            if (brightness <= 10) dark++
            sampled++
        }
    }
    return sampled > 0 && dark * 100 / sampled >= 98
}

private sealed interface WindowCapture {
    data class Success(val bitmap: Bitmap) : WindowCapture
    data class Failure(val status: String) : WindowCapture
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
