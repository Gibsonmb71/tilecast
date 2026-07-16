package org.tilecast.player.core

import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Test

class OfflineEscalationPolicyTest {
    private val policy = OfflineEscalationPolicy(
        actAfterOffline = Duration.ofMinutes(2),
        healthyProgressWindow = Duration.ofMinutes(2),
        restartActivityAfterStale = Duration.ofMinutes(10),
        restartProcessAfterStale = Duration.ofMinutes(30),
    )

    private val fresh = Duration.ofSeconds(5)

    @Test fun doesNothingUntilOfflineLongEnough() {
        assertEquals(
            OfflineAction.NONE,
            policy.decide(offlineFor = Duration.ofSeconds(30), progressStaleFor = Duration.ofHours(1), lastAction = OfflineAction.NONE),
        )
    }

    @Test fun neverDisruptsAScreenThatIsStillProgressing() {
        // Offline for hours, but playback is advancing -> healthy, even though a session
        // exists. This is the case the previous session-presence check got wrong in reverse:
        // here it must NOT act, and elsewhere a frozen screen with a session MUST act.
        assertEquals(
            OfflineAction.NONE,
            policy.decide(offlineFor = Duration.ofHours(2), progressStaleFor = fresh, lastAction = OfflineAction.NONE),
        )
    }

    @Test fun escalatesAFrozenOfflineScreenByStaleness() {
        assertEquals(
            OfflineAction.VERIFY_FALLBACK,
            policy.decide(Duration.ofMinutes(3), Duration.ofMinutes(3), OfflineAction.NONE),
        )
        assertEquals(
            OfflineAction.RESTART_ACTIVITY,
            policy.decide(Duration.ofMinutes(12), Duration.ofMinutes(12), OfflineAction.VERIFY_FALLBACK),
        )
        assertEquals(
            OfflineAction.RESTART_PROCESS,
            policy.decide(Duration.ofMinutes(45), Duration.ofMinutes(45), OfflineAction.RESTART_ACTIVITY),
        )
    }

    @Test fun doesNotRepeatOrRegressAnAction() {
        // Same level already taken -> hold, so re-showing a still image every couple of
        // minutes cannot ratchet into a restart, and a restart cannot loop.
        assertEquals(
            OfflineAction.NONE,
            policy.decide(Duration.ofMinutes(4), Duration.ofMinutes(4), OfflineAction.VERIFY_FALLBACK),
        )
        assertEquals(
            OfflineAction.NONE,
            policy.decide(Duration.ofMinutes(45), Duration.ofMinutes(45), OfflineAction.RESTART_PROCESS),
        )
    }

    @Test fun jumpsStraightToTheHighestReachedLevelWhenDiscoveredStale() {
        assertEquals(
            OfflineAction.RESTART_PROCESS,
            policy.decide(Duration.ofHours(1), Duration.ofHours(1), OfflineAction.NONE),
        )
    }
}
