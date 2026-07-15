package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Test
import org.tilecast.player.network.CalendarEvent
import org.tilecast.player.network.CalendarPreparedData
import org.tilecast.player.network.CalendarSourceConfig
import java.time.Instant

class CalendarPlaybackTest {
    @Test
    fun todayUsesConfiguredTimezoneAndIncludesAllDayEvents() {
        val config = CalendarSourceConfig(
            displayMode = "today",
            timezone = "America/New_York",
            data = CalendarPreparedData(events = listOf(
                CalendarEvent("1", "School", "All day", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z", true),
                CalendarEvent("2", "School", "Tomorrow", "2026-03-09T13:00:00Z", "2026-03-09T14:00:00Z", false),
            )),
        )
        val events = visibleCalendarEvents(config, Instant.parse("2026-03-08T16:00:00Z"))
        assertEquals(listOf("All day"), events.map { it.title })
    }
}
