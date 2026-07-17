package org.tilecast.player.content

import java.io.IOException
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.ApiException
import org.tilecast.player.network.PlayerCommand
import org.tilecast.player.network.PlayerCommandList

class CommandCoordinatorTest {
    @Test
    fun httpFailureIsDiagnosticAndDoesNotStopHealthyPlayerWork() = runTest {
        var playbackActive = true
        var manifestSyncActive = true
        var configSyncActive = true
        var diagnostic: String? = null

        runCommandPollSafely(
            poll = { throw ApiException(500, "internal_error", "Request failed") },
            onFailure = { diagnostic = it },
            onCredentialRejected = { error("credential recovery must not run") },
        )

        assertEquals("internal_error", diagnostic)
        assertTrue(playbackActive)
        assertTrue(manifestSyncActive)
        assertTrue(configSyncActive)
    }

    @Test
    fun networkFailureDoesNotEscapeCommandPoll() = runTest {
        var diagnostic: String? = null
        runCommandPollSafely(
            poll = { throw IOException("offline") },
            onFailure = { diagnostic = it },
            onCredentialRejected = { error("credential recovery must not run") },
        )
        assertEquals("command_poll_failed", diagnostic)
    }

    @Test
    fun revokedCredentialStillStartsRecovery() = runTest {
        var recoveryStarted = false
        runCommandPollSafely(
            poll = { throw ApiException(401, "device_credential_revoked", "Revoked") },
            onFailure = {},
            onCredentialRejected = { recoveryStarted = true },
        )
        assertTrue(recoveryStarted)
    }

    @Test
    fun laterPollProcessesCommandAfterListFailure() = runTest {
        val transport = FakeCommandTransport(command())
        transport.listFailure = IOException("temporary failure")
        val store = FakeCommandStateStore()
        val coordinator = CommandCoordinator(transport, store)
        var handled = 0

        runCommandPollSafely(
            poll = { coordinator.fetchAndRun("https://tilecast", "credential") { success(it).also { handled++ } } },
            onFailure = {},
            onCredentialRejected = {},
        )
        transport.listFailure = null
        runCommandPollSafely(
            poll = { coordinator.fetchAndRun("https://tilecast", "credential") { success(it).also { handled++ } } },
            onFailure = {},
            onCredentialRejected = {},
        )

        assertEquals(1, handled)
        assertEquals(1, transport.acknowledgements)
        assertEquals(1, transport.results)
    }

    @Test
    fun resultPostFailureDoesNotRepeatSuccessfulLocalAction() = runTest {
        val command = command()
        val transport = FakeCommandTransport(command).apply { resultFailure = IOException("offline") }
        val store = FakeCommandStateStore()
        val coordinator = CommandCoordinator(transport, store)
        var handled = 0
        var diagnostic: String? = null

        coordinator.fetchAndRun("https://tilecast", "credential", { diagnostic = it }) {
            handled++
            success(it)
        }
        transport.resultFailure = null
        coordinator.fetchAndRun("https://tilecast", "credential", { diagnostic = it }) {
            handled++
            success(it)
        }

        assertEquals("command_result_failed", diagnostic)
        assertEquals(1, handled)
        assertTrue(store.isCompleted(command.idempotencyKey))
        assertEquals(2, transport.results)
    }

    @Test
    fun failedLocalActionDoesNotCompleteIdempotencyKey() = runTest {
        val command = command()
        val store = FakeCommandStateStore()
        val coordinator = CommandCoordinator(FakeCommandTransport(command), store)

        coordinator.fetchAndRun("https://tilecast", "credential") {
            CommandOutcome(false, "command_failed", "Action failed")
        }

        assertFalse(store.isCompleted(command.idempotencyKey))
    }

    @Test
    fun malformedExpiryDoesNotBlockOtherCommands() = runTest {
        val broken = command(id = "1", idempotencyKey = "key-1", expiresAt = "not-a-timestamp")
        val healthy = command(id = "2", idempotencyKey = "key-2")
        val transport = FakeCommandTransport(broken, healthy)
        val coordinator = CommandCoordinator(transport, FakeCommandStateStore())
        val handledIds = mutableListOf<String>()

        coordinator.fetchAndRun("https://tilecast", "credential") { command ->
            handledIds += command.id
            success(command)
        }

        // The unparseable expiry is treated as still valid; both commands run.
        assertEquals(listOf("1", "2"), handledIds)
        assertEquals(2, transport.results)
    }

    @Test
    fun expiredCommandIsSkippedWithoutAcknowledgement() = runTest {
        val expired = command(id = "1", idempotencyKey = "key-1", expiresAt = Instant.now().minus(1, ChronoUnit.MINUTES).toString())
        val healthy = command(id = "2", idempotencyKey = "key-2")
        val transport = FakeCommandTransport(expired, healthy)
        val coordinator = CommandCoordinator(transport, FakeCommandStateStore())
        val handledIds = mutableListOf<String>()

        coordinator.fetchAndRun("https://tilecast", "credential") { command ->
            handledIds += command.id
            success(command)
        }

        assertEquals(listOf("2"), handledIds)
        assertEquals(1, transport.acknowledgements)
    }

    private fun command(
        id: String = "00000000-0000-0000-0000-000000000001",
        idempotencyKey: String = "00000000-0000-0000-0000-000000000002",
        expiresAt: String = Instant.now().plus(10, ChronoUnit.MINUTES).toString(),
    ) = PlayerCommand(
        id = id,
        type = "sync_now",
        payload = buildJsonObject {},
        idempotencyKey = idempotencyKey,
        state = "delivered",
        createdAt = Instant.now().minus(1, ChronoUnit.MINUTES).toString(),
        expiresAt = expiresAt,
    )

    private fun success(command: PlayerCommand) =
        CommandOutcome(true, "${command.type}_completed", "Command completed")
}

private class FakeCommandTransport(private vararg val queued: PlayerCommand) : CommandTransport {
    var listFailure: Exception? = null
    var resultFailure: Exception? = null
    var acknowledgements = 0
    var results = 0

    override suspend fun commands(server: String, credential: String): PlayerCommandList {
        listFailure?.let { throw it }
        return PlayerCommandList(queued.toList())
    }

    override suspend fun acknowledge(server: String, credential: String, commandID: String) {
        acknowledgements++
    }

    override suspend fun result(
        server: String,
        credential: String,
        commandID: String,
        outcome: CommandOutcome,
    ) {
        results++
        resultFailure?.let { throw it }
    }
}

private class FakeCommandStateStore : CommandStateStore {
    private val completed = mutableSetOf<String>()
    override var playbackDisabled = false

    override fun isCompleted(idempotencyKey: String) = idempotencyKey in completed

    override suspend fun markCompleted(idempotencyKey: String) {
        completed += idempotencyKey
    }
}
