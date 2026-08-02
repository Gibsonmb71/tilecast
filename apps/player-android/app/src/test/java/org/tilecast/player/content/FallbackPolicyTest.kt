package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Test

class FallbackPolicyTest {
    @Test fun cachedAssignedContentWinsOverTransientOfflineState() {
        assertEquals(
            BrandedFallbackKind.ASSIGNED_CONTENT,
            resolveBrandedFallbackKind(true, false, true, false, false),
        )
    }

    @Test fun disabledWinsOverEmptyOrOfflineState() {
        assertEquals(
            BrandedFallbackKind.DISABLED,
            resolveBrandedFallbackKind(false, true, true, false, false),
        )
    }

    @Test fun knownEmptyAssignmentUsesOfflineOrNoContentBranding() {
        assertEquals(BrandedFallbackKind.OFFLINE, resolveBrandedFallbackKind(false, false, true, false, false))
        assertEquals(BrandedFallbackKind.NO_CONTENT, resolveBrandedFallbackKind(false, false, true, false, true))
    }

    @Test fun assignedButUnavailableContentGetsAnUnavailableSurface() {
        assertEquals(BrandedFallbackKind.UNAVAILABLE, resolveBrandedFallbackKind(false, false, true, true, true))
    }

    @Test fun unknownAssignmentStaysInConnectionUi() {
        assertEquals(BrandedFallbackKind.WAITING, resolveBrandedFallbackKind(false, false, false, false, false))
    }
}
