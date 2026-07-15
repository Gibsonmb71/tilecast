package org.tilecast.player.activity

import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.PlayerActivityEvent
import java.io.File
import java.nio.file.Files

class ActivityQueueStoreTest {
    private fun event(id: String, priority: Int = 5) = PlayerActivityEvent(
        id = id,
        sequence = 0,
        eventType = "playlist_item.started",
        occurredAt = "2026-07-15T12:00:00Z",
        playerTimezone = "America/New_York",
        metadata = buildJsonObject {},
        priority = priority,
    )

    @Test fun persistsSequenceAndAcknowledgesUploadedEvents() {
        val directory = Files.createTempDirectory("tilecast-activity").toFile()
        val file = File(directory, "queue.json")
        val first = ActivityQueueStore(file, maximumEvents = 10)
        assertEquals(1, first.append(event("one")).sequence)
        assertEquals(2, first.append(event("two")).sequence)

        val restarted = ActivityQueueStore(file, maximumEvents = 10)
        assertEquals(listOf(1L, 2L), restarted.peek(10).map { it.sequence })
        restarted.acknowledge(setOf("one"))
        assertEquals(listOf("two"), ActivityQueueStore(file, 10).peek(10).map { it.id })
    }

    @Test fun dropsOldestLowPriorityEventsBeforeOperationalFailures() {
        val file = File(Files.createTempDirectory("tilecast-activity-cap").toFile(), "queue.json")
        val store = ActivityQueueStore(file, maximumEvents = 3)
        store.append(event("routine-1", priority = 2))
        store.append(event("failure", priority = 9))
        store.append(event("routine-2", priority = 2))
        store.append(event("important", priority = 8))
        val ids = store.peek(10).map { it.id }
        assertEquals(3, ids.size)
        assertTrue("failure" in ids)
        assertTrue("important" in ids)
        assertTrue("routine-1" !in ids)
    }
}
