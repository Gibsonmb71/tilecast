package org.tilecast.player.core

import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReconnectBackoffTest {
    @Test fun increasesAndCapsWithJitter() {
        val backoff = ReconnectBackoff(Random(7))
        val first = backoff.delayMillis(0)
        val fourth = backoff.delayMillis(4)
        val capped = backoff.delayMillis(50)
        assertTrue(first in 1_000 until 1_334)
        assertTrue(fourth in 16_000 until 21_334)
        assertTrue(capped in 60_000 until 80_000)
    }

    @Test fun resetsAttemptAfterSustainedHealthyConnection() {
        val backoff = ReconnectBackoff(healthyResetMillis = 60_000L)
        // A connection that stayed up past the healthy threshold reconnects from scratch.
        assertEquals(0, backoff.nextAttempt(previousAttempt = 8, connectedForMillis = 120_000L))
        // A connection that dropped quickly keeps escalating.
        assertEquals(9, backoff.nextAttempt(previousAttempt = 8, connectedForMillis = 5_000L))
        // Exactly at the threshold counts as healthy.
        assertEquals(0, backoff.nextAttempt(previousAttempt = 3, connectedForMillis = 60_000L))
    }
}

