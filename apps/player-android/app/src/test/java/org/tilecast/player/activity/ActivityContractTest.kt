package org.tilecast.player.activity

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Activity Event Contract v2 conformance.
 *
 * The fixtures are shared with the Go server tests and the TypeScript player
 * tests, so one change to the vocabulary fails all three suites at once.
 * See docs/activity-event-contract.md.
 */
class ActivityContractTest {
    private val fixtures: JsonObject = run {
        // The test runs from apps/player-android/app.
        val file = File("../../../packages/api-schema/activity/contract-v2-fixtures.json")
        assertTrue("shared contract fixtures are missing at ${file.absolutePath}", file.isFile)
        Json.parseToJsonElement(file.readText()).jsonObject
    }

    private val canonicalEventTypes: Map<String, String>
        get() = fixtures["canonicalEventTypes"]!!.jsonObject
            .mapValues { it.value.jsonPrimitive.content }

    private val scenarios: JsonArray
        get() = fixtures["scenarios"]!!.jsonArray

    @Test fun fixturesDeclareContractVersionTwo() {
        assertEquals(2, fixtures["version"]!!.jsonPrimitive.content.toInt())
    }

    @Test fun childSessionTypeComesFromTheIdentifiersCarried() {
        // A layout zone and a playlist position are measured differently, and
        // only root presentation intervals are a screen's wall-clock time.
        assertEquals("layout_placement", childSessionType(playlistItemId = "item", layoutPlacementId = "zone"))
        assertEquals("playlist_item", childSessionType(playlistItemId = "item", layoutPlacementId = ""))
        assertEquals("content", childSessionType(playlistItemId = "", layoutPlacementId = ""))

        val declared = fixtures["sessionTypes"]!!.jsonArray.map { it.jsonPrimitive.content }
        for (type in listOf("presentation", "content", "layout_placement", "playlist_item")) {
            assertTrue("$type is not a contract session type", declared.contains(type))
        }
    }

    @Test fun defaultTerminalReasonsNeverGuess() {
        assertEquals("completed_duration", defaultTerminalReason("completed"))
        assertEquals("renderer_failure", defaultTerminalReason("failed"))
        // A skip or a partial ending has no cause the player can establish, and
        // a guessed reason would move the session in or out of the interruption
        // count on no evidence.
        assertEquals("unknown", defaultTerminalReason("skipped"))
        assertEquals("unknown", defaultTerminalReason("partial"))
    }

    @Test fun everyDefaultTerminalReasonIsInTheContract() {
        val reasons = fixtures["terminalReasons"]!!.jsonObject.keys
        for (result in listOf("completed", "failed", "skipped", "partial", "")) {
            assertTrue(
                "${defaultTerminalReason(result)} is not a contract terminal reason",
                reasons.contains(defaultTerminalReason(result)),
            )
        }
    }

    @Test fun unknownIsNeitherExpectedNorAnInterruption() {
        val unknown = fixtures["terminalReasons"]!!.jsonObject["unknown"]!!.jsonObject
        // Absence of evidence must not be counted as an interruption.
        assertTrue(unknown["expected"]!!.toString() == "null")
    }

    @Test fun thisPlayerUsesCanonicalNamesOutsideLegacyFixtures() {
        // Scenarios listing android under legacyAliasPlayers emit v1 names on
        // purpose, proving the server still maps them. Everywhere else a v1
        // alias would be a regression: this player has moved to contract v2.
        val current = scenarios.filter { scenario ->
            scenario.jsonObject["legacyAliasPlayers"]!!.jsonArray
                .none { it.jsonPrimitive.content == "android" }
        }
        assertTrue("no non-legacy android fixture to check", current.isNotEmpty())
        for (scenario in current) {
            for (emission in scenario.jsonObject["emissions"]!!.jsonObject["android"]!!.jsonArray) {
                val eventType = emission.jsonObject["eventType"]!!.jsonPrimitive.content
                assertEquals(
                    "${scenario.jsonObject["name"]}: $eventType is a v1 alias",
                    canonicalEventTypes[eventType] ?: eventType,
                    eventType,
                )
            }
        }
    }

    @Test fun everyPlayerColumnDerivesTheSameSessions() {
        // The point of the contract: the same playback, expressed in either
        // player's vocabulary, must describe the same sessions.
        for (scenario in scenarios) {
            val expected = scenario.jsonObject["expected"]!!.jsonObject["sessions"]!!.jsonArray
            val emissions = scenario.jsonObject["emissions"]!!.jsonObject
            assertTrue("android and linux columns are both required", emissions.keys.containsAll(setOf("android", "linux")))
            for ((player, events) in emissions) {
                val sessionIds = events.jsonArray
                    .mapNotNull { it.jsonObject["activitySessionId"]?.jsonPrimitive?.content }
                    .toSet()
                for (session in expected) {
                    val id = session.jsonObject["activitySessionId"]!!.jsonPrimitive.content
                    assertTrue(
                        "${scenario.jsonObject["name"]}: $player never reports session $id",
                        sessionIds.contains(id),
                    )
                }
            }
        }
    }

    @Test fun everyEndEventCarriesATerminalReason() {
        val reasons = fixtures["terminalReasons"]!!.jsonObject.keys
        for (scenario in scenarios) {
            for ((player, events) in scenario.jsonObject["emissions"]!!.jsonObject) {
                for (emission in events.jsonArray) {
                    val eventType = emission.jsonObject["eventType"]!!.jsonPrimitive.content
                    val canonical = canonicalEventTypes[eventType] ?: eventType
                    val endsASession = canonical.endsWith(".completed") ||
                        canonical.endsWith(".stopped") ||
                        canonical.endsWith(".failed") ||
                        canonical.endsWith(".skipped")
                    if (!endsASession || emission.jsonObject["activitySessionId"] == null) continue
                    val reason = emission.jsonObject["terminalReason"]?.jsonPrimitive?.content
                    assertNotNull("${scenario.jsonObject["name"]}: $player $eventType has no terminalReason", reason)
                    assertTrue("$reason is not a contract terminal reason", reasons.contains(reason))
                }
            }
        }
    }
}
