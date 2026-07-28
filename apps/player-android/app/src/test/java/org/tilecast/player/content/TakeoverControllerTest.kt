package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.ManifestTakeover
import org.tilecast.player.network.PlayerManifest
import java.time.Instant

class TakeoverControllerTest {
    private val takeover = ManifestTakeover("e", "p", "2026-07-12T12:00:00Z", "2026-07-12T13:00:00Z")
    @Test fun activeTakeoverWinsOnlyWhenPrepared() {
        val ready=TakeoverController.evaluate(Instant.parse("2026-07-12T12:30:00Z"),takeover,true)
        assertTrue(ready.active);assertEquals("p",ready.playlistId);assertFalse(ready.continueNormalPlayback)
        assertFalse(TakeoverController.evaluate(Instant.parse("2026-07-12T12:30:00Z"),takeover,false).active)
    }
    @Test fun expirationIsHalfOpen(){assertFalse(TakeoverController.evaluate(Instant.parse("2026-07-12T13:00:00Z"),takeover,true).active)}
    @Test fun legacyManifestKeyRemainsReadableDuringStaggeredUpgrade() {
        val manifest=PlayerManifest(4,1,"screen","2026-07-12T12:00:00Z","playlist",emergency=takeover)
        assertEquals(takeover,manifest.effectiveTakeover)
    }
}
