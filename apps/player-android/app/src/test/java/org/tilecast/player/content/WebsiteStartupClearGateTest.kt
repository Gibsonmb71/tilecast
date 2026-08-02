package org.tilecast.player.content

import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebsiteStartupClearGateTest {
    @After fun reset() = WebsiteStartupClearGate.resetForTests()

    @Test fun changedConfigDoesNotClearWebsiteDataAgain() {
        assertFalse(WebsiteStartupClearGate.shouldClear(false))
        assertFalse(WebsiteStartupClearGate.shouldClear(true))
    }

    @Test fun clearOnRestartRunsOnceAfterProcessStart() {
        assertTrue(WebsiteStartupClearGate.shouldClear(true))
        assertFalse(WebsiteStartupClearGate.shouldClear(true))
    }
}
