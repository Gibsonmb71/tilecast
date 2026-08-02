package org.tilecast.player.content

import org.tilecast.player.core.ServerUrlPolicy

data class CacheIdentity(val installationId: String, val screenId: String, val normalizedServerUrl: String)

internal fun cacheIdentity(serverUrl: String, installationId: String?, screenId: String?): CacheIdentity? {
    if (installationId.isNullOrBlank() || screenId.isNullOrBlank()) return null
    val normalized = ServerUrlPolicy.normalize(serverUrl).getOrNull()?.value ?: return null
    return CacheIdentity(installationId, screenId, normalized)
}

internal fun CacheIdentity.matches(installationId: String?, screenId: String?, normalizedServerUrl: String?): Boolean =
    installationId == this.installationId && screenId == this.screenId && normalizedServerUrl == this.normalizedServerUrl
