package org.tilecast.player.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import org.tilecast.player.network.PlayerBranding
import org.tilecast.player.network.PlayerPowerPolicy

class OutsideActiveHoursScreenTest {
    @Test
    fun resolvesAllDisplayModesAndFallsBackSafely() {
        assertEquals(
            OutsideActiveHoursDisplay.BouncingLogo,
            outsideActiveHoursPresentation(
                PlayerPowerPolicy(outsideActiveHoursDisplay = "bouncing_logo"),
                PlayerBranding(),
            ).display,
        )
        assertEquals(
            OutsideActiveHoursDisplay.CustomText,
            outsideActiveHoursPresentation(
                PlayerPowerPolicy(outsideActiveHoursDisplay = "custom_text"),
                PlayerBranding(),
            ).display,
        )
        assertEquals(
            OutsideActiveHoursDisplay.Black,
            outsideActiveHoursPresentation(
                PlayerPowerPolicy(outsideActiveHoursDisplay = "unexpected"),
                PlayerBranding(),
            ).display,
        )
    }

    @Test
    fun customTextUsesPolicyThenExistingBrandingFooter() {
        assertEquals(
            "School is closed",
            outsideActiveHoursPresentation(
                PlayerPowerPolicy(
                    outsideActiveHoursDisplay = "custom_text",
                    outsideActiveHoursText = "  School is closed  ",
                ),
                PlayerBranding(footerText = "Powered by Weekly Wildcat"),
            ).text,
        )
        assertEquals(
            "Powered by Weekly Wildcat",
            outsideActiveHoursPresentation(
                PlayerPowerPolicy(
                    outsideActiveHoursDisplay = "custom_text",
                    outsideActiveHoursText = "",
                ),
                PlayerBranding(footerText = "Powered by Weekly Wildcat"),
            ).text,
        )
    }
}
