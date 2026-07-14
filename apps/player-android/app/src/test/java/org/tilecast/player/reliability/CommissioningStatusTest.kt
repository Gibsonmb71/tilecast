package org.tilecast.player.reliability

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class CommissioningStatusTest {
    @Test
    fun allVerifiedCapabilitiesAreReadyWithoutAssignedContent() {
        val status = CommissioningStatus(
            required = false,
            adminPinSet = true,
            accessibilityEnabled = true,
            installPermissionGranted = true,
            bootLaunchVerified = true,
            immersiveVerified = true,
            keepAwakeVerified = true,
            cachedFallbackAvailable = false,
            selfTestResult = "passed",
            completedAt = Instant.parse("2026-07-13T12:00:00Z"),
        )
        assertEquals("ready", status.readiness)
    }

    @Test
    fun incompleteCommissioningNeedsSetup() {
        assertEquals("needs_setup", CommissioningStatus(required = true).readiness)
    }
}
