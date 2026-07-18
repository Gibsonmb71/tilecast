package org.tilecast.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionEpochTest {
    @Test
    fun invalidationRejectsCallbacksFromThePreviousConnection() {
        val epoch = ConnectionEpoch()
        val captured = epoch.capture()

        assertTrue(epoch.isCurrent(captured))
        epoch.invalidate()
        assertFalse(epoch.isCurrent(captured))
        assertTrue(epoch.isCurrent(epoch.capture()))
    }
}
