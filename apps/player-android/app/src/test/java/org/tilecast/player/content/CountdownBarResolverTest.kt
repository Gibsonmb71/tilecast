package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.ManifestPluginConfig
import org.tilecast.player.network.ManifestPlugin
import java.time.Instant

/**
 * These mirror the Linux renderer's countdown-bar-resolver tests case for case,
 * so a divergence between the two players shows up as a failure here.
 */
class CountdownBarResolverTest {
    private fun weekly(
        priority: Int = 10,
        message: String = "Lunch ends in",
        displayMode: String = "overlay",
        progressFill: String = "none",
        id: String = "bar-1",
    ) = ManifestPlugin(
        id = id,
        type = "countdown_bar",
        version = 1,
        config = ManifestPluginConfig(
            name = "Lunch",
            message = message,
            scheduleType = "weekly",
            targetTime = "12:00",
            daysOfWeek = listOf(1),
            timezone = "America/New_York",
            leadTimeSeconds = 900,
            completionText = "Lunch is over",
            displayMode = displayMode,
            heightPx = 72,
            progressFill = progressFill,
            priority = priority,
        ),
    )

    private fun oneTime(progressFill: String = "none") = ManifestPlugin(
        id = "bar-1",
        type = "countdown_bar",
        version = 1,
        config = weekly(progressFill = progressFill).config.copy(
            scheduleType = "one_time",
            targetTime = null,
            daysOfWeek = emptyList(),
            oneTimeAt = "2026-07-27T16:00:00Z",
        ),
    )

    @Test
    fun `evaluates weekly wall time in the configured timezone`() {
        val active = resolveCountdownBar(listOf(weekly()), Instant.parse("2026-07-27T15:50:00Z"))
        assertEquals("Lunch ends in", active?.message)
        assertEquals("10m 0s", active?.value)
        assertEquals(Instant.parse("2026-07-27T16:00:00Z"), active?.targetAt)
    }

    @Test
    fun `hides outside the lead window`() {
        assertNull(resolveCountdownBar(listOf(weekly()), Instant.parse("2026-07-27T15:30:00Z")))
    }

    @Test
    fun `shows completion text for one minute and then hides`() {
        assertEquals(
            "Lunch is over",
            resolveCountdownBar(listOf(oneTime()), Instant.parse("2026-07-27T16:00:30Z"))?.value,
        )
        assertNull(resolveCountdownBar(listOf(oneTime()), Instant.parse("2026-07-27T16:01:01Z")))
    }

    @Test
    fun `selects the highest priority active instance`() {
        val low = weekly(priority = 1, message = "Low")
        val high = weekly(priority = 50, message = "High", displayMode = "push", id = "bar-2")
        val active = resolveCountdownBar(listOf(low, high), Instant.parse("2026-07-27T15:50:00Z"))
        assertEquals("bar-2", active?.id)
        assertEquals("High", active?.message)
        assertEquals("push", active?.displayMode)
    }

    @Test
    fun `applies the persisted server clock offset`() {
        val active = resolveCountdownBar(
            listOf(weekly()),
            Instant.parse("2026-07-27T15:45:00Z"),
            clockOffsetSeconds = 5 * 60,
        )
        assertEquals("10m 0s", active?.value)
    }

    @Test
    fun `reports no fill fraction unless the instance opts in`() {
        val active = resolveCountdownBar(listOf(weekly()), Instant.parse("2026-07-27T15:50:00Z"))
        assertNull(active?.remainingFraction)
    }

    @Test
    fun `drains the fill across the lead window`() {
        val plugin = weekly(progressFill = "drain")
        fun at(iso: String) =
            resolveCountdownBar(listOf(plugin), Instant.parse(iso))?.remainingFraction
        assertEquals(1f, at("2026-07-27T15:45:00Z")!!, 0.001f)
        assertEquals(2f / 3f, at("2026-07-27T15:50:00Z")!!, 0.001f)
        assertEquals(0.5f, at("2026-07-27T15:52:30Z")!!, 0.001f)
        assertEquals(1f / 900f, at("2026-07-27T15:59:59Z")!!, 0.001f)
    }

    @Test
    fun `holds the fill at empty while completion text shows`() {
        val active =
            resolveCountdownBar(listOf(oneTime(progressFill = "drain")), Instant.parse("2026-07-27T16:00:30Z"))
        assertEquals("Lunch is over", active?.value)
        assertEquals(0f, active?.remainingFraction!!, 0.001f)
    }

    @Test
    fun `keeps the target at local noon across a daylight saving change`() {
        // 2026-11-01 is the US fall-back Sunday; the following Monday is standard time.
        val plugin = weekly()
        val summer = resolveCountdownBar(listOf(plugin), Instant.parse("2026-10-26T15:50:00Z"))
        val winter = resolveCountdownBar(listOf(plugin), Instant.parse("2026-11-02T16:50:00Z"))
        assertEquals(Instant.parse("2026-10-26T16:00:00Z"), summer?.targetAt)
        assertEquals(Instant.parse("2026-11-02T17:00:00Z"), winter?.targetAt)
    }

    @Test
    fun `ignores plugins of another type or version`() {
        val other = weekly().copy(type = "something_else")
        val future = weekly().copy(version = 2)
        assertNull(resolveCountdownBar(listOf(other, future), Instant.parse("2026-07-27T15:50:00Z")))
    }

    @Test
    fun `clamps an out of range height`() {
        val tall = weekly().let { it.copy(config = it.config.copy(heightPx = 999)) }
        val active = resolveCountdownBar(listOf(tall), Instant.parse("2026-07-27T15:50:00Z"))
        assertTrue(active!!.heightPx == 320)
    }
}
