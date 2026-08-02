package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestAsset
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
        val manifest = PlayerManifest(
            14,
            1,
            "screen",
            now.toString(),
            "presentation",
            playlists = listOf(playlist),
            assets = listOf(
                ManifestAsset("active", "variant-active", "image/png", "hash-active", 1, downloadPath = "/active"),
                ManifestAsset("future", "variant-future", "image/png", "hash-future", 1, downloadPath = "/future"),
            ),
        )
        assertEquals(listOf("active"), manifest.withAvailablePlaylistItems(now).playlists.single().items.map { it.id })
        assertEquals(future, manifest.nextAvailabilityTransition(now))
    }

    @Test fun `media availability requires the exact manifest variant`() {
        val now = Instant.parse("2026-07-25T12:00:00Z")
        val playlist = ManifestPlaylist(
            "playlist",
            1,
            "Variants",
            listOf(item("photo").copy(variantId = "requested")),
        )
        val manifest = PlayerManifest(
            14,
            1,
            "screen",
            now.toString(),
            "presentation",
            playlists = listOf(playlist),
            assets = listOf(
                ManifestAsset("photo", "other", "image/png", "hash-other", 1, downloadPath = "/other"),
            ),
        )

        assertTrue(manifest.withAvailablePlaylistItems(now).playlists.single().items.isEmpty())
    }
}
