package org.tilecast.player.core

import kotlin.math.min
import kotlin.random.Random

class ReconnectBackoff(private val random: Random = Random.Default) {
    fun delayMillis(attempt: Int): Long {
        val cappedAttempt = attempt.coerceIn(0, 8)
        val base = min(60_000L, 1_000L shl cappedAttempt)
        return base + random.nextLong(0, maxOf(1, base / 3))
    }
}

