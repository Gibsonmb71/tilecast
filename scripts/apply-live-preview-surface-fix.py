from pathlib import Path

path = Path("apps/player-android/app/src/main/java/org/tilecast/player/preview/LivePreviewCoordinator.kt")
text = path.read_text()
text = text.replace(
    "import android.graphics.Canvas\n",
    "import android.graphics.Canvas\nimport android.graphics.Paint\nimport android.graphics.RectF\n",
    1,
)
text = text.replace(
    "import android.view.PixelCopy\nimport android.view.View\n",
    "import android.view.PixelCopy\nimport android.view.SurfaceView\nimport android.view.View\nimport android.view.ViewGroup\n",
    1,
)
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
    private suspend fun captureWithPixelCopy(bitmap: Bitmap): WindowCapture {
        val windowResult = requestWindowPixelCopy(bitmap)
        if (windowResult != PixelCopy.SUCCESS) {
            bitmap.recycle()
            return WindowCapture.Failure("pixel_copy_$windowResult")
        }

        val root = activity.window.decorView
        val surfaces = mutableListOf<SurfaceView>()
        collectVisibleSurfaceViews(root, surfaces)
        if (surfaces.isEmpty()) return WindowCapture.Success(bitmap)

        val rootLocation = IntArray(2)
        root.getLocationInWindow(rootLocation)
        val scaleX = bitmap.width.toFloat() / root.width
        val scaleY = bitmap.height.toFloat() / root.height
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        var copiedSurfaces = 0

        for (surface in surfaces) {
            val location = IntArray(2)
            surface.getLocationInWindow(location)
            val left = ((location[0] - rootLocation[0]) * scaleX).roundToInt().coerceIn(0, bitmap.width)
            val top = ((location[1] - rootLocation[1]) * scaleY).roundToInt().coerceIn(0, bitmap.height)
            val right = (left + surface.width * scaleX).roundToInt().coerceIn(0, bitmap.width)
            val bottom = (top + surface.height * scaleY).roundToInt().coerceIn(0, bitmap.height)
            if (right <= left || bottom <= top) continue

            val surfaceBitmap = runCatching {
                Bitmap.createBitmap(right - left, bottom - top, Bitmap.Config.ARGB_8888)
            }.getOrNull() ?: continue
            try {
                if (requestSurfacePixelCopy(surface, surfaceBitmap) == PixelCopy.SUCCESS) {
                    canvas.drawBitmap(
                        surfaceBitmap,
                        null,
                        RectF(left.toFloat(), top.toFloat(), right.toFloat(), bottom.toFloat()),
                        paint,
                    )
                    copiedSurfaces += 1
                }
            } finally {
                surfaceBitmap.recycle()
            }
        }

        if (copiedSurfaces == 0) {
            bitmap.recycle()
            return WindowCapture.Failure("video_surface_unavailable")
        }
        return WindowCapture.Success(bitmap)
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private suspend fun requestWindowPixelCopy(bitmap: Bitmap): Int =
        suspendCancellableCoroutine { continuation ->
            PixelCopy.request(
                activity.window,
                bitmap,
                { result -> if (continuation.isActive) continuation.resume(result) },
                mainHandler,
            )
        }

    @RequiresApi(Build.VERSION_CODES.O)
    private suspend fun requestSurfacePixelCopy(surface: SurfaceView, bitmap: Bitmap): Int =
        suspendCancellableCoroutine { continuation ->
            PixelCopy.request(
                surface,
                bitmap,
                { result -> if (continuation.isActive) continuation.resume(result) },
                mainHandler,
            )
        }

    private fun collectVisibleSurfaceViews(view: View, result: MutableList<SurfaceView>) {
        if (
            view is SurfaceView &&
                view.visibility == View.VISIBLE &&
                view.alpha > 0f &&
                view.isAttachedToWindow &&
                view.width > 0 &&
                view.height > 0
        ) {
            result += view
        }
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                collectVisibleSurfaceViews(view.getChildAt(index), result)
            }
        }
    }
'''
if old not in text:
    raise SystemExit("captureWithPixelCopy marker not found")
path.write_text(text.replace(old, new, 1))
