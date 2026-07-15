package org.tilecast.player.content

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test
import org.tilecast.player.network.DateSelection
import org.tilecast.player.network.LayoutBinding
import org.tilecast.player.network.StructuredPreparedData
import org.tilecast.player.network.StructuredRecord
import org.tilecast.player.network.StructuredSourceConfig

class LayoutBindingResolverTest {
    @Test
    fun resolvesDateAwareFieldWithoutManifestChange() {
        val source = StructuredSourceConfig(
            dateSelection = DateSelection(enabled = true, timezone = "America/New_York", mode = "today"),
            data = StructuredPreparedData(records = listOf(
                StructuredRecord("monday", "", date = "2026-08-03", values = mapOf("option_1" to "Chicken tenders")),
                StructuredRecord("tuesday", "", date = "2026-08-04", values = mapOf("option_1" to "Walking tacos")),
            )),
        )
        val binding = LayoutBinding("lunch", "option_1", prefix = "Today's lunch: ")
        assertEquals("Today's lunch: Chicken tenders", resolveLayoutBinding(binding, source, Instant.parse("2026-08-03T16:00:00Z")))
        assertEquals("Today's lunch: Walking tacos", resolveLayoutBinding(binding, source, Instant.parse("2026-08-04T16:00:00Z")))
    }
}
