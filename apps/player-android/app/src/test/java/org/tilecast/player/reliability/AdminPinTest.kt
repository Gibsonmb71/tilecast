package org.tilecast.player.reliability

import org.junit.Assert.*
import org.junit.Test
import java.time.*

class AdminPinTest {
    @Test fun hashesValidatesAndLocksOut(){val gate=AdminPinGate(2,Duration.ofMinutes(5));val stored=gate.create("2468".toCharArray());assertTrue(gate.verify("2468".toCharArray(),stored));val now=Instant.now();assertFalse(gate.verify("1111".toCharArray(),stored,now));assertFalse(gate.verify("1111".toCharArray(),stored,now));assertTrue(gate.isLocked(now.plusSeconds(1)));assertFalse(gate.verify("2468".toCharArray(),stored,now.plusSeconds(1)))}
}
