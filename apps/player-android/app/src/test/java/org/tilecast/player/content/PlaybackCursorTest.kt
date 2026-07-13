package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackCursorTest {
    @Test
    fun singleItemPlaylistStartsANewPlaybackCycle() {
        assertEquals(PlaybackCursor(0, 1), nextPlaybackCursor(PlaybackCursor(0, 0), 1))
    }

    @Test
    fun playlistWrapsToFirstItemWithANewCycle() {
        assertEquals(PlaybackCursor(0, 3), nextPlaybackCursor(PlaybackCursor(2, 2), 3))
    }
}
