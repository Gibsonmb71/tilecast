package org.tilecast.player.preview

import org.junit.Assert.assertEquals
import org.junit.Test

class LivePreviewCoordinatorTest {
    @Test
    fun preservesAspectRatioWithoutUpscaling() {
        assertEquals(PreviewDimensions(960, 540), previewDimensions(1920, 1080))
        assertEquals(PreviewDimensions(540, 540), previewDimensions(1000, 1000))
        assertEquals(PreviewDimensions(640, 360), previewDimensions(640, 360))
    }

    @Test
    fun boundsPortraitDisplays() {
        assertEquals(PreviewDimensions(304, 540), previewDimensions(1080, 1920))
    }
}
