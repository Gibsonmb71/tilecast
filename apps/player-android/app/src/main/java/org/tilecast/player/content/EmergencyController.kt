package org.tilecast.player.content

import org.tilecast.player.network.ManifestEmergency
import java.time.Instant

data class EmergencyDecision(
    val active: Boolean,
    val playlistId: String? = null,
    val nextTransition: Instant? = null,
    val continueNormalPlayback: Boolean = true,
)

object EmergencyController {
    fun evaluate(now: Instant, emergency: ManifestEmergency?, assetsReady: Boolean): EmergencyDecision {
        if (emergency == null) return EmergencyDecision(false)
        val starts = Instant.parse(emergency.activatedAt)
        val expires = Instant.parse(emergency.expiresAt)
        if (now.isBefore(starts) || !now.isBefore(expires)) return EmergencyDecision(false)
        return if (assetsReady) EmergencyDecision(true, emergency.playlistId, expires, false)
        else EmergencyDecision(false, nextTransition = expires, continueNormalPlayback = true)
    }
}
