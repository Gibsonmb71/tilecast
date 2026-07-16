package org.tilecast.player.core

import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Test

class OfflineEscalationPolicyTest {
    private val policy = OfflineEscalationPolicy(
        verifyAfter = Duration.ofMinutes(2),
        restartActivityAfter = Duration.ofMinutes(10),
        restartProcessAfter = Duration.ofMinutes(30),
    )

    @Test fun neverDisruptsAScreenPlayingCachedContent() {
        assertEquals(
            OfflineAction.NONE,
            policy.decide(Duration.ofHours(2), playbackHealthy = true, lastAction = OfflineAction.NONE),
        )
    }

    @Test fun escalatesByOfflineDurationWhenNothingIsPlaying() {
        assertEquals(
            OfflineAction.NONE,
            policy.decide(Duration.ofSeconds(30), playbackHealthy = false, lastAction = OfflineAction.NONE),
        )
        assertEquals(
            OfflineAction.VERIFY_FALLBACK,
            policy.decide(Duration.ofMinutes(3), playbackHealthy = false, lastAction = OfflineAction.NONE),
        )
        assertEquals(
            OfflineAction.RESTART_ACTIVITY,
            policy.decide(Duration.ofMinutes(12), playbackHealthy = false, lastAction = OfflineAction.VERIFY_FALLBACK),
        )
        assertEquals(
            OfflineAction.RESTART_PROCESS,
            policy.decide(Duration.ofMinutes(45), playbackHealthy = false, lastAction = OfflineAction.RESTART_ACTIVITY),
        )
    }

    @Test fun doesNotRepeatOrRegressAnAction() {
        // Same level already taken -> no repeat, so a wedged Player cannot restart-loop.
        assertEquals(
            OfflineAction.NONE,
            policy.decide(Duration.ofMinutes(12), playbackHealthy = false, lastAction = OfflineAction.RESTART_ACTIVITY),
        )
        // A higher threshold reached but a more drastic action already taken -> hold.
        assertEquals(
            OfflineAction.NONE,
            policy.decide(Duration.ofMinutes(12), playbackHealthy = false, lastAction = OfflineAction.RESTART_PROCESS),
        )
    }

    @Test fun jumpsStraightToTheHighestReachedLevel() {
        // A Player discovered offline for a long time escalates directly, one step at a time
        // from wherever it last acted.
        assertEquals(
            OfflineAction.RESTART_PROCESS,
            policy.decide(Duration.ofHours(1), playbackHealthy = false, lastAction = OfflineAction.NONE),
        )
    }
}
