package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.tilecast.player.network.ManifestPlugin
import org.tilecast.player.network.ManifestPluginConfig
import java.time.Instant

/**
 * These mirror the Linux renderer's alert-ticker-resolver tests case for case, so
 * a divergence between the two players shows up as a failure here.
 */
class AlertTickerResolverTest {
    private val now: Instant = Instant.parse("2026-07-29T12:00:00Z")

    private fun ticker(
        id: String = "11111111-1111-4111-8111-111111111111",
        message: String = "Tornado Warning — take shelter now",
        speed: String = "medium",
        expiresAt: String = "2026-07-29T12:30:00Z",
        version: Int = 1,
        type: String = "alert_ticker",
    ) = ManifestPlugin(
        id = id,
        type = type,
        version = version,
        config = ManifestPluginConfig(
            name = "Tornadoes",
            message = message,
            severity = "Extreme",
            event = "Tornado Warning",
            displayMode = "push",
            heightPx = 96,
            speed = speed,
            priority = 1000,
            expiresAt = expiresAt,
        ),
    )

    @Test
    fun `shows a live alert with its geometry and travel rate`() {
        val active = resolveAlertTicker(listOf(ticker()), now)
        assertEquals("Tornado Warning — take shelter now", active?.message)
        assertEquals("Extreme", active?.severity)
        assertEquals("push", active?.displayMode)
        assertEquals(96, active?.heightPx)
        assertEquals(120f, active?.pixelsPerSecond)
    }

    @Test
    fun `translates each named speed into a travel rate`() {
        assertEquals(60f, resolveAlertTicker(listOf(ticker(speed = "slow")), now)?.pixelsPerSecond)
        assertEquals(200f, resolveAlertTicker(listOf(ticker(speed = "fast")), now)?.pixelsPerSecond)
        // An unrecognized speed from a newer server still has to scroll readably.
        assertEquals(
            120f,
            resolveAlertTicker(listOf(ticker(speed = "glacial")), now)?.pixelsPerSecond,
        )
    }

    @Test
    fun `takes the bar down once the alert can no longer be current`() {
        // The poller normally clears the activation, but an offline player has no
        // poller to hear from and must stop showing the alert on its own.
        assertNull(resolveAlertTicker(listOf(ticker()), Instant.parse("2026-07-29T12:30:01Z")))
        assertNull(resolveAlertTicker(listOf(ticker(expiresAt = "")), now))
        assertNull(resolveAlertTicker(listOf(ticker(message = "   ")), now))
    }

    @Test
    fun `applies the server clock offset before judging the expiry`() {
        // A player whose clock is an hour behind must not keep an expired alert up.
        assertNull(resolveAlertTicker(listOf(ticker()), now, 3_600))
    }

    @Test
    fun `ignores entries belonging to other plugins and other versions`() {
        assertNull(resolveAlertTicker(listOf(ticker(type = "countdown_bar")), now))
        assertNull(resolveAlertTicker(listOf(ticker(version = 2)), now))
        assertNull(resolveAlertTicker(emptyList(), now))
    }

    @Test
    fun `keeps the longest-running alert when two are live at equal priority`() {
        val longer = ticker(id = "22222222-2222-4222-8222-222222222222", expiresAt = "2026-07-29T14:00:00Z")
        assertEquals(longer.id, resolveAlertTicker(listOf(ticker(), longer), now)?.id)
    }
}
