package org.tilecast.player.content

import org.tilecast.player.network.ManifestPlugin
import java.time.Instant
import java.time.OffsetDateTime

/**
 * Emergency Alerts ticker resolution. This mirrors the Linux renderer's
 * alert-ticker-resolver: the same expiry, speed, and precedence rules, so one
 * rule targeting both platforms reads the same on either.
 *
 * There is no schedule to evaluate — the server publishes a ticker only while an
 * alert is being answered. What is evaluated locally is the expiry, so a player
 * running on a cached manifest takes the bar down itself rather than leaving an
 * alert on screen that may already be over.
 */
internal data class ActiveAlertTicker(
    val id: String,
    val message: String,
    val severity: String,
    val displayMode: String,
    val heightPx: Int,
    val priority: Int,
    /** Travel rate of the scrolling message, in density-independent pixels per second. */
    val pixelsPerSecond: Float,
    val expiresAt: Instant,
)

// Named speeds rather than a rate in the manifest: the same alert has to read at
// the same pace on displays of different widths and densities.
private val TickerRates = mapOf("slow" to 60f, "medium" to 120f, "fast" to 200f)

internal fun resolveAlertTicker(
    plugins: List<ManifestPlugin>,
    now: Instant,
    clockOffsetSeconds: Long? = null,
    clockOffsetMillis: Long? = null,
): ActiveAlertTicker? {
    val at = now.plusMillis(clockOffsetMillis ?: (clockOffsetSeconds ?: 0) * 1_000L)
    val active = mutableListOf<ActiveAlertTicker>()
    for (plugin in plugins) {
        if (plugin.type != "alert_ticker" || plugin.version != 1) continue
        val config = plugin.config
        // An unreadable or passed expiry hides the bar. An emergency surface has
        // to fail toward showing nothing rather than toward showing something
        // stale as though it were current.
        val expires = parseTickerInstant(config.expiresAt) ?: continue
        if (!expires.isAfter(at)) continue
        val message = config.message.trim()
        if (message.isEmpty()) continue
        active +=
            ActiveAlertTicker(
                id = plugin.id,
                message = message,
                severity = config.severity.trim(),
                displayMode = config.displayMode,
                heightPx = config.heightPx.coerceIn(40, 320),
                priority = config.priority,
                pixelsPerSecond = TickerRates[config.speed] ?: 120f,
                expiresAt = expires,
            )
    }
    return active
        .sortedWith(
            compareByDescending<ActiveAlertTicker> { it.priority }
                .thenByDescending { it.expiresAt }
                .thenBy { it.id },
        )
        .firstOrNull()
}

private fun parseTickerInstant(value: String): Instant? {
    if (value.isBlank()) return null
    return runCatching { Instant.parse(value) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(value).toInstant() }.getOrNull()
}
