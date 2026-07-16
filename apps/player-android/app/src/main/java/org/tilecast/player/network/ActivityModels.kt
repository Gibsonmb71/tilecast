package org.tilecast.player.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject

@Serializable
data class PlayerActivityEvent(
    val id: String,
    val sequence: Long,
    val eventType: String,
    val category: String = "",
    val severity: String = "info",
    val occurredAt: String,
    val elapsedRealtimeMs: Long? = null,
    val playerTimezone: String,
    val manifestVersion: Long? = null,
    val presentationType: String = "",
    val presentationId: String = "",
    val presentationRevision: String = "",
    val contentType: String = "",
    val contentId: String = "",
    val playlistItemId: String = "",
    val layoutPlacementId: String = "",
    val activitySessionId: String = "",
    val result: String = "unknown",
    val durationMs: Long? = null,
    val expectedDurationMs: Long? = null,
    val failureCode: String = "",
    val failureMessage: String = "",
    val trigger: String = "",
    val scheduleId: String = "",
    val emergencyId: String = "",
    val sourceId: String = "",
    val selectedRecordId: String = "",
    val selectionDate: String = "",
    val sourceCachedAt: String? = null,
    val sourceRevision: String = "",
    val snapshotHash: String = "",
    val metadata: JsonObject = buildJsonObject {},
    val priority: Int = 5,
)

@Serializable data class PlayerActivityBatch(val events: List<PlayerActivityEvent>)
@Serializable data class PlayerActivityAck(val accepted: Int = 0, val duplicates: Int = 0, val highestSequence: Long = 0, val acknowledgedEventIds: List<String> = emptyList())
