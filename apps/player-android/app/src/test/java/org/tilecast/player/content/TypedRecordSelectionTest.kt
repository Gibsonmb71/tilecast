package org.tilecast.player.content

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test
import org.tilecast.player.network.DateSelection
import org.tilecast.player.network.TypedRecord
import org.tilecast.player.network.TypedRecordData

class TypedRecordSelectionTest {
    @Test
    fun selectsTodaysManualRecordInConfiguredTimezone() {
        val data = TypedRecordData(
            records = listOf(
                TypedRecord("one", mapOf("date" to "2026-07-15", "title" to "Old")),
                TypedRecord("two", mapOf("date" to "2026-07-16", "title" to "Today")),
            ),
            dateField = "date",
            dateSelection = DateSelection(enabled = true, timezone = "America/New_York", mode = "today"),
        )

        val selected = selectedTypedRecords(data, Instant.parse("2026-07-16T16:00:00Z"))

        assertEquals("Today", selected.single().values["title"])
    }

    @Test
    fun selectsTheFirstNextAvailableDate() {
        val data = TypedRecordData(
            records = listOf(
                TypedRecord("one", mapOf("date" to "2026-07-18")),
                TypedRecord("two", mapOf("date" to "2026-07-18")),
                TypedRecord("three", mapOf("date" to "2026-07-20")),
            ),
            dateField = "date",
            dateSelection = DateSelection(enabled = true, timezone = "UTC", mode = "next_available"),
        )

        assertEquals(2, selectedTypedRecords(data, Instant.parse("2026-07-16T12:00:00Z")).size)
    }
}
