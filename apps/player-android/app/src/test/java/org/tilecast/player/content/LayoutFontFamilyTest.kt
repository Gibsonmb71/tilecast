package org.tilecast.player.content

import androidx.compose.ui.text.font.FontFamily
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Test

class LayoutFontFamilyTest {
    @Test
    fun supportedFamiliesUseBundledFonts() {
        assertNotEquals(FontFamily.SansSerif, layoutFontFamily("Inter"))
        assertNotEquals(layoutFontFamily("Inter"), layoutFontFamily("Roboto"))
        assertNotEquals(layoutFontFamily("Roboto"), layoutFontFamily("Source Sans 3"))
        assertNotEquals(layoutFontFamily("Source Sans 3"), layoutFontFamily("Noto Sans"))
    }

    @Test
    fun unknownFamiliesFallBackToSansSerif() {
        assertSame(FontFamily.SansSerif, layoutFontFamily("Unknown"))
    }
}
