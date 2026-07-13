package org.tilecast.player.reliability

import org.junit.Assert.*
import org.junit.Test
import java.time.*

class ReliabilitySupervisorTest {
    @Test fun escalationIsBoundedAndEntersSafeMode(){val supervisor=ReliabilitySupervisor(1,Duration.ofMinutes(10),true);val start=Instant.parse("2026-07-13T12:00:00Z");var decision=supervisor.recordFailure(start);repeat(6){decision=supervisor.recordFailure(start.plusSeconds(it.toLong()+1))};assertEquals(RecoveryLevel.SAFE_MODE,decision.level);assertTrue(decision.safeMode);supervisor.exitSafeMode();assertFalse(supervisor.safeMode)}
    @Test fun oldFailuresLeaveWindow(){val supervisor=ReliabilitySupervisor();val start=Instant.parse("2026-07-13T12:00:00Z");supervisor.recordFailure(start);assertEquals(RecoveryLevel.RETRY,supervisor.recordFailure(start.plusSeconds(601)).level)}
}
