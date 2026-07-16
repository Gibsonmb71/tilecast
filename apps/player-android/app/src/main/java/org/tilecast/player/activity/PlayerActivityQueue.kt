package org.tilecast.player.activity

import android.content.Context
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.tilecast.player.data.ConfigurationRepository
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.network.PlayerActivityBatch
import org.tilecast.player.network.PlayerActivityEvent
import org.tilecast.player.network.TilecastApi
import org.tilecast.player.network.activityEvents
import org.tilecast.player.security.KeystoreCredentialStore
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.Executors

@Serializable
internal data class PersistedActivityQueue(
    val nextSequence: Long = 1,
    val events: List<PlayerActivityEvent> = emptyList(),
)

internal class ActivityQueueStore(
    private val file: File,
    private val maximumEvents: Int = 5_000,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
) {
    private val lock = Any()

    fun append(event: PlayerActivityEvent): PlayerActivityEvent = synchronized(lock) {
        val current = read()
        val sequenced = event.copy(sequence = current.nextSequence)
        val kept = trim(current.events + sequenced)
        write(PersistedActivityQueue(current.nextSequence + 1, kept))
        sequenced
    }

    fun peek(limit: Int): List<PlayerActivityEvent> = synchronized(lock) {
        read().events.sortedBy { it.sequence }.take(limit.coerceIn(1, 200))
    }

    fun acknowledge(ids: Set<String>) = synchronized(lock) {
        if (ids.isEmpty()) return@synchronized
        val current = read()
        write(current.copy(events = current.events.filterNot { it.id in ids }))
    }

    fun size(): Int = synchronized(lock) { read().events.size }

    private fun trim(events: List<PlayerActivityEvent>): List<PlayerActivityEvent> {
        if (events.size <= maximumEvents) return events
        val overflow = events.size - maximumEvents
        val lowPriority = events.withIndex().filter { it.value.priority <= 4 }.take(overflow).map { it.index }.toSet()
        val remainingOverflow = overflow - lowPriority.size
        val oldestRemaining = events.indices.filterNot { it in lowPriority }.take(remainingOverflow).toSet()
        val dropped = lowPriority + oldestRemaining
        return events.filterIndexed { index, _ -> index !in dropped }
    }

    private fun read(): PersistedActivityQueue {
        if (!file.exists()) return PersistedActivityQueue()
        return runCatching { json.decodeFromString<PersistedActivityQueue>(file.readText()) }.getOrElse { PersistedActivityQueue() }
    }

    private fun write(value: PersistedActivityQueue) {
        file.parentFile?.mkdirs()
        val temporary = File(file.parentFile, "${file.name}.${UUID.randomUUID()}.tmp")
        FileOutputStream(temporary).use { output ->
            output.write(json.encodeToString(PersistedActivityQueue.serializer(), value).toByteArray())
            output.fd.sync()
        }
        if (!temporary.renameTo(file)) {
            file.delete()
            check(temporary.renameTo(file)) { "Could not persist Player activity queue" }
        }
    }
}

internal class ActivityRetryBackoff(
    private val minimumDelayMs: Long = 5_000,
    private val maximumDelayMs: Long = 300_000,
) {
    private var delayMs = minimumDelayMs
    private var nextAttemptAt = 0L

    fun canAttempt(nowElapsedMs: Long): Boolean = nowElapsedMs >= nextAttemptAt

    fun failed(nowElapsedMs: Long) {
        nextAttemptAt = nowElapsedMs + delayMs
        delayMs = (delayMs * 2).coerceAtMost(maximumDelayMs)
    }

    fun succeeded() {
        delayMs = minimumDelayMs
        nextAttemptAt = 0L
    }

    fun nextAttemptAtElapsedMs(): Long = nextAttemptAt
}

