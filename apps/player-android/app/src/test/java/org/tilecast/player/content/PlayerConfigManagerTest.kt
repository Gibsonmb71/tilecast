package org.tilecast.player.content

import org.junit.Test
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.tilecast.player.network.PlayerCachePolicy
import org.tilecast.player.network.PlayerConfig

class PlayerConfigManagerTest {
    @Test fun validatesSafeConfiguration(){PlayerConfigValidator.validate(PlayerConfig(1,2,"2026-07-12T18:00:00Z"))}
    @Test(expected=IllegalArgumentException::class) fun rejectsUnsafeReportingInterval(){PlayerConfigValidator.validate(PlayerConfig(1,2,"2026-07-12T18:00:00Z",cache=PlayerCachePolicy(concurrentDownloads=20)))}
    @Test fun rejectsStaleOrDuplicateRevisions(){
        assertFalse(shouldAcceptPlayerConfig(4, 3))
        assertFalse(shouldAcceptPlayerConfig(4, 4))
    }
    @Test fun acceptsFirstAndNewerRevisions(){
        assertTrue(shouldAcceptPlayerConfig(null, 1))
        assertTrue(shouldAcceptPlayerConfig(4, 5))
    }
    @Test fun onlySendsConditionalRequestAfterConfigVerification(){
        assertEquals("etag-1", playerConfigEtagForRequest(true, "etag-1"))
        assertEquals(null, playerConfigEtagForRequest(false, "etag-1"))
    }
}
