package org.tilecast.player.content

import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.tilecast.player.network.DataDocument
import org.tilecast.player.network.DateSelection
import org.tilecast.player.network.DocumentDataset
import org.tilecast.player.network.DocumentDateSelection
import org.tilecast.player.network.DocumentRecord
import org.tilecast.player.network.DocumentValue
import org.tilecast.player.network.LayoutBinding
import org.tilecast.player.network.ManifestDataSource
import org.tilecast.player.network.StructuredPreparedData
import org.tilecast.player.network.StructuredRecord
import org.tilecast.player.network.StructuredSourceConfig
import org.tilecast.player.network.TypedRecord
import org.tilecast.player.network.TypedRecordData

class LayoutDataDocumentSourceTest {
    private val now = Instant.parse("2026-08-03T16:00:00Z")

    @Test
    fun v13DataDocumentResolvesCustomFieldWithEmptyLegacyConfiguration() {
        val source = source(
            provider = "json",
            records = listOf(
                DocumentRecord(
                    id = "lunch",
                    values = mapOf("option_1" to DocumentValue(kind = "text", text = "Chicken tenders")),
                ),
            ),
        )

        val structured = source.toLayoutStructuredSource()

        assertNotNull(structured)
        assertEquals(
            "Chicken tenders",
            resolveLayoutBinding(LayoutBinding(source.id, "option_1"), structured!!, now),
        )
    }

    @Test
    fun manualProviderUsesRecordDataDocument() {
        val source = source(
            provider = "manual",
            records = listOf(
                DocumentRecord(
                    id = "notice",
                    values = mapOf("title" to DocumentValue(kind = "text", text = "Welcome back")),
                ),
            ),
        )

        val structured = source.toLayoutStructuredSource()!!

        assertEquals("Welcome back", resolveLayoutBinding(LayoutBinding(source.id, "title"), structured, now))
    }

    @Test
    fun v12TypedCsvConfigurationResolvesStandardAndCustomFields() {
        val typed = TypedRecordData(
            records = listOf(
                TypedRecord(
                    id = "lunch",
                    values = mapOf(
                        "title" to "Lunch menu",
                        "option_1" to "Chicken tenders",
                    ),
                ),
            ),
            cachedAt = "2026-08-03T15:00:00Z",
            staleAt = "2026-08-10T15:00:00Z",
        )
        val source = ManifestDataSource(
            id = "csv-source",
            name = "CSV source",
            provider = "csv",
            configuration = Json.encodeToJsonElement(TypedRecordData.serializer(), typed).jsonObject,
        )

        val structured = source.toLayoutStructuredSource()!!

        assertEquals("Lunch menu", resolveLayoutBinding(LayoutBinding(source.id, "title"), structured, now))
        assertEquals("Chicken tenders", resolveLayoutBinding(LayoutBinding(source.id, "option_1"), structured, now))
    }

    @Test
    fun v12TypedCsvConfigurationPreservesDateSelection() {
        val typed = TypedRecordData(
            records = listOf(
                TypedRecord(
                    id = "monday",
                    values = mapOf(
                        "title" to "Monday menu",
                        "date" to "2026-08-01",
                        "service_date" to "2026-08-03",
                    ),
                ),
                TypedRecord(
                    id = "tuesday",
                    values = mapOf(
                        "title" to "Tuesday menu",
                        "date" to "2026-08-02",
                        "service_date" to "2026-08-04",
                    ),
                ),
            ),
            dateSelection = DateSelection(enabled = true, timezone = "UTC", mode = "today"),
            dateField = "service_date",
        )
        val source = ManifestDataSource(
            id = "csv-source",
            name = "CSV source",
            provider = "csv",
            configuration = Json.encodeToJsonElement(TypedRecordData.serializer(), typed).jsonObject,
        )

        val structured = source.toLayoutStructuredSource()!!

        assertEquals("Monday menu", resolveLayoutBinding(LayoutBinding(source.id, "title"), structured, now))
        assertEquals("2026-08-01", resolveLayoutBinding(LayoutBinding(source.id, "date"), structured, now))
    }

