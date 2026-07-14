package org.tilecast.player.reliability

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals

class CommissioningStatusTest {
    @Test
    fun allVerifiedCapabilitiesAreReady() {
        val status = CommissioningStatus(
            required = false,
            adminPinSet = true,
            accessibilityEnabled = true,
            installPermissionGranted = true,
            bootLaunchVerified = true,
            immersiveVerified = true,
            keepAwakeVerified = true,
            cachedFallbackAvailable = true,
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
