package org.tilecast.player.reliability

import android.content.Context
import java.time.Duration
import java.time.Instant

enum class RecoveryLevel {
    RETRY,
    SKIP_ITEM,
    RECREATE_RENDERER,
    RECREATE_CONTROLLER,
    RESTART_ACTIVITY,
    RESTART_PROCESS,
    SAFE_MODE,
}

data class RecoveryDecision(
    val level: RecoveryLevel,
    val recoveryCount: Int,
    val safeMode: Boolean,
)

interface RecoveryStateStore {
    fun failures(): List<Instant>
    fun saveFailures(values: List<Instant>)
    fun safeMode(): Boolean
    fun setSafeMode(value: Boolean)
    fun healthySince(): Instant?
    fun setHealthySince(value: Instant?)
}

class MemoryRecoveryStateStore : RecoveryStateStore {
    private var savedFailures = emptyList<Instant>()
    private var savedSafeMode = false
    private var savedHealthySince: Instant? = null
    override fun failures() = savedFailures
    override fun saveFailures(values: List<Instant>) {
        savedFailures = values
    }
    override fun safeMode() = savedSafeMode
    override fun setSafeMode(value: Boolean) {
        savedSafeMode = value
    }
    override fun healthySince() = savedHealthySince
    override fun setHealthySince(value: Instant?) {
        savedHealthySince = value
    }
}

class PreferencesRecoveryStateStore(context: Context) : RecoveryStateStore {
    private val preferences = context.getSharedPreferences("tilecast-recovery", Context.MODE_PRIVATE)

    override fun failures() =
        preferences
            .getString("failure-history", "")
            .orEmpty()
            .split(',')
            .mapNotNull { it.toLongOrNull()?.let(Instant::ofEpochMilli) }

    override fun saveFailures(values: List<Instant>) {
        preferences.edit().putString("failure-history", values.joinToString(",") { it.toEpochMilli().toString() }).commit()
    }

    override fun safeMode() = preferences.getBoolean("safe-mode", false)
    override fun setSafeMode(value: Boolean) {
        preferences.edit().putBoolean("safe-mode", value).commit()
    }

    override fun healthySince() =
        preferences.getLong("healthy-since", 0).takeIf { it > 0 }?.let(Instant::ofEpochMilli)

    override fun setHealthySince(value: Instant?) {
        preferences.edit().apply {
            if (value == null) remove("healthy-since") else putLong("healthy-since", value.toEpochMilli())
        }.commit()
    }
}

class ReliabilitySupervisor(
    private val maximumProcessRestarts: Int = 3,
    private val window: Duration = Duration.ofMinutes(10),
    private val safeModeEnabled: Boolean = true,
    private val store: RecoveryStateStore = MemoryRecoveryStateStore(),
    private val healthyResetPeriod: Duration = Duration.ofMinutes(5),
) {
    var safeMode: Boolean = store.safeMode()
        private set

    fun recordFailure(now: Instant = Instant.now()): RecoveryDecision {
        val failures = store.failures().filterNot { it.isBefore(now.minus(window)) }.toMutableList()
        failures += now
        store.saveFailures(failures)
        store.setHealthySince(null)
        val count = failures.size
        val level =
            when (count) {
                1 -> RecoveryLevel.RETRY
                2 -> RecoveryLevel.SKIP_ITEM
                3 -> RecoveryLevel.RECREATE_RENDERER
                4 -> RecoveryLevel.RECREATE_CONTROLLER
                5 -> RecoveryLevel.RESTART_ACTIVITY
                else -> if (count <= 5 + maximumProcessRestarts) RecoveryLevel.RESTART_PROCESS else RecoveryLevel.SAFE_MODE
            }
        if (level == RecoveryLevel.SAFE_MODE && safeModeEnabled) {
            safeMode = true
            store.setSafeMode(true)
        }
        return RecoveryDecision(
            if (level == RecoveryLevel.SAFE_MODE && !safeModeEnabled) RecoveryLevel.RESTART_PROCESS else level,
            count,
            safeMode,
        )
    }

    fun recordHealthy(now: Instant = Instant.now()): Boolean {
        val since = store.healthySince()
        if (since == null) {
            store.setHealthySince(now)
            return false
        }
        if (Duration.between(since, now) < healthyResetPeriod) return false
        store.saveFailures(emptyList())
        store.setHealthySince(now)
        return true
    }

    fun recoveryCount(now: Instant = Instant.now()) =
        store.failures().count { !it.isBefore(now.minus(window)) }

    fun exitSafeMode() {
        safeMode = false
        store.setSafeMode(false)
        store.saveFailures(emptyList())
        store.setHealthySince(null)
    }
}
