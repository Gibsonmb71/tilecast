package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Test
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestPlaylist
import java.time.Instant

class SynchronizedPlaybackTimelineTest {
    private fun item(id: String, durationMs: Long) = ManifestItem(
        id = id,
        assetId = id,
        assetType = "image",
        durationMs = durationMs,
        fitMode = "contain",
        transition = "none",
        audioEnabled = false,
        volume = 0f,
        deliveryPolicy = "download",
    )

    @Test
    fun monotonicTimelineAdvancesWithoutLocalCompletionCallbacks() {
        val playlist = ManifestPlaylist("playlist", 1, "Synced", listOf(item("first", 10_000), item("second", 20_000)))
        val timeline = SynchronizedPlaybackTimeline.fromInitialPosition(
            playlist = playlist,
            assets = emptyList(),
            initialCursor = PlaybackCursor(1, 0),
            initialOffsetMs = 5_000,
            startedAtElapsedRealtimeMs = 1_000,
        )!!

        assertEquals(SynchronizedPlaybackStart(PlaybackCursor(1, 0), 5_000), timeline.positionAt(1_000))
        assertEquals(SynchronizedPlaybackStart(PlaybackCursor(0, 1), 0), timeline.positionAt(16_000))
        assertEquals(SynchronizedPlaybackStart(PlaybackCursor(1, 2), 5_000), timeline.positionAt(31_000))
    }

    @Test
    fun independentlyStartedPlayersResolveTheSameSharedPosition() {
        val playlist = ManifestPlaylist("playlist", 1, "Synced", listOf(item("first", 10_000), item("second", 20_000)))
        val anchor = Instant.parse("2026-07-17T12:00:00Z")
        val first = SynchronizedPlaybackTimeline.fromAnchor(
            playlist,
            emptyList(),
            anchor,
            0,
            startedAtElapsedRealtimeMs = 1_000,
            startedAtWallClock = anchor.plusSeconds(25),
        )!!
        val second = SynchronizedPlaybackTimeline.fromAnchor(
            playlist,
            emptyList(),
            anchor,
            0,
            startedAtElapsedRealtimeMs = 3_000,
            startedAtWallClock = anchor.plusSeconds(27),
        )!!

        assertEquals(first.positionAt(6_000), second.positionAt(6_000))
        assertEquals(SynchronizedPlaybackStart(PlaybackCursor(0, 2), 0), first.positionAt(6_000))
    }

    @Test
    fun smallVideoDriftIsIgnored() {
        assertEquals(
            VideoDriftCorrection(VideoCorrectionAction.NONE, 60),
            videoDriftCorrection(expectedPositionMs = 5_000, actualPositionMs = 4_940),
        )
    }

    @Test
    fun moderateVideoDriftUsesTemporarySpeedCorrection() {
        assertEquals(
            VideoDriftCorrection(VideoCorrectionAction.SPEED, 200, playbackSpeed = 1.02f),
            videoDriftCorrection(expectedPositionMs = 5_000, actualPositionMs = 4_800),
        )
        assertEquals(
            VideoDriftCorrection(VideoCorrectionAction.SPEED, -200, playbackSpeed = 0.98f),
            videoDriftCorrection(expectedPositionMs = 5_000, actualPositionMs = 5_200),
        )
    }

    @Test
    fun largeVideoDriftSeeksToTheSharedPosition() {
        assertEquals(
            VideoDriftCorrection(VideoCorrectionAction.SEEK, 700, seekPositionMs = 5_000),
            videoDriftCorrection(expectedPositionMs = 5_000, actualPositionMs = 4_300),
        )
    }
}
