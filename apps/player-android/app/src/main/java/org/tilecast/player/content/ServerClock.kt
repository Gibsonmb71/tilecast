package org.tilecast.player.content

import android.content.SharedPreferences
import androidx.compose.runtime.staticCompositionLocalOf
import java.time.Duration
import java.time.Instant

/** Temporal widget surfaces read the corrected server clock through this provider. */
val LocalTilecastServerNow = staticCompositionLocalOf<() -> Instant> { { Instant.now() } }

/** One server-time authority for availability, schedules, takeovers, and policy. */
class ServerClock(
    private val preferences: SharedPreferences? = null,
    private val localNow: () -> Instant = { Instant.now() },
) {
    private var offsetMillis: Long = preferences?.getLong(KEY_OFFSET_MILLIS, 0L) ?: 0L

    fun now(): Instant = localNow().plusMillis(offsetMillis)

    fun sync(serverTime: String, receivedAt: Instant = localNow()): Long {
        val server = runCatching { Instant.parse(serverTime) }.getOrNull() ?: return offsetMillis
        offsetMillis = Duration.between(receivedAt, server).toMillis()
        preferences?.edit()?.putLong(KEY_OFFSET_MILLIS, offsetMillis)?.putLong(KEY_SYNCED_AT, receivedAt.toEpochMilli())?.apply()
        return offsetMillis
    }

    fun restore(offset: Long?) {
        if (offset == null) return
        offsetMillis = offset
        preferences?.edit()?.putLong(KEY_OFFSET_MILLIS, offsetMillis)?.apply()
    }

    fun offsetMillis(): Long = offsetMillis
    fun offsetSeconds(): Long = offsetMillis / 1_000L

    private companion object {
        const val KEY_OFFSET_MILLIS = "server-clock-offset-millis"
        const val KEY_SYNCED_AT = "server-clock-synced-at"
    }
}
