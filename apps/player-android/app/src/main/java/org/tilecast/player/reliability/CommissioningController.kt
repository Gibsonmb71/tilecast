package org.tilecast.player.reliability

import android.content.Context
import android.os.Build
import java.time.Instant

enum class CommissioningStep(val wireValue: String) {
    ADMIN_PIN("admin_pin"),
    ACCESSIBILITY("accessibility"),
    INSTALL_PERMISSION("install_permission"),
    BOOT_RECOVERY("boot_recovery"),
    PRESENTATION("presentation"),
    CACHED_FALLBACK("cached_fallback"),
    SELF_TEST("self_test"),
    RESULT("result"),
}

data class CommissioningStatus(
    val required: Boolean = false,
    val step: CommissioningStep = CommissioningStep.ADMIN_PIN,
    val adminPinSet: Boolean = false,
    val accessibilityEnabled: Boolean = false,
    val installPermissionGranted: Boolean = false,
    val bootLaunchVerified: Boolean = false,
    val immersiveVerified: Boolean = false,
    val keepAwakeVerified: Boolean = false,
    val cachedFallbackAvailable: Boolean = false,
    val selfTestResult: String? = null,
    val selfTestCompletedAt: Instant? = null,
    val completedAt: Instant? = null,
) {
    val readiness: String
        get() {
            if (!required && completedAt == null) return "needs_setup"
            val supported = listOf(adminPinSet, accessibilityEnabled, installPermissionGranted, bootLaunchVerified, immersiveVerified, keepAwakeVerified, cachedFallbackAvailable)
            return when {
                supported.all { it } && selfTestResult == "passed" -> "ready"
                completedAt != null -> "partially_ready"
                else -> "needs_setup"
            }
        }
}

class CommissioningController(
    private val context: Context,
    private val reliability: ReliabilityController,
) {
    private val preferences = context.getSharedPreferences("tilecast-commissioning", Context.MODE_PRIVATE)

    fun status(screenId: String?, cachedFallbackAvailable: Boolean): CommissioningStatus {
        if (screenId == null) return CommissioningStatus()
        val completedAt =
            preferences
                .getLong("completed-at-$screenId", 0)
                .takeIf { it > 0 }
                ?.let(Instant::ofEpochMilli)
        val step = CommissioningStep.entries.getOrElse(preferences.getInt("step-$screenId", 0)) { CommissioningStep.ADMIN_PIN }
        val boot = BootRecovery.status(context)
        return CommissioningStatus(
            required = completedAt == null || preferences.getBoolean("run-again-$screenId", false),
            step = step,
            adminPinSet = reliability.hasAdminPin(),
            accessibilityEnabled = reliability.accessibilityEnabled(),
            installPermissionGranted = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls(),
            bootLaunchVerified = boot.launchVerified,
            immersiveVerified = context.getSharedPreferences("tilecast-reliability", Context.MODE_PRIVATE).getBoolean("immersive", false),
            keepAwakeVerified = context.getSharedPreferences("tilecast-reliability", Context.MODE_PRIVATE).getBoolean("keep-screen-on", false),
            cachedFallbackAvailable = cachedFallbackAvailable,
            selfTestResult = preferences.getString("self-test-result-$screenId", null),
            selfTestCompletedAt = preferences.getLong("self-test-at-$screenId", 0).takeIf { it > 0 }?.let(Instant::ofEpochMilli),
            completedAt = completedAt,
        )
    }

    fun setPin(pin: CharArray) = reliability.setAdminPin(pin)

    fun advance(screenId: String, current: CommissioningStep) {
        val next = (current.ordinal + 1).coerceAtMost(CommissioningStep.RESULT.ordinal)
        preferences.edit().putInt("step-$screenId", next).commit()
    }

    fun runSelfTest(screenId: String, cachedFallbackAvailable: Boolean): String {
        val boot = BootRecovery.status(context)
        val passed = reliability.hasAdminPin() && reliability.accessibilityEnabled() && (Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()) && boot.launchVerified && cachedFallbackAvailable
        val result = if (passed) "passed" else "completed_with_warnings"
        preferences.edit().putString("self-test-result-$screenId", result).putLong("self-test-at-$screenId", System.currentTimeMillis()).commit()
        return result
    }

    fun complete(screenId: String) {
        preferences.edit().putLong("completed-at-$screenId", System.currentTimeMillis()).putBoolean("run-again-$screenId", false).putInt("step-$screenId", CommissioningStep.RESULT.ordinal).commit()
    }

    fun runAgain(screenId: String) {
        preferences.edit().putBoolean("run-again-$screenId", true).putInt("step-$screenId", 0).remove("self-test-result-$screenId").remove("self-test-at-$screenId").commit()
    }
}
