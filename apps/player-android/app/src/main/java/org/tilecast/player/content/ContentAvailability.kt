package org.tilecast.player.content

import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestAsset
import org.tilecast.player.network.ManifestPlaylist
import org.tilecast.player.network.PlayerManifest
import java.time.Instant

internal fun PreparedContent.serverNow(local: Instant = Instant.now()): Instant =
    local.plusMillis(serverClockOffsetMillis ?: (serverClockOffsetSeconds ?: 0) * 1_000L)

internal fun ManifestItem.isAvailableAt(now: Instant): Boolean {
    val starts = availableFrom?.let { runCatching { Instant.parse(it) }.getOrElse { return false } }
    val expires = expiresAt?.let { runCatching { Instant.parse(it) }.getOrElse { return false } }
    if (starts != null && expires != null && !starts.isBefore(expires)) return false
    return (starts == null || !now.isBefore(starts)) && (expires == null || now.isBefore(expires))
}

internal fun ManifestAsset.isAvailableAt(now: Instant): Boolean {
    val starts = availableFrom?.let { runCatching { Instant.parse(it) }.getOrElse { return false } }
    val expires = expiresAt?.let { runCatching { Instant.parse(it) }.getOrElse { return false } }
    if (starts != null && expires != null && !starts.isBefore(expires)) return false
    return (starts == null || !now.isBefore(starts)) && (expires == null || now.isBefore(expires))
}

internal fun ManifestPlaylist.availableAt(now: Instant, assets: List<ManifestAsset> = emptyList()) =
    copy(items = items.filter { item ->
        if (!item.isAvailableAt(now)) {
            false
        } else if (item.layoutId != null || item.assetType == "website" || item.assetType == "widget") {
            true
        } else {
            val asset = assets.firstOrNull { candidate ->
                candidate.assetId == item.assetId &&
                    item.variantId != null && candidate.variantId == item.variantId
            }
            asset?.isAvailableAt(now) == true
        }
    })

internal fun PlayerManifest.withAvailablePlaylistItems(now: Instant): PlayerManifest =
    copy(
        playlist = playlist?.availableAt(now, assets),
        directFallbackPlaylist = directFallbackPlaylist?.availableAt(now, assets),
        playlists = playlists.map { it.availableAt(now, assets) },
    )

internal fun PlayerManifest.nextAvailabilityTransition(now: Instant): Instant? {
    val transitions = buildList {
        playlists.forEach { playlist ->
            playlist.items.forEach { item ->
                add(item.availableFrom)
                add(item.expiresAt)
            }
        }
        directFallbackPlaylist?.items.orEmpty().forEach { item ->
            add(item.availableFrom)
            add(item.expiresAt)
        }
        playlist?.items.orEmpty().forEach { item ->
            add(item.availableFrom)
            add(item.expiresAt)
        }
        assets.forEach { asset ->
            add(asset.availableFrom)
            add(asset.expiresAt)
        }
    }
    return transitions
        .filterNotNull()
        .mapNotNull { runCatching { Instant.parse(it) }.getOrNull() }
        .filter { it.isAfter(now) }
        .minOrNull()
}
