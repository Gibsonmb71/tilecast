from pathlib import Path

preview = Path("apps/player-android/app/src/main/java/org/tilecast/player/preview/LivePreviewCoordinator.kt")
text = preview.read_text()
text = text.replace("import android.view.PixelCopy\nimport android.view.View\n", "import android.view.PixelCopy\nimport android.view.SurfaceView\nimport android.view.View\nimport android.view.ViewGroup\n")
text = text.replace("            captureWithPixelCopy(bitmap)\n", "            captureWithPixelCopy(view, bitmap)\n")
old = '''    @RequiresApi(Build.VERSION_CODES.O)
    private suspend fun captureWithPixelCopy(bitmap: Bitmap): WindowCapture =
        suspendCancellableCoroutine { continuation ->
            PixelCopy.request(
                activity.window,
                bitmap,
                { result ->
                    if (!continuation.isActive) {
                        if (!bitmap.isRecycled) bitmap.recycle()
                    } else if (result == PixelCopy.SUCCESS) {
                        continuation.resume(WindowCapture.Success(bitmap))
                    } else {
                        bitmap.recycle()
                        continuation.resume(WindowCapture.Failure("pixel_copy_$result"))
                    }
                },
                mainHandler,
            )
            continuation.invokeOnCancellation {
                if (!bitmap.isRecycled) bitmap.recycle()
            }
        }
'''
new = '''    @RequiresApi(Build.VERSION_CODES.O)
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
'''
if old not in text:
    raise SystemExit("PixelCopy implementation marker not found")
text = text.replace(old, new)
marker = '''private sealed interface WindowCapture {
'''
helpers = '''private fun visibleSurfaceViews(root: View): List<SurfaceView> {
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

'''
if marker not in text:
    raise SystemExit("WindowCapture marker not found")
preview.write_text(text.replace(marker, helpers + marker, 1))

screens = Path("apps/server/internal/devices/screens.go")
text = screens.read_text()
old = 'rows, err := s.db.Query(ctx, screenSelect+` ORDER BY s.name ASC LIMIT 500`)'
new = 'rows, err := s.db.Query(ctx, screenSelect+` WHERE EXISTS (SELECT 1 FROM device_credentials c WHERE c.screen_id=s.id AND c.revoked_at IS NULL) ORDER BY s.name ASC LIMIT 500`)'
if old not in text:
    raise SystemExit("ListScreens marker not found")
screens.write_text(text.replace(old, new, 1))

tests = Path("apps/server/internal/devices/service_integration_test.go")
text = tests.read_text()
marker = '''\tif _, err := service.AuthenticateDevice(ctx, activeCredential); !errors.Is(err, ErrRevokedCredential) {
\t\tt.Fatalf("expected revoked credential rejection, got %v", err)
\t}
'''
replacement = marker + '''\tlistedScreens, err := service.ListScreens(ctx)
\tif err != nil {
\t\tt.Fatal(err)
\t}
\tif len(listedScreens) != 0 {
\t\tt.Fatalf("revoked screen remained in list: %#v", listedScreens)
\t}
'''
if marker not in text:
    raise SystemExit("revocation test marker not found")
tests.write_text(text.replace(marker, replacement, 1))
