package org.tilecast.player.content

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.tilecast.player.network.ApiException
import org.tilecast.player.network.PlayerCommand
import org.tilecast.player.network.PlayerCommandList
import org.tilecast.player.network.TilecastApi
import java.time.Instant

data class CommandOutcome(val success: Boolean, val code: String, val message: String)

internal interface CommandTransport {
    suspend fun commands(server: String, credential: String): PlayerCommandList
    suspend fun acknowledge(server: String, credential: String, commandID: String)
    suspend fun result(
        server: String,
        credential: String,
        commandID: String,
        outcome: CommandOutcome,
    )
}

private class ApiCommandTransport(private val api: TilecastApi) : CommandTransport {
    override suspend fun commands(server: String, credential: String) = api.commands(server, credential)

    override suspend fun acknowledge(server: String, credential: String, commandID: String) =
        api.acknowledgeCommand(server, credential, commandID)

    override suspend fun result(
        server: String,
        credential: String,
        commandID: String,
        outcome: CommandOutcome,
    ) = api.commandResult(server, credential, commandID, outcome.success, outcome.code, outcome.message)
}

internal interface CommandStateStore {
    var playbackDisabled: Boolean
    fun isCompleted(idempotencyKey: String): Boolean
    suspend fun markCompleted(idempotencyKey: String)
}

private class PreferencesCommandStateStore(context: Context) : CommandStateStore {
    private val preferences = context.getSharedPreferences("tilecast-commands", Context.MODE_PRIVATE)

    override var playbackDisabled: Boolean
        get() = preferences.getBoolean("playback-disabled", false)
        set(value) {
            preferences.edit().putBoolean("playback-disabled", value).apply()
        }

    override fun isCompleted(idempotencyKey: String) =
        preferences.contains("done-$idempotencyKey")

    override suspend fun markCompleted(idempotencyKey: String) {
        withContext(Dispatchers.IO) {
            val editor = preferences.edit().putLong("done-$idempotencyKey", System.currentTimeMillis())
            // The store must not grow without bound on a device that runs unattended for
            // years; keep the most recent completions (legacy boolean entries sort oldest).
            val completed = preferences.all.filterKeys { it.startsWith("done-") }
            if (completed.size >= 512) {
                completed.entries.sortedBy { it.value as? Long ?: 0L }.take(completed.size - 256).forEach { editor.remove(it.key) }
            }
            editor.commit()
        }
    }
}

internal fun isCredentialRejection(error: ApiException) =
    error.code == "device_credential_revoked" || error.code == "device_credential_invalid"

internal suspend fun runCommandPollSafely(
    poll: suspend () -> Unit,
    onFailure: suspend (String) -> Unit,
    onCredentialRejected: suspend () -> Unit,
) {
    try {
        poll()
    } catch (error: CancellationException) {
        throw error
    } catch (error: ApiException) {
        onFailure(error.code)
        if (isCredentialRejection(error)) onCredentialRejected()
    } catch (_: Exception) {
        onFailure("command_poll_failed")
    }
}

class CommandCoordinator internal constructor(
    private val transport: CommandTransport,
    private val store: CommandStateStore,
) {
    constructor(context: Context, api: TilecastApi) : this(
        ApiCommandTransport(api),
        PreferencesCommandStateStore(context),
    )

    private val pollMutex = Mutex()
    val playbackDisabled: Boolean get() = store.playbackDisabled

    suspend fun fetchAndRun(
        server: String,
        credential: String,
        onOperationFailure: (String) -> Unit = {},
        handler: suspend (PlayerCommand) -> CommandOutcome,
    ) = pollMutex.withLock {
        transport.commands(server, credential).items.forEach { command ->
            if (store.isCompleted(command.idempotencyKey)) {
                postResultSafely(
                    server,
                    credential,
                    command,
                    CommandOutcome(
                        true,
                        "command_already_applied",
                        "Command was already applied by this player",
                    ),
                    onOperationFailure,
                )
                return@forEach
            }
            // An unparseable expiry must not abort the batch (that would permanently block
            // every command behind it); treat it as still valid and let the server expire it.
            val expired = runCatching { !Instant.now().isBefore(Instant.parse(command.expiresAt)) }.getOrDefault(false)
            if (expired) return@forEach

            try {
                transport.acknowledge(server, credential, command.id)
            } catch (error: CancellationException) {
                throw error
            } catch (error: ApiException) {
                if (isCredentialRejection(error)) throw error
                onOperationFailure(error.code)
                return@forEach
            } catch (_: Exception) {
                onOperationFailure("command_acknowledge_failed")
                return@forEach
            }

            val outcome = try {
                handler(command)
            } catch (error: CancellationException) {
                throw error
            } catch (error: ApiException) {
                if (isCredentialRejection(error)) throw error
                CommandOutcome(false, "command_failed", "The player could not complete the command")
            } catch (_: Exception) {
                CommandOutcome(false, "command_failed", "The player could not complete the command")
            }

            // Completion is local action state. Persist it before reporting so a failed result POST
            // cannot cause a successful command to execute twice after a restart.
            if (outcome.success) store.markCompleted(command.idempotencyKey)
            postResultSafely(server, credential, command, outcome, onOperationFailure)
        }
    }

    private suspend fun postResultSafely(
        server: String,
        credential: String,
        command: PlayerCommand,
        outcome: CommandOutcome,
        onOperationFailure: (String) -> Unit,
    ) {
        try {
            transport.result(server, credential, command.id, outcome)
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiException) {
            if (isCredentialRejection(error)) throw error
            onOperationFailure(error.code)
        } catch (_: Exception) {
            onOperationFailure("command_result_failed")
        }
    }

    fun setPlaybackDisabled(value: Boolean) {
        store.playbackDisabled = value
    }
}
