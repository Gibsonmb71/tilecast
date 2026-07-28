package org.tilecast.player.reliability

import org.junit.Assert.*
import org.junit.Test
import java.time.*

class ActiveHoursEngineTest {
    private val weekday=ActiveHoursRule(true,"America/New_York",setOf(DayOfWeek.MONDAY,DayOfWeek.FRIDAY),LocalTime.of(6,30),LocalTime.of(16,0))
    @Test fun evaluatesHalfOpenWindow(){assertTrue(ActiveHoursEngine.evaluate(Instant.parse("2026-07-13T10:30:00Z"),weekday).active);assertFalse(ActiveHoursEngine.evaluate(Instant.parse("2026-07-13T20:00:00Z"),weekday).active)}
    @Test fun overnightBelongsToStartingDay(){val rule=ActiveHoursRule(true,"America/New_York",setOf(DayOfWeek.FRIDAY),LocalTime.of(22,0),LocalTime.of(2,0));assertTrue(ActiveHoursEngine.evaluate(Instant.parse("2026-07-11T05:00:00Z"),rule).active);assertFalse(ActiveHoursEngine.evaluate(Instant.parse("2026-07-11T06:00:00Z"),rule).active)}
    @Test fun takeoverOverridesOffHours(){assertTrue(ActiveHoursEngine.evaluate(Instant.parse("2026-07-13T23:00:00Z"),weekday,true).active)}
    @Test fun springGapAdvancesDeterministically(){val rule=ActiveHoursRule(true,"America/New_York",setOf(DayOfWeek.SUNDAY),LocalTime.of(2,30),LocalTime.of(4,0));assertEquals(Instant.parse("2026-03-08T07:00:00Z"),ActiveHoursEngine.evaluate(Instant.parse("2026-03-08T06:00:00Z"),rule).nextTransition)}
}
