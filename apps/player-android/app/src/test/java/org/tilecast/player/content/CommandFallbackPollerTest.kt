package org.tilecast.player.content

import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.ApiException
import org.tilecast.player.network.PlayerCommand
import org.tilecast.player.network.PlayerCommandList

// Regression test for https://github.com/Gibsonmb71/tilecast/issues/88: Studio commands
// stranded in `pending` when the Player WebSocket wedges silently. The fallback timer must
// recover the command over plain HTTP, execute it exactly once even against a concurrent
// notification poll, and stop on credential rejection.
class CommandFallbackPollerTest {
    private fun command(id: String = "command-1") = PlayerCommand(
        id = id,
        type = "sync_now",
        payload = buildJsonObject {},
        idempotencyKey = "key-$id",
        state = "pending",
        createdAt = Instant.now().toString(),
        expiresAt = Instant.now().plus(1, ChronoUnit.HOURS).toString(),
    )

    private class QueueTransport : CommandTransport {
        var available = listOf<PlayerCommand>()
        var listFailure: Exception? = null
        var acknowledgements = 0

        override suspend fun commands(server: String, credential: String): PlayerCommandList {
            listFailure?.let { throw it }
            return PlayerCommandList(available)
        }

        override suspend fun acknowledge(server: String, credential: String, commandID: String) {
            acknowledgements++
            // Acknowledged commands leave the pending queue, like the real server.
            available = available.filterNot { it.id == commandID }
        }

        override suspend fun result(server: String, credential: String, commandID: String, outcome: CommandOutcome) {}
    }

    private class MemoryStore : CommandStateStore {
        private val completed = mutableSetOf<String>()
        override var playbackDisabled = false
        override fun isCompleted(idempotencyKey: String) = idempotencyKey in completed
        override suspend fun markCompleted(idempotencyKey: String) {
            completed += idempotencyKey
        }
    }

    @Test
    fun timerRecoversACommandTheSocketNeverAnnounced() = runTest {
        val transport = QueueTransport()
        val coordinator = CommandCoordinator(transport, MemoryStore())
        val poller = CommandFallbackPoller(intervalMillis = 7_000L)
        var executed = 0
        val pollOnce: suspend () -> Unit = {
            runCommandPollSafely(
                poll = { coordinator.fetchAndRun("https://tilecast", "credential") { executed++; CommandOutcome(true, "manifest_sync_started", "ok") } },
                onFailure = {},
                onCredentialRejected = { poller.stop() },
            )
        }

        // 1. Initial explicit poll returns no commands, then the poller starts.
        pollOnce()
        assertEquals(0, executed)
        poller.ensureStarted(this, "server|1", pollOnce)

        // 2. A command becomes available with no WebSocket notification.
        transport.available = listOf(command())

        // 3. Advancing the fallback timer recovers, acknowledges, and executes it once.
        advanceTimeBy(7_001L)
        runCurrent()
        assertEquals(1, executed)
        assertEquals(1, transport.acknowledgements)

        // Later ticks do not re-execute the acknowledged command.
        advanceTimeBy(14_000L)
        runCurrent()
        assertEquals(1, executed)
        poller.stop()
    }

    @Test
    fun simultaneousExplicitPollDoesNotDuplicateTheAction() = runTest {
        val transport = QueueTransport().apply { available = listOf(command()) }
        val coordinator = CommandCoordinator(transport, MemoryStore())
        var executed = 0
        val poll: suspend () -> Unit = {
            coordinator.fetchAndRun("https://tilecast", "credential") { executed++; CommandOutcome(true, "manifest_sync_started", "ok") }
        }

        // A notification-driven poll and a timer poll racing: the coordinator's mutex
        // serializes them and acknowledgement empties the queue for the second poll.
        val first = launch { poll() }
        val second = launch { poll() }
        first.join()
        second.join()

        assertEquals(1, executed)
        assertEquals(1, transport.acknowledgements)
    }

    @Test
    fun credentialRejectionStopsTheFallbackLoop() = runTest {
        val transport = QueueTransport()
        val coordinator = CommandCoordinator(transport, MemoryStore())
        val poller = CommandFallbackPoller(intervalMillis = 7_000L)
        var polls = 0
        val pollOnce: suspend () -> Unit = {
            polls++
            runCommandPollSafely(
                poll = { coordinator.fetchAndRun("https://tilecast", "credential") { CommandOutcome(true, "ok", "ok") } },
                onFailure = {},
                onCredentialRejected = { poller.stop() },
            )
        }
        poller.ensureStarted(this, "server|1", pollOnce)
        advanceTimeBy(7_001L)
        runCurrent()
        assertEquals(1, polls)
        assertTrue(poller.running)

        transport.listFailure = ApiException(401, "device_credential_revoked", "Revoked")
        advanceTimeBy(7_000L)
        runCurrent()
        assertEquals(2, polls)
        assertFalse(poller.running)

        // No further ticks after the credential is rejected.
        advanceTimeBy(70_000L)
        runCurrent()
        assertEquals(2, polls)
    }

    @Test
    fun ensureStartedIsIdempotentWhileRunning() = runTest {
        val poller = CommandFallbackPoller(intervalMillis = 7_000L)
        var polls = 0
        poller.ensureStarted(this, "server|1") { polls++ }
        poller.ensureStarted(this, "server|1") { polls++ }
        advanceTimeBy(7_001L)
        runCurrent()
        assertEquals(1, polls)
        poller.stop()
    }

    @Test
    fun changedTargetReplacesTheLoopInsteadOfPollingStale() = runTest {
        val poller = CommandFallbackPoller(intervalMillis = 7_000L)
        var oldPolls = 0
        var newPolls = 0
        poller.ensureStarted(this, "old-server|1") { oldPolls++ }
        advanceTimeBy(7_001L)
        runCurrent()
        assertEquals(1, oldPolls)

        // Re-pair / URL change: same poller, new key -> the stale loop is replaced.
        poller.ensureStarted(this, "new-server|2") { newPolls++ }
        advanceTimeBy(14_001L)
        runCurrent()
        assertEquals(1, oldPolls)
        assertEquals(2, newPolls)
        poller.stop()
    }
}
