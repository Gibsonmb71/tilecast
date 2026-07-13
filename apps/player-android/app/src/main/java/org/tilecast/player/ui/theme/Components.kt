package org.tilecast.player.ui.theme

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

fun Modifier.signalTvFocus(): Modifier = composed {
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(SignalDimensions.ControlRadius)
    onFocusChanged { focused = it.isFocused }
        .graphicsLayer {
            scaleX = if (focused) 1.025f else 1f
            scaleY = if (focused) 1.025f else 1f
        }
        .border(if (focused) SignalDimensions.FocusWidth else 0.dp, SignalBlue, shape)
        .clip(shape)
}

@Composable
fun SignalButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.defaultMinSize(minHeight = SignalDimensions.TvControlHeight).signalTvFocus(),
        shape = RoundedCornerShape(SignalDimensions.ControlRadius),
        colors = ButtonDefaults.buttonColors(containerColor = SignalBlue, contentColor = SignalBackground),
        content = content,
    )
}

@Composable
fun SignalOutlinedButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.defaultMinSize(minHeight = SignalDimensions.TvControlHeight).signalTvFocus(),
        shape = RoundedCornerShape(SignalDimensions.ControlRadius),
        content = content,
    )
}
