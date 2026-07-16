package org.tilecast.player.core

import java.time.Duration

/** Self-healing actions for a Player that cannot reach the server. */
enum class OfflineAction {
    /** No intervention; keep retrying the connection. */
    NONE,

    /** Confirm cached fallback content is playing so the screen is not blank. */
    VERIFY_FALLBACK,

    /** Recreate the player Activity in case the UI is wedged. */
    RESTART_ACTIVITY,

    /** Restart the process as a last resort for a stuck Player. */
    RESTART_PROCESS,
}

/**
 * Decides whether a prolonged loss of server contact should trigger a self-healing action.
 *
 * The policy is deliberately conservative: a Player that is offline but still rendering
 * cached content is healthy and is never disrupted. Escalation only applies to a Player
 * that is offline AND not presenting anything, and it advances by offline duration while
 * never repeating or regressing the action it last took, so it cannot loop.
 */
class OfflineEscalationPolicy(
    private val verifyAfter: Duration = Duration.ofMinutes(2),
    private val restartActivityAfter: Duration = Duration.ofMinutes(10),
    private val restartProcessAfter: Duration = Duration.ofMinutes(30),
) {
    fun decide(offlineFor: Duration, playbackHealthy: Boolean, lastAction: OfflineAction): OfflineAction {
        // A screen showing cached content is doing its job; never restart it for being offline.
        if (playbackHealthy) return OfflineAction.NONE
        val target =
            when {
                offlineFor >= restartProcessAfter -> OfflineAction.RESTART_PROCESS
                offlineFor >= restartActivityAfter -> OfflineAction.RESTART_ACTIVITY
                offlineFor >= verifyAfter -> OfflineAction.VERIFY_FALLBACK
                else -> OfflineAction.NONE
            }
        // Only act when this is a new, higher level than the last action taken this outage.
        return if (target.ordinal > lastAction.ordinal) target else OfflineAction.NONE
    }
}
