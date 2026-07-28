package org.tilecast.player.content

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test
import org.tilecast.player.network.DocumentDataset
import org.tilecast.player.network.DocumentRecord
import org.tilecast.player.network.DocumentValue

class TemporalPresentationTest {
    private val now = Instant.parse("2026-08-24T13:30:00Z")
    private val dataset = DocumentDataset(
        id = "records",
        kind = "records",
        records = listOf(
            event("algebra", "2026-08-24T13:00:00Z", "2026-08-24T14:00:00Z"),
            event("science", "2026-08-24T14:10:00Z", "2026-08-24T15:00:00Z"),
            event("art", "2026-08-24T15:10:00Z", "2026-08-24T16:00:00Z"),
        ),
    )

    @Test
    fun selectsCurrentAndUpcomingRecordsFromPlayerTime() {
        assertEquals(
            listOf("algebra"),
            temporalRecords(dataset, now, "current", "start", "end").map { it.id },
        )
        assertEquals(
            listOf("science"),
            temporalRecords(dataset, now, "next", "start", "end").map { it.id },
        )
        assertEquals(
            listOf("science", "art"),
            temporalRecords(dataset, now, "upcoming", "start", "end").map { it.id },
        )
    }

    @Test
    fun formatsARecordDatetimeAsALiveCountdown() {
        assertEquals(
            "40m 0s",
            formatValue("2026-08-24T14:10:00Z", "relative-countdown", null, now),
        )
        assertEquals(
            "Now",
            formatValue("2026-08-24T13:29:59Z", "relative-countdown", null, now),
        )
    }

    private fun event(id: String, start: String, end: String) = DocumentRecord(
        id = id,
        values = mapOf(
            "start" to DocumentValue(kind = "datetime", datetime = start),
            "end" to DocumentValue(kind = "datetime", datetime = end),
        ),
    )
}
