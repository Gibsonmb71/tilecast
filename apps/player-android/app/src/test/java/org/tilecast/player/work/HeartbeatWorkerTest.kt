package org.tilecast.player.work

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.BackgroundLivenessApi
import org.tilecast.player.network.ServerIdentity

class HeartbeatWorkerTest {
    @Test
    fun backgroundHeartbeatOnlySendsLivenessAfterIdentityMatch() = runTest {
        val calls = mutableListOf<String>()
        val api = object : BackgroundLivenessApi {
            override suspend fun identity(serverUrl: String): ServerIdentity {
                calls += "identity:$serverUrl"
                return ServerIdentity("Tilecast", "install-1", "District", "v1", true)
            }

            override suspend fun liveness(serverUrl: String, credential: String) {
                calls += "liveness:$serverUrl:$credential"
            }
        }

        val result = sendBackgroundLiveness(api, "https://signage.example", "install-1", "credential")

        assertEquals(BackgroundLivenessResult.ACCEPTED, result)
        assertEquals(listOf("identity:https://signage.example", "liveness:https://signage.example:credential"), calls)
    }

    @Test
    fun installationMismatchNeverSendsCredentialOrChangesPlayerStatus() = runTest {
        var livenessCalled = false
        val api = object : BackgroundLivenessApi {
            override suspend fun identity(serverUrl: String) = ServerIdentity("Tilecast", "other-install", "District", "v1", true)
            override suspend fun liveness(serverUrl: String, credential: String) { livenessCalled = true }
        }

        val result = sendBackgroundLiveness(api, "https://signage.example", "install-1", "credential")

        assertEquals(BackgroundLivenessResult.INSTALLATION_MISMATCH, result)
        assertTrue(!livenessCalled)
    }
}
