package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class ServerClockTest {
    @Test fun skewIsAppliedAndPersistsThroughRestore() {
        val local = Instant.parse("2026-08-02T12:00:00Z")
        val clock = ServerClock(localNow = { local })
        clock.sync("2026-08-02T12:05:00Z", local)
        assertEquals(Instant.parse("2026-08-02T12:05:00Z"), clock.now())
        val restored = ServerClock(localNow = { local })
        restored.restore(clock.offsetMillis())
        assertEquals(clock.now(), restored.now())
    }

    @Test fun invalidFreshSyncKeepsLastKnownOffset() {
        val local = Instant.parse("2026-08-02T12:00:00Z")
        val clock = ServerClock(localNow = { local })
        clock.restore(30_000)
        clock.sync("not-a-time", local)
        assertEquals(local.plusSeconds(30), clock.now())
    }
}
