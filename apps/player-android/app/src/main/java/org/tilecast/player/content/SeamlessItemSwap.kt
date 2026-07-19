package org.tilecast.player.content

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import kotlinx.coroutines.delay
import org.tilecast.player.network.ManifestPlaylist

/**
 * Double-buffers playlist items so advancing never shows an empty (black) frame.
 *
 * The incoming item mounts underneath while the outgoing item stays on top,
 * covering it — including a video's pre-first-frame shutter. Once the incoming
 * item reports its first frame (bitmap decoded, first video frame rendered)
 * the outgoing item is removed, or faded out when the incoming item requests a
 * "fade" transition. If the incoming item never reports (e.g. it is failing
 * and about to advance again) the outgoing item is dropped after a grace
 * period so a stale frame cannot stick around indefinitely.
 */
@Composable
internal fun SeamlessItemSwap(
    cursor: PlaybackCursor,
    animateFor: (PlaybackCursor) -> Boolean,
    onCurrentFirstFrame: () -> Unit = {},
    content: @Composable (cursor: PlaybackCursor, isActive: State<Boolean>, onFirstFrame: () -> Unit) -> Unit,
) {
    var current by remember { mutableStateOf(cursor) }
    var previous by remember { mutableStateOf<PlaybackCursor?>(null) }
    var currentReady by remember { mutableStateOf(false) }
    SideEffect {
        if (current != cursor) {
            // Only demote the outgoing item if it rendered at least one frame.
            // If it advances before that (e.g. a failing video), keep holding
            // the prior entry — the last frame that was actually visible.
            if (currentReady) previous = current
            current = cursor
            currentReady = false
        }
    }

    // Each playlist occurrence needs a fresh alpha. Reusing the completed zero
    // value from the prior fade exposes the incoming item for one frame before
    // the effect can reset it, which looks like a flash before the real fade.
    val outgoingAlpha = remember(current) { Animatable(1f) }
    LaunchedEffect(current, currentReady) {
        if (previous == null) return@LaunchedEffect
        if (!currentReady) {
            delay(FIRST_FRAME_GRACE_MS)
        } else if (animateFor(current)) {
            outgoingAlpha.animateTo(0f, tween(FADE_DURATION_MS))
        }
        previous = null
    }

    Box(Modifier.fillMaxSize()) {
        for (entry in listOfNotNull(current, previous)) {
            key(entry) {
                val isActive = rememberUpdatedState(entry == current)
                Box(Modifier.fillMaxSize().graphicsLayer { alpha = if (isActive.value) 1f else outgoingAlpha.value }) {
                    content(entry, isActive) {
                        if (entry == current && !currentReady) {
                            currentReady = true
                            onCurrentFirstFrame()
                        }
                    }
                }
            }
        }
    }
}

internal fun shouldAnimateTransition(transition: String) = transition == "fade" || transition == "crossfade"

internal fun requiresCompositableVideo(playlist: ManifestPlaylist, index: Int): Boolean {
    if (playlist.items.isEmpty()) return false
    val current = index.coerceIn(0, playlist.items.lastIndex)
    val next = (current + 1) % playlist.items.size
    return playlist.items[current].transition == "crossfade" || playlist.items[next].transition == "crossfade"
}

private const val FIRST_FRAME_GRACE_MS = 8_000L
private const val FADE_DURATION_MS = 300
