package org.tilecast.player.core

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.tilecast.player.network.EnrollmentResult
import org.tilecast.player.network.PairingPoll
import org.tilecast.player.security.CredentialStore

class PairingCoordinatorTest {
    @Test fun pollsEnrollsAndStoresCredentialOnce() = runTest {
        val store = FakeStore()
        var polls = 0
        val gateway = object : PairingGateway {
            override suspend fun poll(sessionId: String, pollSecret: String): PairingPoll = if (polls++ == 0) PairingPoll("pending", "later") else PairingPoll("claimed", "later", enrollmentToken = "enroll-once")
            override suspend fun enroll(sessionId: String, enrollmentToken: String) = EnrollmentResult("screen", "Lobby", "tc_device_public.secret")
        }
        val result = PairingCoordinator(gateway, store) { }.complete("session", "private-poll")
        assertEquals("Lobby", result.screenName)
        assertEquals("tc_device_public.secret", store.value)
        assertEquals(2, polls)
    }
    @Test fun revocationClearsSecureStorage() {
        val store = FakeStore().apply { save("credential") }
        val gateway = object : PairingGateway { override suspend fun poll(sessionId: String, pollSecret: String) = error("unused"); override suspend fun enroll(sessionId: String, enrollmentToken: String) = error("unused") }
        PairingCoordinator(gateway, store) { }.handleRevocation()
        assertNull(store.value)
    }
    private class FakeStore : CredentialStore { var value: String? = null; override fun save(credential: String) { value = credential }; override fun read() = value; override fun clear() { value = null } }
}

