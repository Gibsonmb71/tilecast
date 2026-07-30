package org.tilecast.player.content

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import kotlinx.coroutines.delay
import org.tilecast.player.network.ManifestPlugin
import java.time.Instant

private val BarBackground = Color(0xF50D141B)
private val BarBorder = Color(0x3DFFFFFF)
private val BarFill = Color(0x29FFFFFF)
private val BarFillEdge = Color(0x6BFFFFFF)

/**
 * Hosts playback with the built-in bar channel layered on top. A bar never
 * touches playback: it appears, ticks, changes mode, and disappears while the
 * same media item stays mounted. In `push` mode the content is inset by the bar
 * height instead of being covered.
 *
 * The slot holds one bar. An Emergency Alerts ticker takes it whenever one is
 * active: a Countdown Bar counting down to lunch must never be what a screen is
 * showing instead of a tornado warning. The countdown is not lost — it returns as
 * soon as the alert clears.
 */
@Composable
internal fun WithPluginBars(
    plugins: List<ManifestPlugin>,
    clockOffsetSeconds: Long?,
    content: @Composable () -> Unit,
) {
    val hasBars =
        plugins.any {
            it.version == 1 && (it.type == "countdown_bar" || it.type == "alert_ticker")
        }
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(hasBars) {
        if (!hasBars) return@LaunchedEffect
        while (true) {
            now = Instant.now()
            delay(1_000)
        }
    }
    val ticker =
        remember(plugins, clockOffsetSeconds, now) {
            if (hasBars) resolveAlertTicker(plugins, now, clockOffsetSeconds) else null
        }
    val countdown =
        remember(plugins, clockOffsetSeconds, now) {
            if (hasBars && ticker == null) {
                resolveCountdownBar(plugins, now, clockOffsetSeconds)
            } else {
                null
            }
        }
    val height = ticker?.heightPx ?: countdown?.heightPx
    val pushed = (ticker?.displayMode ?: countdown?.displayMode) == "push"
    // content() is called from exactly one place in exactly one layout, whatever
    // the bar is doing. Moving it between call sites — or between a Column and a
    // Box when the mode changes — would tear down and restart the media item,
    // which is the one thing this channel must never do.
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxSize()
                .padding(bottom = if (pushed && height != null) height.dp else 0.dp),
        ) {
            content()
        }
        val barSlot =
            Modifier.fillMaxWidth()
                .height((height ?: 0).dp)
                .align(Alignment.BottomCenter)
        if (ticker != null) {
            AlertTickerBar(ticker, barSlot)
        } else {
            countdown?.let { bar -> CountdownBar(bar, barSlot) }
        }
    }
}

@Composable
private fun CountdownBar(active: ActiveCountdownBar, modifier: Modifier = Modifier) {
    Box(modifier.background(BarBackground)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(BarBorder))
        active.remainingFraction?.let { fraction ->
            // Animating over the tick interval turns the once-a-second step into a
            // steady sweep without claiming a finer clock than the player has.
            val width by animateFloatAsState(
                targetValue = fraction,
                animationSpec = tween(durationMillis = 960, easing = LinearEasing),
                label = "countdown-bar-fill",
            )
            if (width > 0f) {
                Row(Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxHeight().weight(width.coerceAtLeast(0.0001f)).background(BarFill)) {
                        Box(Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(2.dp).background(BarFillEdge))
                    }
                    if (width < 1f) Box(Modifier.weight(1f - width))
                }
            }
        }
        // The gutter is a share of the bar width, like the Linux percentage, so
        // one instance looks the same on a 1080p panel and a 4K one.
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val gutter = maxWidth * (active.contentPadding / 100f)
            Row(
                Modifier.fillMaxSize().padding(horizontal = gutter),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    active.message,
                    color = Color.White,
                    fontSize = active.fontSizeSp.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "  ${active.value}",
                    color = Color.White,
                    fontSize = active.fontSizeSp.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                )
            }
        }
    }
}
