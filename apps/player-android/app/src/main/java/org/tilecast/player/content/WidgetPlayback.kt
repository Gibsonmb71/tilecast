package org.tilecast.player.content

data class SourcePlaybackStatus(
    val sourceId: String? = null,
    val provider: String? = null,
    val state: String = "idle",
    val error: String? = null,
)
