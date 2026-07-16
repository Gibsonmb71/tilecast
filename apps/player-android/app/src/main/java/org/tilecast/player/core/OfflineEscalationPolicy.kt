package org.tilecast.player.core

import java.time.Duration

/** Self-healing actions for a Player that cannot reach the server. */
enum class OfflineAction {
    /** No intervention; keep retrying the connection. */
    NONE,

    /** Re-activate cached content locally in case the screen is blank or wedged. */
    VERIFY_FALLBACK,

    /** Recreate the player Activity in case the UI is wedged. */
    RESTART_ACTIVITY,

    /** Restart the process as a last resort for a stuck Player. */
    RESTART_PROCESS,
}

/**
 * Decides whether a prolonged loss of server contact should trigger a self-healing action.
 *
 * Health is judged by actual render progress ([progressStaleFor]), not by whether a
 * playback session object exists: a session can be present while the screen is blank or
 * frozen. A screen that is still advancing (video position moving, items or a re-shown
 * image reporting progress) is considered healthy and is never disrupted, even while
 * offline. Only a Player that is both offline and not visibly progressing escalates, and
 * disruptive restarts require minutes of no progress — far longer than any normal item
 * dwell — so a valid long-lived still image is not mistaken for a freeze. The monotonic
 * ordinal guard means each level fires at most once until the caller resets [lastAction]
 * (which it does as soon as progress resumes or the server is reachable again).
 */
class OfflineEscalationPolicy(
    private val actAfterOffline: Duration = Duration.ofMinutes(2),
    private val healthyProgressWindow: Duration = Duration.ofMinutes(2),
    private val restartActivityAfterStale: Duration = Duration.ofMinutes(10),
    private val restartProcessAfterStale: Duration = Duration.ofMinutes(30),
) {
    fun decide(offlineFor: Duration, progressStaleFor: Duration, lastAction: OfflineAction): OfflineAction {
        if (offlineFor < actAfterOffline) return OfflineAction.NONE
        // Still rendering -> healthy; nothing to heal regardless of how long we are offline.
        if (progressStaleFor < healthyProgressWindow) return OfflineAction.NONE
        val target =
            when {
                progressStaleFor >= restartProcessAfterStale -> OfflineAction.RESTART_PROCESS
                progressStaleFor >= restartActivityAfterStale -> OfflineAction.RESTART_ACTIVITY
                else -> OfflineAction.VERIFY_FALLBACK
            }
        return if (target.ordinal > lastAction.ordinal) target else OfflineAction.NONE
    }
}
