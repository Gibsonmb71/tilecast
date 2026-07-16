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

    @Test
    fun automaticTextSizeGrowsWithWidgetBounds() {
        val small = scaledFittedFontSizeSp(5, 176f, 92f, 1f)
        val standalone = scaledFittedFontSizeSp(5, 704f, 368f, 1f)

        assertTrue(small < standalone)
    }

    @Test
    fun customTextScaleCanReduceTheFittedResult() {
        val automatic = scaledFittedFontSizeSp(12, 440f, 230f, 1f)
        val smaller = scaledFittedFontSizeSp(12, 440f, 230f, 1f, textScale = 50)

        assertEquals(automatic * 0.5f, smaller, 0.01f)
    }

    @Test
    fun denseMenuContentScalesToAvailableHeight() {
        val roomy = menuContentScale(itemCount = 2, availableHeightDp = 460f)
        val compact = menuContentScale(itemCount = 5, availableHeightDp = 180f)

        assertEquals(460f / 350f, roomy, 0.01f)
        assertTrue(compact < roomy)
    }

    @Test
    fun defaultPaddingCreatesAnEightyPercentContentArea() {
        assertEquals(0.1f, widgetPaddingFraction(null), 0.001f)
        assertEquals(0f, widgetPaddingFraction(0), 0.001f)
    }
}
