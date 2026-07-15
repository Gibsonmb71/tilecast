package org.tilecast.player

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import kotlinx.serialization.json.buildJsonObject
import org.junit.Rule
import org.junit.Test
import org.tilecast.player.content.CalendarSourceItem
import org.tilecast.player.network.CalendarEvent
import org.tilecast.player.network.CalendarPreparedData
import org.tilecast.player.network.CalendarSourceConfig
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestSource
import java.time.Instant

class CalendarRenderingTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun rendersPreparedCalendarEventNatively() {
        val start = Instant.now().plusSeconds(3600)
        val item = ManifestItem("item", "source", assetType = "source", durationMs = 30_000, fitMode = "contain", transition = "none", audioEnabled = false, volume = 0f, deliveryPolicy = "stream")
        val source = ManifestSource("source", "School calendar", "calendar", 1, buildJsonObject {})
        val config = CalendarSourceConfig(data = CalendarPreparedData(events = listOf(CalendarEvent("event", "School", "Board meeting", start.toString(), start.plusSeconds(3600).toString(), false, "Library"))))
        compose.setContent { CalendarSourceItem(item, source, config, {}, {}) }
        compose.onNodeWithText("School calendar").assertIsDisplayed()
        compose.onNodeWithText("Board meeting").assertIsDisplayed()
        compose.onNodeWithText("Library").assertIsDisplayed()
    }
}
