package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestPlaylist
import org.tilecast.player.network.PlayerManifest
import java.time.Instant

class ContentAvailabilityTest {
    private fun item(id: String, from: String? = null, expires: String? = null) =
        ManifestItem(id, id, "variant-$id", "image", 10_000, "contain", "none", false, 0f, deliveryPolicy = "download", availableFrom = from, expiresAt = expires)

    @Test fun `availability uses inclusive start and exclusive expiration`() {
        val now = Instant.parse("2026-07-25T12:00:00Z")
        assertTrue(item("active", from = now.toString()).isAvailableAt(now))
        assertFalse(item("future", from = now.plusSeconds(1).toString()).isAvailableAt(now))
        assertFalse(item("expired", expires = now.toString()).isAvailableAt(now))
    }

    @Test fun `manifest filters offline and reports the next boundary`() {
        val now = Instant.parse("2026-07-25T12:00:00Z")
        val future = now.plusSeconds(60)
        val playlist = ManifestPlaylist("playlist", 1, "Tagged", listOf(item("active"), item("future", from = future.toString())))
        val manifest = PlayerManifest(14, 1, "screen", now.toString(), "presentation", playlists = listOf(playlist))
        assertEquals(listOf("active"), manifest.withAvailablePlaylistItems(now).playlists.single().items.map { it.id })
        assertEquals(future, manifest.nextAvailabilityTransition(now))
    }
}