class PlayerActivityQueue private constructor(
    context: Context,
    private val api: TilecastApi = TilecastApi(),
) {
    private val app = context.applicationContext
    private val store = ActivityQueueStore(File(app.filesDir, "activity/player-activity.json"))
    private val flushMutex = Mutex()
    private val retryBackoff = ActivityRetryBackoff()
    private val persistenceDispatcher = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "tilecast-activity-queue").apply { isDaemon = true }
    }.asCoroutineDispatcher()
    private val persistenceScope = CoroutineScope(SupervisorJob() + persistenceDispatcher)

    init {
        persistenceScope.launch {
            while (true) {
                delay(5_000)
                runCatching { flushConfigured() }
            }
        }
    }

    fun record(
        eventType: String,
        category: String = "",
        severity: String = "info",
        manifestVersion: Long? = null,
        presentationType: String = "",
        presentationId: String = "",
        presentationRevision: String = "",
        contentType: String = "",
        contentId: String = "",
        playlistItemId: String = "",
        layoutPlacementId: String = "",
        activitySessionId: String = "",
        result: String = "unknown",
        durationMs: Long? = null,
        expectedDurationMs: Long? = null,
        failureCode: String = "",
        failureMessage: String = "",
        trigger: String = "",
        scheduleId: String = "",
        emergencyId: String = "",
        sourceId: String = "",
        selectedRecordId: String = "",
        selectionDate: String = "",
        sourceCachedAt: String? = null,
        sourceRevision: String = "",
        snapshotHash: String = "",
        metadata: JsonObject = buildJsonObject {},
        priority: Int = 5,
    ) {
        val event = PlayerActivityEvent(
            id = UUID.randomUUID().toString(),
            sequence = 0,
            eventType = eventType,
            category = category,
            severity = severity,
            occurredAt = Instant.now().toString(),
            elapsedRealtimeMs = SystemClock.elapsedRealtime(),
            playerTimezone = ZoneId.systemDefault().id,
            manifestVersion = manifestVersion,
            presentationType = presentationType,
            presentationId = presentationId,
            presentationRevision = presentationRevision,
            contentType = contentType,
            contentId = contentId,
            playlistItemId = playlistItemId,
            layoutPlacementId = layoutPlacementId,
            activitySessionId = activitySessionId,
            result = result,
            durationMs = durationMs?.coerceAtLeast(0),
            expectedDurationMs = expectedDurationMs?.coerceAtLeast(0),
            failureCode = failureCode.take(96),
            failureMessage = failureMessage.take(240),
            trigger = trigger.take(96),
            scheduleId = scheduleId,
            emergencyId = emergencyId,
            sourceId = sourceId,
            selectedRecordId = selectedRecordId,
            selectionDate = selectionDate,
            sourceCachedAt = sourceCachedAt,
            sourceRevision = sourceRevision,
            snapshotHash = snapshotHash,
            metadata = metadata,
            priority = priority.coerceIn(0, 9),
        )
        persistenceScope.launch { runCatching { store.append(event) } }
    }

    suspend fun flushConfigured() = withContext(Dispatchers.IO) {
        flushMutex.withLock {
            val now = SystemClock.elapsedRealtime()
            if (!retryBackoff.canAttempt(now)) return@withLock
            val configuration = ConfigurationRepository(PlayerDatabase.get(app).configuration()).getOrCreate()
            val serverUrl = configuration.serverUrl ?: return@withLock
            val credential = KeystoreCredentialStore(app).read() ?: return@withLock
            while (true) {
                val batch = store.peek(100)
                if (batch.isEmpty()) {
                    retryBackoff.succeeded()
                    return@withLock
                }
                val response = runCatching {
                    api.activityEvents(serverUrl, credential, PlayerActivityBatch(batch))
                }.getOrElse {
                    retryBackoff.failed(SystemClock.elapsedRealtime())
                    return@withLock
                }
                val acknowledged = response.acknowledgedEventIds.toSet()
                if (acknowledged.isEmpty()) {
                    retryBackoff.failed(SystemClock.elapsedRealtime())
                    return@withLock
                }
                store.acknowledge(acknowledged)
                retryBackoff.succeeded()
                if (batch.size < 100) return@withLock
            }
        }
    }

    fun pendingCount(): Int = store.size()

    companion object {
        @Volatile private var instance: PlayerActivityQueue? = null
        fun get(context: Context): PlayerActivityQueue = instance ?: synchronized(this) {
            instance ?: PlayerActivityQueue(context).also { instance = it }
        }
    }
}

