package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.ManifestEmergency
import java.time.Instant

class EmergencyControllerTest {
    private val emergency = ManifestEmergency("e", "p", "2026-07-12T12:00:00Z", "2026-07-12T13:00:00Z")
    @Test fun activeEmergencyWinsOnlyWhenPrepared() {
        val ready=EmergencyController.evaluate(Instant.parse("2026-07-12T12:30:00Z"),emergency,true)
        assertTrue(ready.active);assertEquals("p",ready.playlistId);assertFalse(ready.continueNormalPlayback)
        assertFalse(EmergencyController.evaluate(Instant.parse("2026-07-12T12:30:00Z"),emergency,false).active)
    }
    @Test fun expirationIsHalfOpen(){assertFalse(EmergencyController.evaluate(Instant.parse("2026-07-12T13:00:00Z"),emergency,true).active)}
}
