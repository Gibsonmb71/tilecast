package org.tilecast.player.content

import java.util.UUID
import org.tilecast.player.network.LayoutDocument

object LayoutValidator {
    private val color = Regex("^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")
    private val placementTypes = setOf("widget", "asset", "playlistZone", "primitive")
    private val primitiveTypes = setOf("text", "rectangle", "circle", "line", "group")
    private val fonts = setOf("Inter", "Roboto", "Source Sans 3", "Noto Sans")

    fun validate(document: LayoutDocument) {
        require(document.schemaVersion == 2)
        val canvas = document.canvas
        require(canvas.width in 320..7680 && canvas.height in 320..7680)
        require(canvas.orientation in setOf("landscape", "portrait", "custom"))
        require(color.matches(canvas.backgroundColor) && canvas.safeAreaPercent in 0f..20f)
        require(canvas.backgroundVariantId == null || canvas.backgroundAssetId != null)
        require(document.placements.size <= 200)
        val ids = mutableSetOf<String>()
        document.placements.forEach { placement ->
            require(runCatching { UUID.fromString(placement.id) }.isSuccess && ids.add(placement.id))
            require(placement.type in placementTypes && placement.name.isNotBlank() && placement.name.length <= 120)
            require(placement.x >= 0 && placement.y >= 0 && placement.width > 0 && placement.height > 0)
            require(placement.x + placement.width <= canvas.width + .01f && placement.y + placement.height <= canvas.height + .01f)
            require(placement.layer in 0..999 && placement.opacity in 0f..1f)
            require(listOfNotNull(placement.widgetId, placement.assetId, placement.playlistId, placement.primitive).size == 1)
            require((placement.type != "widget" || placement.widgetId != null) && (placement.type != "asset" || placement.assetId != null) && (placement.type != "playlistZone" || placement.playlistId != null))
            require(placement.variantId == null || (placement.type == "asset" && placement.assetId != null))
            placement.primitive?.let { primitive ->
                require(placement.type == "primitive" && primitive.kind in primitiveTypes)
                require(primitive.text.length <= 4000 && primitive.fontFamily in fonts)
                require(primitive.fontSize in 8f..600f && primitive.minimumFontSize in 8f..300f)
                require(primitive.maximumLines in 1..100 && primitive.lineHeight in .8f..3f && primitive.letterSpacing in 0f..40f)
                listOf(primitive.color, primitive.backgroundColor, primitive.borderColor, primitive.fillColor, primitive.strokeColor).forEach { require(color.matches(it)) }
            }
        }
        val groups = document.placements.filter { it.primitive?.kind == "group" }.map { it.id }.toSet()
        document.placements.forEach { placement -> placement.groupId?.let { require(it in groups && it != placement.id) } }
    }
}
