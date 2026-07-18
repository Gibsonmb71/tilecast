package org.tilecast.player.reliability

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FireTvWakePolicyTest {
    @Test
    fun detectsAmazonAndFireTvDeviceIdentities() {
        assertTrue(
            isFireTvDevice(
                manufacturer = "Amazon",
                brand = "Amazon",
                model = "AFTSSS",
                device = "sheldonp",
            ),
        )
        assertTrue(
            isFireTvDevice(
                manufacturer = "Insignia",
                brand = "Best Buy",
                model = "Fire TV Edition",
                device = "mantis",
            ),
        )
        assertFalse(
            isFireTvDevice(
                manufacturer = "Google",
                brand = "google",
                model = "Chromecast",
                device = "sabrina",
            ),
        )
    }

    @Test
    fun keepsNonSleepingFallbacksAwakeOutsideActiveHours() {
        assertTrue(
            shouldKeepScreenAwake(
                active = false,
                keepScreenOnDuringActiveHours = true,
                sleepOutsideActiveHours = false,
                fireTv = false,
            ),
        )
        assertFalse(
            shouldKeepScreenAwake(
                active = false,
                keepScreenOnDuringActiveHours = true,
                sleepOutsideActiveHours = true,
                fireTv = false,
            ),
        )
    }

    @Test
    fun fireTvAlwaysStaysAwakeOutsideActiveHours() {
        assertTrue(
            shouldKeepScreenAwake(
                active = false,
                keepScreenOnDuringActiveHours = false,
                sleepOutsideActiveHours = true,
                fireTv = true,
            ),
        )
    }

    @Test
    fun activeHoursStillRespectKeepScreenOnPolicy() {
        assertTrue(
            shouldKeepScreenAwake(
                active = true,
                keepScreenOnDuringActiveHours = true,
                sleepOutsideActiveHours = true,
                fireTv = false,
            ),
        )
        assertFalse(
            shouldKeepScreenAwake(
                active = true,
                keepScreenOnDuringActiveHours = false,
                sleepOutsideActiveHours = false,
                fireTv = true,
            ),
        )
    }
}
