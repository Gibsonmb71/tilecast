package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.LayoutCanvas
import org.tilecast.player.network.LayoutDocument
import org.tilecast.player.network.LayoutPlacement
import org.tilecast.player.network.ManifestAsset
import org.tilecast.player.network.ManifestLayout
import org.tilecast.player.network.PlayerManifest
import org.tilecast.player.data.CachedAsset

class ManifestSyncManagerTest {
    @Test
    fun onlySendsConditionalManifestRequestAfterCacheVerification() {
        assertEquals("etag-1", manifestEtagForRequest(true, "etag-1"))
        assertEquals(null, manifestEtagForRequest(false, "etag-1"))
    }

    @Test
    fun downloadsLayoutBackgroundAndAssetPlacements() {
        val background = ManifestAsset("asset-background", "variant-background", "image/png", "background-hash", 10, downloadPath = "/background")
        val placementAsset = ManifestAsset("asset-placement", "variant-placement", "image/png", "placement-hash", 20, downloadPath = "/placement")
        val layout = ManifestLayout(
            id = "layout-1",
            revisionId = "revision-1",
            revision = 1,
            documentSha256 = "document-hash",
            document = LayoutDocument(
                schemaVersion = 1,
            canvas = LayoutCanvas(1920, 1080, "landscape", "#000000", backgroundAssetId = background.assetId, backgroundVariantId = background.variantId),
                placements = listOf(
                    LayoutPlacement("placement-1", "asset", "Photo", 0f, 0f, 100f, 100f, 1, 1f, true, false, assetId = placementAsset.assetId, variantId = placementAsset.variantId),
                ),
            ),
        )
        val manifest = PlayerManifest(
            schemaVersion = 13,
            manifestVersion = 1,
            screenId = "screen-1",
            generatedAt = "2026-07-18T00:00:00Z",
            mode = "presentation",
            layout = layout,
            layouts = listOf(layout),
            assets = listOf(background, placementAsset),
        )

        val selected = selectManifestDownloads(
            manifest = manifest,
            cacheUsedBytes = 0,
            usableSpaceBytes = 1_000,
            cacheLimitBytes = 1_000,
            minimumFreeBytes = 0,
            automaticVideoThresholdBytes = 100,
        )

        assertEquals(listOf("variant-background", "variant-placement"), selected.map { it.variantId })
        assertTrue(selected.all { it.fileSize > 0 })
    }

    @Test
    fun layoutReferencesSelectTheExactVariantWhenAnAssetHasSeveralVariants() {
        val requested = ManifestAsset("asset", "variant-requested", "image/png", "requested", 10, downloadPath = "/requested")
        val other = ManifestAsset("asset", "variant-other", "image/png", "other", 20, downloadPath = "/other")
        val layout = ManifestLayout(
            id = "layout",
            revisionId = "revision",
            revision = 1,
            documentSha256 = "hash",
            document = LayoutDocument(
                schemaVersion = 1,
                canvas = LayoutCanvas(1920, 1080, "landscape", "#000000", backgroundAssetId = "asset", backgroundVariantId = requested.variantId),
                placements = emptyList(),
            ),
        )
        val manifest = PlayerManifest(13, 1, "screen", "2026-07-18T00:00:00Z", "presentation", layout = layout, layouts = listOf(layout), assets = listOf(other, requested))

        assertEquals(listOf(requested.variantId), selectManifestDownloads(manifest, 0, 1_000, 1_000, 0, 100).map { it.variantId })
    }

    @Test
    fun onlyVerifiesFilesRequiredByTheActiveManifest() {
        val active = cachedAsset("active", required = true)
        val unprotected = cachedAsset("unprotected", required = false)
        val verified = mutableListOf<String>()

        val result = validateActiveCache(listOf(active, unprotected)) { record ->
            verified += record.variantId
            true
        }

        assertEquals(listOf("active"), verified)
        assertEquals(mapOf("active" to active.localPath), result.localFiles)
        assertTrue(result.complete)
    }

    @Test
    fun rejectsAnInvalidFileRequiredByTheActiveManifest() {
        val result = validateActiveCache(listOf(cachedAsset("active", required = true))) { false }

        assertTrue(result.localFiles.isEmpty())
        assertTrue(!result.complete)
    }

    private fun cachedAsset(variantId: String, required: Boolean) = CachedAsset(
        variantId = variantId,
        assetId = "asset-$variantId",
        sha256 = "hash-$variantId",
        expectedFileSize = 10,
        localPath = "/cache/$variantId",
        downloadStatus = "ready",
        requiredByActiveManifest = required,
    )
}
