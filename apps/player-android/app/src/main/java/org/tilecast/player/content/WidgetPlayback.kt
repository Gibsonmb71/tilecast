package org.tilecast.player.content

data class WidgetPlaybackStatus(
    val widgetId: String? = null,
    val provider: String? = null,
    val state: String = "idle",
    val error: String? = null,
)
