package org.tilecast.player.reliability

import org.junit.Assert.*
import org.junit.Test
import java.time.*

class AccessibilityReturnPolicyTest {
    @Test fun excludesSettingsAndInstaller(){val policy=AccessibilityReturnPolicy(Duration.ofSeconds(5),2,Duration.ofMinutes(10));val now=Instant.now();assertFalse(policy.shouldReturn("com.android.settings",now.minusSeconds(20),now,false));assertFalse(policy.shouldReturn("com.google.android.packageinstaller",now.minusSeconds(20),now,false))}
    @Test fun honorsDelayPauseAndLoopLimit(){val policy=AccessibilityReturnPolicy(Duration.ofSeconds(5),2,Duration.ofMinutes(10));val now=Instant.now();assertFalse(policy.shouldReturn("example.app",now,now,false));assertFalse(policy.shouldReturn("example.app",now.minusSeconds(10),now,true));assertTrue(policy.shouldReturn("example.app",now.minusSeconds(10),now,false));policy.recordAttempt(now);policy.recordAttempt(now);assertFalse(policy.shouldReturn("example.app",now.minusSeconds(10),now,false))}
}
