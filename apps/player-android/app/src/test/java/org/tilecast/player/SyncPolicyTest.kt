package org.tilecast.player

import org.junit.Assert.assertEquals
import org.junit.Test

class SyncPolicyTest {
    @Test
    fun usesConfiguredManifestPollIntervalWithinSafeBounds() {
        assertEquals(60_000L, manifestPollDelayMillis(60))
        assertEquals(90_000L, manifestPollDelayMillis(90))
        assertEquals(86_400_000L, manifestPollDelayMillis(86_400))
    }

    @Test
    fun defaultsAndClampsInvalidManifestPollIntervals() {
        assertEquals(300_000L, manifestPollDelayMillis(null))
        assertEquals(60_000L, manifestPollDelayMillis(1))
        assertEquals(86_400_000L, manifestPollDelayMillis(100_000))
    }

    @Test
    fun synchronizedPlaylistUpdatesWaitForTheSharedItemBoundary() {
        assertEquals(
            false,
            shouldActivateManifestImmediately(
                hasActivePlayback = true,
                takeoverChanged = false,
                currentPresentationIsBoundaryless = false,
                incomingPresentationIsSynchronized = true,
            ),
        )
    }

    @Test
    fun urgentAndBoundarylessUpdatesStillActivateImmediately() {
        assertEquals(
            true,
            shouldActivateManifestImmediately(
                hasActivePlayback = true,
                takeoverChanged = true,
                currentPresentationIsBoundaryless = false,
                incomingPresentationIsSynchronized = true,
            ),
        )
        assertEquals(
            true,
            shouldActivateManifestImmediately(
                hasActivePlayback = true,
                takeoverChanged = false,
                currentPresentationIsBoundaryless = true,
                incomingPresentationIsSynchronized = true,
            ),
        )
        assertEquals(
            true,
            shouldActivateManifestImmediately(
                hasActivePlayback = false,
                takeoverChanged = false,
                currentPresentationIsBoundaryless = false,
                incomingPresentationIsSynchronized = true,
            ),
        )
    }
}
