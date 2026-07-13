package org.tilecast.player.reliability

import org.junit.Assert.*
import org.junit.Test

class PowerAssistTest {
    @Test fun choosesSafestAvailableSleep(){assertEquals(SleepStrategy.DEVICE_POLICY,PowerAssistStrategy.select(PowerCapabilities(true,true)));assertEquals(SleepStrategy.ACCESSIBILITY_LOCK,PowerAssistStrategy.select(PowerCapabilities(false,true)));assertEquals(SleepStrategy.BLACK_SCREEN,PowerAssistStrategy.select(PowerCapabilities(false,false)))}
    @Test fun managedModeRequiresConfirmedActiveLockTask(){assertEquals("standard",ReliabilityModeResolver.resolve("managed_kiosk",ManagedKioskCapability.LOCK_TASK_ALLOWED).effective);assertEquals("managed_kiosk",ReliabilityModeResolver.resolve("managed_kiosk",ManagedKioskCapability.LOCK_TASK_ACTIVE).effective)}
}
