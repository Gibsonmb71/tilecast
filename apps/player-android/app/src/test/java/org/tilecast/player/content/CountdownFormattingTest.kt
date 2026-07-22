package org.tilecast.player.content

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CountdownFormattingTest {
    private val now = Instant.parse("2026-07-21T12:00:00Z")

    @Test
    fun dailyCountdownRollsToTheNextLocalOccurrence() {
        assertEquals(
            "2h 0m",
            formatCountdown(
                target = "2026-07-20T14:00:00",
                timezone = "UTC",
                mode = "countdown",
                recurrence = "daily",
                completionAction = "completed_text",
                completionText = "Complete",
                visibleUnits = "0110",
                now = now,
            ),
        )
    }

    @Test
    fun weeklyCountdownRollsForwardSevenDaysAtTheOccurrence() {
        assertEquals(
            Instant.parse("2026-07-28T12:00:00Z"),
            resolveCountdownTarget("2026-07-14T12:00:00", "UTC", "weekly", now),
        )
    }

    @Test
    fun completedOneTimeCountdownCanHide() {
        assertNull(
            formatCountdown(
                target = "2026-07-20T12:00:00Z",
                timezone = "UTC",
                mode = "countdown",
                recurrence = "none",
                completionAction = "hide",
                completionText = "Complete",
                visibleUnits = "1111",
                now = now,
            ),
        )
    }
}
