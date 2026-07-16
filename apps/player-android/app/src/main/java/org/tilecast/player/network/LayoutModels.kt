package org.tilecast.player.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class LayoutDocument(val schemaVersion: Int, val canvas: LayoutCanvas, val placements: List<LayoutPlacement> = emptyList())

@Serializable
data class LayoutCanvas(val width: Int, val height: Int, val orientation: String, val backgroundColor: String, val backgroundAssetId: String? = null, val safeAreaPercent: Float = 5f)

@Serializable
data class LayoutPlacement(
    val id: String,
    val type: String,
    val name: String,
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
    val layer: Int,
    val opacity: Float,
    val visible: Boolean,
    val locked: Boolean,
    val groupId: String? = null,
    val widgetId: String? = null,
    val assetId: String? = null,
    val playlistId: String? = null,
    val overrides: JsonObject? = null,
    val primitive: LayoutPrimitive? = null,
    val playback: LayoutPlayback? = null,
)

@Serializable
data class LayoutPrimitive(
    val kind: String,
    val text: String = "",
    val fontFamily: String = "Inter",
    val fontSize: Float = 48f,
    val fontWeight: Int = 400,
    val textAlign: String = "left",
    val verticalAlign: String = "center",
    val color: String = "#FFFFFF",
    val backgroundColor: String = "#00000000",
    val lineHeight: Float = 1.2f,
    val letterSpacing: Float = 0f,
    val padding: Float = 0f,
    val borderWidth: Float = 0f,
    val borderColor: String = "#00000000",
    val cornerRadius: Float = 0f,
    val maximumLines: Int = 4,
    val overflow: String = "ellipsis",
    val autoFit: Boolean = false,
    val minimumFontSize: Float = 8f,
    val fillColor: String = "#00000000",
    val strokeColor: String = "#FFFFFF",
    val strokeWidth: Float = 0f,
    val binding: LayoutBinding? = null,
)

@Serializable
data class LayoutBinding(val dataSourceId: String, val field: String, val prefix: String = "", val suffix: String = "", val fallbackText: String = "", val hideWhenEmpty: Boolean = false, val format: String = "text")

@Serializable
data class LayoutPlayback(val fit: String = "contain", val muted: Boolean = true, val loop: Boolean = true, val fallback: String = "hide", val cornerRadius: Float = 0f)
