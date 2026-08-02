package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Test
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.PlayerPlaybackDefaults

class PlaybackDefaultsTest {
    private val defaults = PlayerPlaybackDefaults(
        defaultVolume = .25,
        defaultFitMode = "cover",
        defaultImageDurationSeconds = 22,
        defaultTransition = "fade",
        defaultAudioEnabled = false,
    )

    @Test fun delegatedItemUsesEveryPlaybackDefault() {
        val item = ManifestItem("item", "asset", "variant", "image", 10_000, "contain", "none", true, 1f, deliveryPolicy = "download", usePlayerDefaults = true)
        val resolved = item.withPlaybackDefaults(defaults)
        assertEquals(22_000L, resolved.durationMs)
        assertEquals("cover", resolved.fitMode)
        assertEquals("fade", resolved.transition)
        assertEquals(false, resolved.audioEnabled)
        assertEquals(.25f, resolved.volume)
    }

    @Test fun authoredItemRemainsAuthoritative() {
        val item = ManifestItem("item", "asset", "variant", "image", 10_000, "stretch", "crossfade", true, .9f, deliveryPolicy = "download", usePlayerDefaults = false)
        val resolved = item.withPlaybackDefaults(defaults)
        assertEquals(10_000L, resolved.durationMs)
        assertEquals("stretch", resolved.fitMode)
        assertEquals("crossfade", resolved.transition)
        assertEquals(true, resolved.audioEnabled)
        assertEquals(.9f, resolved.volume)
    }
}
