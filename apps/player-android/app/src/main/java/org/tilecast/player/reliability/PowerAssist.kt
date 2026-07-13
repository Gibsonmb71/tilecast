package org.tilecast.player.reliability

enum class SleepStrategy { DEVICE_POLICY, ACCESSIBILITY_LOCK, BLACK_SCREEN }
data class PowerCapabilities(val devicePolicySleep:Boolean,val accessibilityLock:Boolean)
object PowerAssistStrategy { fun select(capabilities:PowerCapabilities)=when{capabilities.devicePolicySleep->SleepStrategy.DEVICE_POLICY;capabilities.accessibilityLock->SleepStrategy.ACCESSIBILITY_LOCK;else->SleepStrategy.BLACK_SCREEN} }

enum class ManagedKioskCapability { UNSUPPORTED, AVAILABLE_NOT_PROVISIONED, PROVISIONED, LOCK_TASK_ALLOWED, LOCK_TASK_ACTIVE, ERROR }
data class ReliabilityModeResult(val configured:String,val effective:String,val capability:ManagedKioskCapability)
object ReliabilityModeResolver { fun resolve(configured:String,capability:ManagedKioskCapability):ReliabilityModeResult {val active=configured=="managed_kiosk"&&capability==ManagedKioskCapability.LOCK_TASK_ACTIVE;return ReliabilityModeResult(configured,if(active)"managed_kiosk" else "standard",capability)} }
