package org.tilecast.player.content

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.tilecast.player.network.DataDocument
import org.tilecast.player.network.WidgetPresentation

class DeclarativeContractTest {
    private val json = Json { ignoreUnknownKeys = false }

    @Test
    fun decodesTypedDataWithoutProviderMetadata() {
        val document = json.decodeFromString<DataDocument>(
            """{"schemaVersion":1,"datasets":[{"id":"records","kind":"records","fields":[{"key":"value","label":"Value","type":"number"}],"records":[{"id":"one","values":{"value":{"kind":"number","number":42.5}}}],"cache":{"usingCachedData":false,"unavailable":false}}]}"""
        )
        assertEquals(42.5, document.datasets.single().records.single().values.getValue("value").number!!, 0.0)
    }

    @Test
    fun capabilitiesCoverClosedNodeRuntime() {
        val presentation = json.decodeFromString<WidgetPresentation>(
            """{"schemaVersion":1,"kind":"native","requiredCapabilities":{"layout.surface":1,"content.text":1},"native":{"root":{"type":"surface","children":[{"type":"text","binding":{"source":"literal","value":"Hello"}}]}}}"""
        )
        assertTrue(presentation.requiredCapabilities.all { (name, version) -> (PresentationCapabilities.native[name] ?: 0) >= version })
    }
}
