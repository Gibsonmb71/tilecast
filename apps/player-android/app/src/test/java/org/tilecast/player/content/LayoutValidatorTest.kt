package org.tilecast.player.content

import java.util.UUID
import org.junit.Assert.assertThrows
import org.junit.Test
import org.tilecast.player.network.LayoutCanvas
import org.tilecast.player.network.LayoutDocument
import org.tilecast.player.network.LayoutPlacement
import org.tilecast.player.network.LayoutPrimitive

class LayoutValidatorTest {
    private fun document() = LayoutDocument(
        1,
        LayoutCanvas(1920, 1080, "landscape", "#101820"),
        listOf(LayoutPlacement(UUID.randomUUID().toString(), "primitive", "Heading", 20f, 20f, 800f, 180f, 1, 1f, true, false, primitive = LayoutPrimitive("text", text = "Welcome", fontSize = 72f, minimumFontSize = 18f))),
    )

    @Test fun acceptsNativePrimitiveDocument() { LayoutValidator.validate(document()) }
    @Test fun rejectsBespokeElementType() { assertThrows(IllegalArgumentException::class.java) { LayoutValidator.validate(document().copy(placements = document().placements.map { it.copy(type = "clock") })) } }
    @Test fun rejectsPlacementOutsideCanvas() { assertThrows(IllegalArgumentException::class.java) { LayoutValidator.validate(document().copy(placements = document().placements.map { it.copy(x = 1800f) })) } }
}
