package org.tilecast.player.content

import org.tilecast.player.network.ManifestAsset
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestPlaylist
import java.time.Duration
import java.time.Instant
import kotlin.math.abs

data class PlaybackCursor(val index: Int, val cycle: Int)
internal data class SynchronizedPlaybackStart(val cursor: PlaybackCursor, val offsetMs: Long)

internal fun nextPlaybackCursor(cursor: PlaybackCursor, itemCount: Int) =
    PlaybackCursor((cursor.index + 1) % itemCount, cursor.cycle + 1)

internal fun synchronizedPlaybackStart(
    playlist: ManifestPlaylist,
    assets: List<ManifestAsset>,
    anchor: Instant,
    now: Instant,
): SynchronizedPlaybackStart {
    if (playlist.items.isEmpty() || !now.isAfter(anchor)) {
        return SynchronizedPlaybackStart(PlaybackCursor(0, 0), 0)
    }
    val durations = playlist.items.map { item -> effectiveDurationMs(item, assets) }
    val cycleDuration = durations.sum().coerceAtLeast(1)
    var elapsed = Duration.between(anchor, now).toMillis().coerceAtLeast(0) % cycleDuration
    var index = 0
    while (index < durations.lastIndex && elapsed >= durations[index]) {
        elapsed -= durations[index]
        index++
    }
    return SynchronizedPlaybackStart(PlaybackCursor(index, 0), elapsed)
}

internal fun effectiveDurationMs(item: ManifestItem, assets: List<ManifestAsset>): Long {
    item.durationMs?.let { return it.coerceAtLeast(1) }
    if (item.assetType == "website" || item.assetType == "widget") return 30_000
    val asset = item.variantId?.let { variant -> assets.firstOrNull { it.variantId == variant } }
    if (asset?.mimeType?.startsWith("video/") == true) {
        val start = item.videoStartOffsetMs ?: 0
        val end = item.videoEndOffsetMs ?: asset.durationSeconds?.times(1000)?.toLong()
        if (end != null) return (end - start).coerceAtLeast(1)
    }
    return 10_000
}

/**
 * Maps Android elapsed realtime onto a deterministic playlist timeline. Local item-complete
 * callbacks never advance this clock; every render pass derives the expected item and offset
 * from the same monotonic time base instead.
 */
internal class SynchronizedPlaybackTimeline private constructor(
    private val durations: LongArray,
    private val initialCyclePositionMs: Long,
    private val initialIndex: Int,
    private val initialOccurrence: Long,
    private val startedAtElapsedRealtimeMs: Long,
) {
    private val cycleDurationMs = durations.sum().coerceAtLeast(1)

    fun positionAt(elapsedRealtimeMs: Long): SynchronizedPlaybackStart {
        val elapsedSinceStart = (elapsedRealtimeMs - startedAtElapsedRealtimeMs).coerceAtLeast(0)
        val absolutePosition = initialCyclePositionMs + elapsedSinceStart
        val completedCycles = absolutePosition / cycleDurationMs
        var withinCycle = absolutePosition % cycleDurationMs
        var index = 0
        while (index < durations.lastIndex && withinCycle >= durations[index]) {
            withinCycle -= durations[index]
            index++
        }
        val transitions = completedCycles * durations.size + index - initialIndex
        val occurrence = (initialOccurrence + transitions).coerceIn(0, Int.MAX_VALUE.toLong()).toInt()
        return SynchronizedPlaybackStart(PlaybackCursor(index, occurrence), withinCycle)
    }

    companion object {
        fun fromInitialPosition(
            playlist: ManifestPlaylist,
            assets: List<ManifestAsset>,
            initialCursor: PlaybackCursor,
            initialOffsetMs: Long,
            startedAtElapsedRealtimeMs: Long,
        ): SynchronizedPlaybackTimeline? {
            if (playlist.items.isEmpty()) return null
            val durations = playlist.items.map { effectiveDurationMs(it, assets) }.toLongArray()
            val index = initialCursor.index.coerceIn(0, durations.lastIndex)
            val itemStart = durations.take(index).sum()
            val offset = initialOffsetMs.coerceIn(0, durations[index] - 1)
            return SynchronizedPlaybackTimeline(
                durations = durations,
                initialCyclePositionMs = itemStart + offset,
                initialIndex = index,
                initialOccurrence = initialCursor.cycle.toLong(),
                startedAtElapsedRealtimeMs = startedAtElapsedRealtimeMs,
            )
        }

        fun fromAnchor(
            playlist: ManifestPlaylist,
            assets: List<ManifestAsset>,
            anchor: Instant,
            serverClockOffsetSeconds: Long?,
            serverClockOffsetMillis: Long? = null,
            startedAtElapsedRealtimeMs: Long,
            startedAtWallClock: Instant,
        ): SynchronizedPlaybackTimeline? {
            if (playlist.items.isEmpty()) return null
            val durations = playlist.items.map { effectiveDurationMs(it, assets) }.toLongArray()
            val cycleDuration = durations.sum().coerceAtLeast(1)
            val correctedStart = startedAtWallClock.plusMillis(
                serverClockOffsetMillis ?: (serverClockOffsetSeconds ?: 0) * 1_000L,
            )
            val elapsedFromAnchor = if (correctedStart.isAfter(anchor)) {
                Duration.between(anchor, correctedStart).toMillis().coerceAtLeast(0)
            } else {
                0
            }
            val completedCycles = elapsedFromAnchor / cycleDuration
            var withinCycle = elapsedFromAnchor % cycleDuration
            var index = 0
            while (index < durations.lastIndex && withinCycle >= durations[index]) {
                withinCycle -= durations[index]
                index++
            }
            val occurrence = completedCycles * durations.size + index
            val itemStart = durations.take(index).sum()
            return SynchronizedPlaybackTimeline(
                durations = durations,
                initialCyclePositionMs = itemStart + withinCycle,
                initialIndex = index,
                initialOccurrence = occurrence,
                startedAtElapsedRealtimeMs = startedAtElapsedRealtimeMs,
            )
        }
    }
}

internal enum class VideoCorrectionAction { NONE, SPEED, SEEK }

internal data class VideoDriftCorrection(
    val action: VideoCorrectionAction,
    val driftMs: Long,
    val playbackSpeed: Float = 1f,
    val seekPositionMs: Long? = null,
)

internal fun videoDriftCorrection(expectedPositionMs: Long, actualPositionMs: Long): VideoDriftCorrection {
    val drift = expectedPositionMs - actualPositionMs
    return when {
        abs(drift) <= 80 -> VideoDriftCorrection(VideoCorrectionAction.NONE, drift)
        abs(drift) <= 250 -> VideoDriftCorrection(
            action = VideoCorrectionAction.SPEED,
            driftMs = drift,
            playbackSpeed = if (drift > 0) 1.02f else 0.98f,
        )
        else -> VideoDriftCorrection(
            action = VideoCorrectionAction.SEEK,
            driftMs = drift,
            seekPositionMs = expectedPositionMs.coerceAtLeast(0),
        )
    }
}
