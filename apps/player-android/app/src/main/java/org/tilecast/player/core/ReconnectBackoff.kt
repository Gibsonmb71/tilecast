package org.tilecast.player.core

import kotlin.math.min
import kotlin.random.Random

class ReconnectBackoff(
    private val random: Random = Random.Default,
    private val healthyResetMillis: Long = 60_000L,
) {
    fun delayMillis(attempt: Int): Long {
        val cappedAttempt = attempt.coerceIn(0, 8)
        val base = min(60_000L, 1_000L shl cappedAttempt)
        return base + random.nextLong(0, maxOf(1, base / 3))
    }

    /**
     * Returns the attempt index to use for the next reconnect after a socket closes.
     * A connection that stayed open at least [healthyResetMillis] is treated as healthy,
     * so a later brief blip reconnects quickly (attempt 0) instead of resuming near the
     * 60s cap; a connection that dropped sooner keeps escalating.
     */
    fun nextAttempt(previousAttempt: Int, connectedForMillis: Long): Int =
        if (connectedForMillis >= healthyResetMillis) 0 else previousAttempt + 1
}

