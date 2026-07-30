package org.tilecast.player.content

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

private val TickerBackground = Color(0xF87A1F1F)
private val TickerBorder = Color(0xA6FFD6D6)
private val SeverityText = Color(0xFF7A1F1F)

/**
 * The Emergency Alerts ticker. It shares the bar slot and the overlay/push
 * geometry with the Countdown Bar and differs in what it has to carry: alert text
 * far longer than a bar is wide. The severity stays fixed at the leading edge so
 * it can be read at any moment, and the message scrolls past it.
 */
@Composable
internal fun AlertTickerBar(active: ActiveAlertTicker, modifier: Modifier = Modifier) {
    Box(modifier.background(TickerBackground)) {
        Box(Modifier.fillMaxWidth().height(2.dp).background(TickerBorder))
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            if (active.severity.isNotEmpty()) {
                Text(
                    active.severity.uppercase(),
                    color = SeverityText,
                    fontSize = tickerFontSize(active.heightPx) * 0.62f,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                    modifier =
                        Modifier.padding(horizontal = 24.dp)
                            .background(Color.White)
                            .padding(horizontal = 12.dp, vertical = 4.dp),
                )
            }
            AlertTickerMessage(active, Modifier.weight(1f).fillMaxHeight())
        }
    }
}

@Composable
private fun AlertTickerMessage(active: ActiveAlertTicker, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier) {
        val density = LocalDensity.current
        val viewportPx = with(density) { maxWidth.toPx() }
        var messagePx by remember(active.message) { mutableIntStateOf(0) }
        // The message travels its own width plus the viewport's, entering at the
        // trailing edge and leaving past the leading one. Duration follows from
        // that distance rather than being fixed, so a long alert scrolls for
        // longer instead of scrolling faster and becoming unreadable.
        val distance = viewportPx + messagePx
        val durationMs =
            ((distance / (active.pixelsPerSecond * density.density)) * 1_000f)
                .roundToInt()
                .coerceIn(6_000, 600_000)
        val transition = rememberInfiniteTransition(label = "alert-ticker")
        val progress by
            transition.animateFloat(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec =
                    infiniteRepeatable(
                        animation = tween(durationMillis = durationMs, easing = LinearEasing),
                        repeatMode = RepeatMode.Restart,
                    ),
                label = "alert-ticker-scroll",
            )
        Text(
            active.message,
            color = Color.White,
            fontSize = tickerFontSize(active.heightPx),
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            softWrap = false,
            modifier =
                Modifier.align(Alignment.CenterStart)
                    .wrapContentWidth(unbounded = true)
                    .offset { IntOffset((viewportPx - distance * progress).roundToInt(), 0) }
                    .onSizeChanged { messagePx = it.width },
        )
    }
}

/** Mirrors the renderer's clamp so one alert reads the same at either height. */
internal fun tickerFontSize(heightPx: Int) = (heightPx * 0.4f).coerceIn(22f, 64f).sp
