package org.tilecast.player.content

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import org.tilecast.player.network.DataDocument
import org.tilecast.player.network.DateSelection
import org.tilecast.player.network.DocumentDataset
import org.tilecast.player.network.DocumentRecord
import org.tilecast.player.network.DocumentValue
import org.tilecast.player.network.ManifestDataSource
import org.tilecast.player.network.StructuredPreparedData
import org.tilecast.player.network.StructuredRecord
import org.tilecast.player.network.StructuredSourceConfig

internal fun ManifestDataSource.toLayoutStructuredSource(): StructuredSourceConfig? {
    val dataset = dataDocument?.primaryRecordDataset()
    if (dataset != null) return dataset.toLayoutStructuredSource()
    if (configuration.isEmpty()) return null
    return runCatching {
        Json.decodeFromJsonElement<StructuredSourceConfig>(configuration)
    }.getOrNull()
}

private fun DataDocument.primaryRecordDataset(): DocumentDataset? =
    datasets.firstOrNull { it.kind == "records" && it.id == "records" }
        ?: datasets.firstOrNull { it.kind == "records" }
        ?: datasets.firstOrNull { it.records.isNotEmpty() }

private fun DocumentDataset.toLayoutStructuredSource(): StructuredSourceConfig {
    val selectionField = dateSelection?.field.orEmpty()
    return StructuredSourceConfig(
        dateSelection = dateSelection?.let { selection ->
            DateSelection(
                enabled = true,
                timezone = selection.timezone.ifBlank { "UTC" },
                mode = selection.mode.ifBlank { "today" },
                customStartDate = selection.customStartDate,
                customEndDate = selection.customEndDate,
                excludePast = selection.excludePast,
                noMatchBehavior = selection.noMatchBehavior.ifBlank { "empty" },
                fallbackText = selection.fallbackText,
            )
        } ?: DateSelection(),
        data = StructuredPreparedData(
            records = records.map { it.toStructuredRecord(selectionField) },
            cachedAt = cache.cachedAt,
            staleAt = cache.staleAt,
            usingCachedData = cache.usingCachedData,
            unavailable = cache.unavailable,
        ),
    )
}

private fun DocumentRecord.toStructuredRecord(selectionField: String): StructuredRecord {
    val converted = values.mapValues { (_, value) -> value.toDisplayString() }
    val standardDate = converted["date"].orEmpty()
    val selectionDate = selectionField.takeIf(String::isNotBlank)?.let(converted::get).orEmpty()
    return StructuredRecord(
        id = id,
        title = converted["title"].orEmpty(),
        subtitle = converted["subtitle"].orEmpty(),
        date = selectionDate.ifBlank { standardDate },
        author = converted["author"].orEmpty(),
        description = converted["description"].orEmpty(),
        imageUrl = converted["imageUrl"].orEmpty().ifBlank { converted["image"].orEmpty() },
        link = converted["link"].orEmpty(),
        values = converted,
    )
}

internal fun DocumentValue.toDisplayString(): String = when (kind) {
    "number", "percent", "currency" -> number?.toString()
    "integer" -> integer?.toString()
    "boolean" -> boolean?.toString()
    "date" -> date
    "datetime" -> datetime
    "duration" -> durationSeconds?.toString()
    "url" -> url
    "asset" -> assetId
    else -> text
}.orEmpty()