class PlaybackActivityReporter(
    private val queue: PlayerActivityQueue,
    private val manifestVersion: Long,
    private val presentationType: String,
    private val presentationId: String,
    private val presentationRevision: String,
    private val trigger: String,
    private val scheduleId: String,
    private val emergencyId: String,
) {
    private val rootSession = UUID.randomUUID().toString()
    private val rootStartedElapsed = SystemClock.elapsedRealtime()

    fun presentationStarted() {
        queue.record(
            eventType = "presentation.started",
            category = "playback",
            manifestVersion = manifestVersion,
            presentationType = presentationType,
            presentationId = presentationId,
            presentationRevision = presentationRevision,
            activitySessionId = rootSession,
            result = "playing",
            trigger = trigger,
            scheduleId = scheduleId,
            emergencyId = emergencyId,
            metadata = buildJsonObject { put("presentationName", JsonPrimitive(presentationId)) },
            priority = 8,
        )
    }

    fun presentationStopped(result: String = "partial") {
        queue.record(
            eventType = "presentation.stopped",
            category = "playback",
            manifestVersion = manifestVersion,
            presentationType = presentationType,
            presentationId = presentationId,
            presentationRevision = presentationRevision,
            activitySessionId = rootSession,
            result = result,
            durationMs = SystemClock.elapsedRealtime() - rootStartedElapsed,
            trigger = trigger,
            scheduleId = scheduleId,
            emergencyId = emergencyId,
            priority = 8,
        )
    }

    fun childStarted(
        contentType: String,
        contentId: String,
        playlistItemId: String = "",
        layoutPlacementId: String = "",
        expectedDurationMs: Long? = null,
        sourceId: String = "",
        selectedRecordId: String = "",
        sourceCachedAt: String? = null,
        sourceRevision: String = "",
        snapshotHash: String = "",
    ): ChildSession {
        val id = UUID.randomUUID().toString()
        val started = SystemClock.elapsedRealtime()
        queue.record(
            eventType = when (contentType) { "widget" -> "widget.started"; "media" -> "media.started"; else -> "playlist_item.started" },
            category = "playback",
            manifestVersion = manifestVersion,
            presentationType = presentationType,
            presentationId = presentationId,
            presentationRevision = presentationRevision,
            contentType = contentType,
            contentId = contentId,
            playlistItemId = playlistItemId,
            layoutPlacementId = layoutPlacementId,
            activitySessionId = id,
            result = "playing",
            expectedDurationMs = expectedDurationMs,
            trigger = trigger,
            scheduleId = scheduleId,
            emergencyId = emergencyId,
            sourceId = sourceId,
            selectedRecordId = selectedRecordId,
            selectionDate = if (selectedRecordId.isNotEmpty()) LocalDate.now().toString() else "",
            sourceCachedAt = sourceCachedAt,
            sourceRevision = sourceRevision,
            snapshotHash = snapshotHash,
            metadata = buildJsonObject { put("parentActivitySessionId", JsonPrimitive(rootSession)) },
            priority = 6,
        )
        return ChildSession(id, started, contentType, contentId, playlistItemId, layoutPlacementId)
    }

    inner class ChildSession(
        private val id: String,
        private val startedElapsed: Long,
        private val contentType: String,
        private val contentId: String,
        private val playlistItemId: String,
        private val layoutPlacementId: String,
    ) {
        fun finish(result: String = "completed", failureCode: String = "", failureMessage: String = "") {
            queue.record(
                eventType = when {
                    result == "failed" && contentType == "widget" -> "widget.failed"
                    result == "failed" -> "playlist_item.failed"
                    result == "skipped" -> "playlist_item.skipped"
                    else -> "playlist_item.completed"
                },
                category = "playback",
                severity = if (result == "failed") "error" else "info",
                manifestVersion = manifestVersion,
                presentationType = presentationType,
                presentationId = presentationId,
                presentationRevision = presentationRevision,
                contentType = contentType,
                contentId = contentId,
                playlistItemId = playlistItemId,
                layoutPlacementId = layoutPlacementId,
                activitySessionId = id,
                result = result,
                durationMs = SystemClock.elapsedRealtime() - startedElapsed,
                failureCode = failureCode,
                failureMessage = failureMessage,
                trigger = trigger,
                scheduleId = scheduleId,
                emergencyId = emergencyId,
                priority = if (result == "failed") 9 else 6,
            )
        }
    }
}
