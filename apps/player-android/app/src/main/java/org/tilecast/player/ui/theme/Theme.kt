package org.tilecast.player.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val SignalDarkColors = darkColorScheme(
    primary = SignalBlue,
    onPrimary = SignalBackground,
    primaryContainer = SignalBlueSoft,
    onPrimaryContainer = SignalText,
    secondary = BroadcastAmber,
    onSecondary = SignalBackground,
    background = SignalBackground,
    onBackground = SignalText,
    surface = SignalSurface,
    onSurface = SignalText,
    surfaceVariant = SignalSurfaceSubtle,
    onSurfaceVariant = SignalMuted,
    outline = SignalBorder,
    error = SignalDanger,
)

@Composable
fun TilecastSignalTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SignalDarkColors,
        typography = SignalTypography,
        content = content,
    )
}
