package org.tilecast.player.core

import kotlin.random.Random
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
}

