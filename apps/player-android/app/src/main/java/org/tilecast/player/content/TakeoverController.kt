package org.tilecast.player.content

import org.tilecast.player.network.ManifestTakeover
import java.time.Instant

data class TakeoverDecision(
    val active: Boolean,
    val playlistId: String? = null,
    val nextTransition: Instant? = null,
    val continueNormalPlayback: Boolean = true,
)

object TakeoverController {
    fun evaluate(now: Instant, takeover: ManifestTakeover?, assetsReady: Boolean): TakeoverDecision {
        if (takeover == null) return TakeoverDecision(false)
        val starts = Instant.parse(takeover.activatedAt)
        val expires = Instant.parse(takeover.expiresAt)
        if (now.isBefore(starts) || !now.isBefore(expires)) return TakeoverDecision(false)
        return if (assetsReady) TakeoverDecision(true, takeover.playlistId, expires, false)
        else TakeoverDecision(false, nextTransition = expires, continueNormalPlayback = true)
    }
}
