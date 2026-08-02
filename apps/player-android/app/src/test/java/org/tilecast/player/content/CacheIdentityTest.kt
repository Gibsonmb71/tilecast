package org.tilecast.player.content

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CacheIdentityTest {
    private val identity = cacheIdentity("https://signage.example.test/", "installation-a", "screen-a")!!

    @Test
    fun offlineRestartAcceptsTheSameNormalizedIdentity() {
        assertTrue(identity.matches("installation-a", "screen-a", "https://signage.example.test"))
    }

    @Test
    fun serverReplacementAndScreenReassignmentRejectCachedState() {
        assertFalse(identity.matches("installation-b", "screen-a", identity.normalizedServerUrl))
        assertFalse(identity.matches("installation-a", "screen-b", identity.normalizedServerUrl))
        assertFalse(identity.matches("installation-a", "screen-a", "https://other.example.test"))
    }

    @Test
    fun identityIsUnavailableBeforePairing() {
        assertNull(cacheIdentity("https://signage.example.test", null, "screen-a"))
        assertNull(cacheIdentity("https://signage.example.test", "installation-a", null))
    }
}
