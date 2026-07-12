package org.tilecast.player.core

import org.tilecast.player.network.EnrollmentResult
import org.tilecast.player.network.PairingPoll
import org.tilecast.player.security.CredentialStore

interface PairingGateway {
    suspend fun poll(sessionId: String, pollSecret: String): PairingPoll
    suspend fun enroll(sessionId: String, enrollmentToken: String): EnrollmentResult
}

class PairingCoordinator(private val gateway: PairingGateway, private val credentials: CredentialStore, private val wait: suspend () -> Unit) {
    suspend fun complete(sessionId: String, pollSecret: String): EnrollmentResult {
        while (true) {
            val result: PairingPoll = gateway.poll(sessionId, pollSecret)
            when (result.status) {
                "pending", "approved" -> wait()
                "claimed" -> {
                    val token = requireNotNull(result.enrollmentToken) { "Claimed pairing did not contain an enrollment token" }
                    return gateway.enroll(sessionId, token).also { credentials.save(it.deviceCredential) }
                }
                "rejected" -> error(result.failureReason ?: "Pairing rejected")
                else -> error("Pairing ${result.status}")
            }
        }
    }

    fun handleRevocation() = credentials.clear()
}