    @Test
    fun preservesStandardFieldsAndConvertsTypedValues() {
        val source = source(
            provider = "manual",
            records = listOf(
                DocumentRecord(
                    id = "typed",
                    values = mapOf(
                        "title" to DocumentValue(kind = "text", text = "Lunch menu"),
                        "subtitle" to DocumentValue(kind = "text", text = "Main line"),
                        "date" to DocumentValue(kind = "date", date = "2026-08-03"),
                        "author" to DocumentValue(kind = "text", text = "Cafeteria"),
                        "description" to DocumentValue(kind = "text", text = "Served with fruit"),
                        "text_value" to DocumentValue(kind = "text", text = "Hello"),
                        "number_value" to DocumentValue(kind = "number", number = 12.5),
                        "integer_value" to DocumentValue(kind = "integer", integer = 7),
                        "boolean_value" to DocumentValue(kind = "boolean", boolean = true),
                        "date_value" to DocumentValue(kind = "date", date = "2026-08-04"),
                        "datetime_value" to DocumentValue(kind = "datetime", datetime = "2026-08-04T12:30:00Z"),
                    ),
                ),
            ),
        )

        val structured = source.toLayoutStructuredSource()!!
        val record = structured.data.records.single()

        assertEquals("Lunch menu", record.title)
        assertEquals("Main line", record.subtitle)
        assertEquals("2026-08-03", record.date)
        assertEquals("Cafeteria", record.author)
        assertEquals("Served with fruit", record.description)
        assertEquals("Lunch menu", record.values["title"])
        assertEquals("Hello", record.values["text_value"])
        assertEquals("12.5", record.values["number_value"])
        assertEquals("7", record.values["integer_value"])
        assertEquals("true", record.values["boolean_value"])
        assertEquals("2026-08-04", record.values["date_value"])
        assertEquals("2026-08-04T12:30:00Z", record.values["datetime_value"])
    }

    @Test
    fun usesDatasetDateSelectionFieldWhileKeepingStandardDateBinding() {
        val source = source(
            provider = "manual",
            records = listOf(
                DocumentRecord(
                    id = "monday",
                    values = mapOf(
                        "title" to DocumentValue(kind = "text", text = "Monday menu"),
                        "date" to DocumentValue(kind = "date", date = "2026-08-01"),
                        "service_date" to DocumentValue(kind = "date", date = "2026-08-03"),
                    ),
                ),
                DocumentRecord(
                    id = "tuesday",
                    values = mapOf(
                        "title" to DocumentValue(kind = "text", text = "Tuesday menu"),
                        "date" to DocumentValue(kind = "date", date = "2026-08-02"),
                        "service_date" to DocumentValue(kind = "date", date = "2026-08-04"),
                    ),
                ),
            ),
            dateSelection = DocumentDateSelection(
                field = "service_date",
                timezone = "UTC",
                mode = "today",
            ),
        )

        val structured = source.toLayoutStructuredSource()!!

        assertEquals("Monday menu", resolveLayoutBinding(LayoutBinding(source.id, "title"), structured, now))
        assertEquals("2026-08-01", resolveLayoutBinding(LayoutBinding(source.id, "date"), structured, now))
    }

    @Test
    fun fallsBackToLegacyStructuredConfiguration() {
        val legacy = StructuredSourceConfig(
            data = StructuredPreparedData(
                records = listOf(
                    StructuredRecord(
                        id = "legacy",
                        title = "Legacy title",
                        values = mapOf("option_1" to "Legacy option"),
                    ),
                ),
            ),
        )
        val source = ManifestDataSource(
            id = "legacy-source",
            name = "Legacy source",
            provider = "csv",
            configuration = Json.encodeToJsonElement(StructuredSourceConfig.serializer(), legacy).jsonObject,
        )

        val structured = source.toLayoutStructuredSource()!!

        assertEquals("Legacy title", resolveLayoutBinding(LayoutBinding(source.id, "title"), structured, now))
        assertEquals("Legacy option", resolveLayoutBinding(LayoutBinding(source.id, "option_1"), structured, now))
    }

    @Test
    fun usesBindingFallbackForBlankOrMissingFields() {
        val blank = source(
            provider = "manual",
            records = listOf(
                DocumentRecord(
                    id = "blank",
                    values = mapOf("option_1" to DocumentValue(kind = "text", text = "   ")),
                ),
            ),
        ).toLayoutStructuredSource()!!
        val missing = source(
            provider = "manual",
            records = listOf(DocumentRecord(id = "missing")),
        ).toLayoutStructuredSource()!!
        val binding = LayoutBinding("source", "option_1", fallbackText = "Not available")

        assertEquals("Not available", resolveLayoutBinding(binding, blank, now))
        assertEquals("Not available", resolveLayoutBinding(binding, missing, now))
    }

    private fun source(
        provider: String,
        records: List<DocumentRecord>,
        dateSelection: DocumentDateSelection? = null,
    ) = ManifestDataSource(
        id = "source",
        name = "Source",
        provider = provider,
        configuration = buildJsonObject {},
        dataDocument = DataDocument(
            schemaVersion = 1,
            datasets = listOf(
                DocumentDataset(
                    id = "records",
                    kind = "records",
                    records = records,
                    dateSelection = dateSelection,
                ),
            ),
        ),
    )
}
