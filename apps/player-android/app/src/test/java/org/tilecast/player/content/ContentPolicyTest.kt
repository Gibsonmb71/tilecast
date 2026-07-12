package org.tilecast.player.content

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentPolicyTest {
    @Test fun automaticPolicyDownloadsImagesAndBoundedVideos() {
        assertTrue(ContentPolicy.shouldDownload("automatic", "image/png", Long.MAX_VALUE, 1))
        assertTrue(ContentPolicy.shouldDownload("automatic", "video/mp4", 100, 100, 200))
        assertFalse(ContentPolicy.shouldDownload("automatic", "video/mp4", 201, 1_000, 200))
        assertFalse(ContentPolicy.shouldDownload("automatic", "video/mp4", 100, 99, 200))
        assertFalse(ContentPolicy.shouldDownload("stream", "image/png", 1, 1))
    }
    @Test fun verifiesSizeAndSha256() {
        val file=File.createTempFile("tilecast-content", ".bin").apply{writeText("tilecast")}
        assertTrue(ContentPolicy.verify(file,8,"7ac03e565712af76035ca74340408d2b6525fe910a79ea248a6f76a555542dc9"))
        assertFalse(ContentPolicy.verify(file,7,"7ac03e565712af76035ca74340408d2b6525fe910a79ea248a6f76a555542dc9"))
        file.delete()
    }
}
