package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestPlaylist
import java.time.Instant

class PlaybackCursorTest {
    @Test
    fun singleItemPlaylistStartsANewPlaybackCycle() {
        assertEquals(PlaybackCursor(0, 1), nextPlaybackCursor(PlaybackCursor(0, 0), 1))
    }

    @Test
    fun playlistWrapsToFirstItemWithANewCycle() {
        assertEquals(PlaybackCursor(0, 3), nextPlaybackCursor(PlaybackCursor(2, 2), 3))
    }

    @Test
    fun lateJoiningSyncGroupMemberUsesSharedItemAndOffset() {
        val item = { id: String, duration: Long ->
            ManifestItem(id, id, assetType = "image", durationMs = duration, fitMode = "contain", transition = "none", audioEnabled = false, volume = 0f, deliveryPolicy = "download")
        }
        val playlist = ManifestPlaylist("playlist", 1, "Synced", listOf(item("first", 10_000), item("second", 20_000)))
        val anchor = Instant.parse("2026-07-14T12:00:00Z")
        assertEquals(SynchronizedPlaybackStart(PlaybackCursor(1, 0), 15_000), synchronizedPlaybackStart(playlist, emptyList(), anchor, anchor.plusSeconds(25)))
        assertEquals(SynchronizedPlaybackStart(PlaybackCursor(0, 0), 5_000), synchronizedPlaybackStart(playlist, emptyList(), anchor, anchor.plusSeconds(35)))
    }

    @Test
    fun layoutItemUsesItsConfiguredDuration() {
        val item = ManifestItem(
            id = "item",
            assetId = "layout",
            assetType = "layout",
            durationMs = 45_000,
            fitMode = "contain",
            transition = "fade",
            audioEnabled = false,
            volume = 0f,
            deliveryPolicy = "stream",
            layoutId = "layout",
        )
        assertEquals(45_000, effectiveDurationMs(item, emptyList()))
    }

    @Test
    fun crossfadeAnimatesAndOnlyAdjacentVideosNeedComposableSurfaces() {
        fun item(id: String, transition: String) = ManifestItem(id, id, assetType = "video", fitMode = "contain", transition = transition, audioEnabled = false, volume = 0f, deliveryPolicy = "download")
        val playlist = ManifestPlaylist("playlist", 1, "Transitions", listOf(item("first", "none"), item("second", "crossfade"), item("third", "none"), item("fourth", "fade")))

        assertTrue(shouldAnimateTransition("fade"))
        assertTrue(shouldAnimateTransition("crossfade"))
        assertFalse(shouldAnimateTransition("none"))
        assertTrue(requiresCompositableVideo(playlist, 0))
        assertTrue(requiresCompositableVideo(playlist, 1))
        assertFalse(requiresCompositableVideo(playlist, 2))
        assertFalse(requiresCompositableVideo(playlist, 3))
    }
}
