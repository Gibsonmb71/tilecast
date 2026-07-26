package org.tilecast.player.content

import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestPlaylist
import org.tilecast.player.network.PlayerManifest
import java.time.Instant

internal fun ManifestItem.isAvailableAt(now: Instant): Boolean {
    val starts = availableFrom?.let { runCatching { Instant.parse(it) }.getOrNull() }
    val expires = expiresAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
    return (starts == null || !now.isBefore(starts)) && (expires == null || now.isBefore(expires))
}

internal fun ManifestPlaylist.availableAt(now: Instant) =
    copy(items = items.filter { it.isAvailableAt(now) })

internal fun PlayerManifest.withAvailablePlaylistItems(now: Instant): PlayerManifest =
    copy(
        playlist = playlist?.availableAt(now),
        directFallbackPlaylist = directFallbackPlaylist?.availableAt(now),
        playlists = playlists.map { it.availableAt(now) },
    )

internal fun PlayerManifest.nextAvailabilityTransition(now: Instant): Instant? =
    (playlists.flatMap { it.items } + directFallbackPlaylist?.items.orEmpty() + playlist?.items.orEmpty())
        .flatMap { item -> listOfNotNull(item.availableFrom, item.expiresAt) }
        .mapNotNull { runCatching { Instant.parse(it) }.getOrNull() }
        .filter { it.isAfter(now) }
        .minOrNull()
