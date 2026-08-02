package org.tilecast.player.content

/**
 * The branded surface is only a fallback for a known empty assignment. An
 * active cached session always wins, even while the server is unreachable.
 */
enum class BrandedFallbackKind { ASSIGNED_CONTENT, DISABLED, OFFLINE, UNAVAILABLE, NO_CONTENT, WAITING }

internal fun resolveBrandedFallbackKind(
    contentPresent: Boolean,
    playbackDisabled: Boolean,
    noContentKnown: Boolean,
    unavailableKnown: Boolean,
    connected: Boolean,
): BrandedFallbackKind = when {
    contentPresent -> BrandedFallbackKind.ASSIGNED_CONTENT
    playbackDisabled -> BrandedFallbackKind.DISABLED
    unavailableKnown -> BrandedFallbackKind.UNAVAILABLE
    noContentKnown && !connected -> BrandedFallbackKind.OFFLINE
    noContentKnown -> BrandedFallbackKind.NO_CONTENT
    else -> BrandedFallbackKind.WAITING
}
