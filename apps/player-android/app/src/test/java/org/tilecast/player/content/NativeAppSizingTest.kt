package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeAppSizingTest {
    @Test
    fun clockShrinksToFitNarrowLayoutPlacement() {
        val size = fittedFontSizeSp(
            textLength = 11,
            widthDp = 240f,
            heightDp = 100f,
            fontScale = 1f,
            maximumFontSizeSp = 86f,
        )

        assertTrue(size < 40f)
    }

    @Test
    fun fullscreenClockRetainsItsDesignedMaximum() {
        val size = fittedFontSizeSp(
            textLength = 5,
            widthDp = 1920f,
            heightDp = 1080f,
            fontScale = 1f,
            maximumFontSizeSp = 86f,
        )

        assertEquals(86f, size, 0.01f)
    }

    @Test
    fun accessibilityFontScaleStillFitsTheSameBounds() {
        val normal = fittedFontSizeSp(8, 320f, 120f, 1f, 86f)
        val enlarged = fittedFontSizeSp(8, 320f, 120f, 1.5f, 86f)

        assertTrue(enlarged < normal)
    }
}
