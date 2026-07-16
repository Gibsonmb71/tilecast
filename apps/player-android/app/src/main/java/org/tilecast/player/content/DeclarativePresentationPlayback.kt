package org.tilecast.player.content

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.ContentScale
import android.graphics.BitmapFactory
import java.io.File
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.text.NumberFormat
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlinx.coroutines.delay
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.tilecast.player.network.DocumentDataset
import org.tilecast.player.network.DocumentRecord
import org.tilecast.player.network.DocumentValue
import org.tilecast.player.network.ManifestWidget
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.PresentationBinding
import org.tilecast.player.network.PresentationNode

data class PresentationContext(
    val datasets: Map<String, DocumentDataset>,
    val localFiles: Map<String, String>,
    val record: DocumentRecord? = null,
    val repeatIndex: Int = 0,
    val now: Instant = Instant.now(),
)

@Composable
fun DeclarativeWidgetItem(item:ManifestItem,widget: ManifestWidget, session: PlaybackSession,onDone:()->Unit,onFailure: (String) -> Unit,onStatus:(WidgetPlaybackStatus)->Unit,startOffsetMs:Long=0) {
    DisposableEffect(widget.assetId) {
        onStatus(WidgetPlaybackStatus(widget.assetId, widget.provider.ifBlank { "declarative" }, "ready"))
        onDispose { onStatus(WidgetPlaybackStatus()) }
    }
    LaunchedEffect(item.id,startOffsetMs){delay(((item.durationMs?:30_000)-startOffsetMs).coerceAtLeast(1));onDone()}
    val presentation = widget.presentation ?: return onFailure("Presentation is unavailable")
    val native = presentation.native ?: return onFailure("Native presentation is unavailable")
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(widget.assetId) {
        while (true) {
            now = Instant.now()
            delay(1_000)
        }
    }
    val datasets = buildMap {
        session.content.manifest.dataSources.forEach { source ->
            source.dataDocument?.datasets?.forEach { dataset ->
                put("${source.id}:${dataset.id}", dataset)
            }
        }
    }
    PresentationNodeView(native.root, PresentationContext(datasets, session.content.localFiles, now = now))
}

@Composable
private fun PresentationNodeView(node: PresentationNode, context: PresentationContext) {
    if (!conditionMatches(node, context)) return
    when (node.type) {
        "surface", "box", "stack" -> Box(
            Modifier.fillMaxSize()
                .background(node.color("backgroundColor", Color.Transparent))
                .padding(node.int("padding", 0).dp),
            contentAlignment = Alignment.Center,
        ) { node.children.forEach { PresentationNodeView(it, context) } }
        "row" -> Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(node.int("gap", 12).dp),
            verticalAlignment = Alignment.CenterVertically,
        ) { node.children.forEach { PresentationNodeView(it, context) } }
        "column", "grouped_sections" -> Column(
            Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(node.int("gap", 10).dp),
        ) { node.children.forEach { PresentationNodeView(it, context) } }
        "grid" -> {
            val repeated = node.children.firstOrNull { it.type == "repeat" }
            if (repeated == null) {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(node.int("columns", 1).coerceIn(1, 4)),
                    horizontalArrangement = Arrangement.spacedBy(node.int("gap", 10).dp),
                    verticalArrangement = Arrangement.spacedBy(node.int("gap", 10).dp),
                ) { items(node.children.size) { index -> PresentationNodeView(node.children[index], context) } }
                return
            }
            val records = repeated.repeat?.let { selectedRecords(context.datasets[it.dataset], context.now).take(it.limit) }.orEmpty()
            val template = repeated.children.firstOrNull()
            LazyVerticalGrid(
                columns = GridCells.Fixed(node.int("columns", 1).coerceIn(1, 4)),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (records.isEmpty()) item { Text(repeated.string("emptyState", "No information available"), color = Color.White) }
                items(records.size, key = { records[it].id }) { index -> template?.let { PresentationNodeView(it, context.copy(record = records[index], repeatIndex = index + 1)) } }
            }
        }
        "spacer" -> Spacer(Modifier.height(node.int("height", 8).dp))
        "divider" -> HorizontalDivider(color = node.color("color", Color.White.copy(alpha = .18f)))
        "repeat" -> {
            val repeat = node.repeat ?: return
            val records = selectedRecords(context.datasets[repeat.dataset], context.now).take(repeat.limit)
            if (records.isEmpty()) {
                Text(node.string("emptyState", "No information available"), color = Color.White)
            }
            records.forEachIndexed { index, record ->
                node.children.forEach { PresentationNodeView(it, context.copy(record = record, repeatIndex = index + 1)) }
            }
        }
        "text", "badge" -> {
            val role = node.string("role", "body")
            val size = when (role) { "metric" -> 58; "title" -> 26; "label" -> 19; else -> 18 }
            Text(
                resolve(node.binding, context),
                color = node.color("color", Color.White),
                fontSize = node.int("fontSize", size).sp,
                fontWeight = if (role in setOf("metric", "title")) FontWeight.Bold else FontWeight.Normal,
                textAlign = when (node.string("align", "left")) { "center" -> TextAlign.Center; "right" -> TextAlign.End; else -> TextAlign.Start },
                maxLines = node.int("maxLines", if (role == "body") 3 else 1),
                overflow = TextOverflow.Ellipsis,
                modifier = if (node.type == "badge") Modifier.background(node.color("badgeColor", Color.White.copy(alpha = .12f))).padding(6.dp) else Modifier,
            )
        }
        "marquee" -> MarqueeNode(node, resolve(node.binding, context))
        "qr_code" -> QRNode(resolve(node.binding, context))
        "icon" -> IconNode(node, resolve(node.binding, context))
        "asset_image" -> AssetImageNode(node, context)
        "progress" -> ProgressNode(node, context)
        "line_chart", "bar_chart", "donut_chart" -> ChartNode(node, context)
        "conditional" -> node.children.forEach { PresentationNodeView(it, context) }
    }
}

@Composable
private fun MarqueeNode(node: PresentationNode, value: String) {
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
        val duration = when (node.string("speed", "normal")) { "slow" -> 30_000; "fast" -> 10_000; else -> 18_000 }
        val transition = rememberInfiniteTransition(label = "declarative-marquee")
        val right = node.string("direction", "left") == "right"
        val offset by transition.animateFloat(
            initialValue = if (right) -value.length * 20f else maxWidth.value,
            targetValue = if (right) maxWidth.value else -value.length * 20f,
            animationSpec = infiniteRepeatable(tween(duration, easing = LinearEasing), RepeatMode.Restart),
            label = "declarative-marquee-offset",
        )
        Text(value, Modifier.graphicsLayer { translationX = offset }, color = node.color("color", Color.White), fontSize = 34.sp, maxLines = 1, softWrap = false)
    }
}

@Composable
private fun QRNode(value: String) {
    val bitmap = remember(value) {
        val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 512, 512, mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M))
        android.graphics.Bitmap.createBitmap(512, 512, android.graphics.Bitmap.Config.ARGB_8888).apply {
            for (y in 0 until 512) for (x in 0 until 512) setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }
    }
    Image(bitmap.asImageBitmap(), null, Modifier.fillMaxSize())
}

private fun resolve(binding: PresentationBinding?, context: PresentationContext): String {
    binding ?: return ""
    val raw = when (binding.source) {
        "literal" -> binding.value
        "repeat" -> context.record?.values?.get(binding.path)?.display().orEmpty()
        "repeat_index" -> context.repeatIndex.toString()
        "dataset" -> {
            val dataset = context.datasets[binding.dataset] ?: context.datasets.values.firstOrNull()
            if (binding.path.isNotBlank()) {
                val objectValue = dataset?.value?.objectValue?.get(binding.path)?.display()
                objectValue ?: selectedRecords(dataset, context.now).firstOrNull()?.values?.get(binding.path)?.display().orEmpty()
            } else {
            selectedRecords(dataset, context.now).mapNotNull { record ->
                binding.fields.mapNotNull { record.values[it]?.display()?.takeIf(String::isNotBlank) }
                    .joinToString(" ").takeIf(String::isNotBlank)
            }.joinToString(binding.separator)
            }
        }
        "environment" -> formatEnvironment(binding, context.now)
        else -> ""
    }
    return binding.prefix + formatValue(raw.ifBlank { binding.fallback }, binding.format, binding.precision) + binding.suffix
}

private fun formatEnvironment(binding: PresentationBinding, now: Instant): String {
    val parts = binding.format.split(':')
    return when (parts.firstOrNull()) {
        "time" -> {
            val twelve = parts.getOrNull(1) != "24"
            val seconds = parts.getOrNull(2) == "true"
            val zone = runCatching { ZoneId.of(parts.getOrNull(3) ?: "UTC") }.getOrDefault(ZoneId.of("UTC"))
            now.atZone(zone).format(DateTimeFormatter.ofPattern(if (twelve) if (seconds) "h:mm:ss a" else "h:mm a" else if (seconds) "HH:mm:ss" else "HH:mm"))
        }
        "date" -> {
            val style = when (parts.getOrNull(1)) { "short" -> FormatStyle.SHORT; "medium" -> FormatStyle.MEDIUM; "long" -> FormatStyle.LONG; else -> FormatStyle.FULL }
            val zone = runCatching { ZoneId.of(parts.getOrNull(2) ?: "UTC") }.getOrDefault(ZoneId.of("UTC"))
            now.atZone(zone).format(DateTimeFormatter.ofLocalizedDate(style))
        }
        "countdown" -> {
            val zone = runCatching { ZoneId.of(parts.getOrNull(2) ?: "UTC") }.getOrDefault(ZoneId.of("UTC"))
            val target = runCatching {
                val value = parts.getOrNull(1).orEmpty()
                if (value.endsWith("Z") || value.contains("+")) Instant.parse(value) else LocalDateTime.parse(value).atZone(zone).toInstant()
            }.getOrDefault(now)
            val duration = Duration.between(if (parts.getOrNull(3) == "count_up") target else now, if (parts.getOrNull(3) == "count_up") now else target)
            if (duration.isNegative) parts.getOrNull(4) ?: "Complete" else "${duration.toDays()}d ${duration.toHoursPart()}h ${duration.toMinutesPart()}m ${duration.toSecondsPart()}s"
        }
        else -> ""
    }
}

private fun formatValue(value: String, format: String, precision: Int?): String {
    val number = value.toDoubleOrNull() ?: return value
    val formatter = when (format) {
        "integer" -> NumberFormat.getIntegerInstance()
        "percent" -> NumberFormat.getPercentInstance()
        "currency" -> NumberFormat.getCurrencyInstance()
        "number" -> NumberFormat.getNumberInstance()
        else -> return value
    }
    precision?.let { formatter.minimumFractionDigits = it; formatter.maximumFractionDigits = it }
    return formatter.format(if (format == "percent") number / 100 else number)
}

private fun selectedRecords(dataset: DocumentDataset?, now: Instant): List<DocumentRecord> {
    dataset ?: return emptyList()
    val selection = dataset.dateSelection ?: return dataset.records
    val zone = runCatching { ZoneId.of(selection.timezone) }.getOrDefault(ZoneId.of("UTC"))
    val today = now.atZone(zone).toLocalDate()
    val target = if (selection.mode == "tomorrow") today.plusDays(1) else today
    val dated = dataset.records.mapNotNull { record ->
        val raw = record.values[selection.field]?.display().orEmpty()
        val date = runCatching { if (raw.contains('T')) Instant.parse(raw).atZone(zone).toLocalDate() else LocalDate.parse(raw.take(10)) }.getOrNull()
        date?.let { it to record }
    }
    val matches = dated.filter { (date, _) ->
        when (selection.mode) {
            "next_available" -> !date.isBefore(target)
            "current_week" -> {
                val start = today.minusDays((today.dayOfWeek.value - 1).toLong())
                !date.isBefore(start) && !date.isAfter(start.plusDays(6))
            }
            "custom_range" -> runCatching { !date.isBefore(LocalDate.parse(selection.customStartDate)) && !date.isAfter(LocalDate.parse(selection.customEndDate)) }.getOrDefault(false)
            else -> date == target
        }
    }
    if (selection.mode == "next_available" && matches.isNotEmpty()) {
        val first = matches.minOf { it.first }
        return matches.filter { it.first == first }.map { it.second }
    }
    return matches.map { it.second }
}

private fun conditionMatches(node: PresentationNode, context: PresentationContext): Boolean {
    val condition = node.condition ?: return true
    val value = resolve(condition.binding, context)
    val numeric = value.toDoubleOrNull()
    val expected = condition.value.toDoubleOrNull()
    val instant = parseComparableInstant(value)
    val expectedInstant = parseComparableInstant(condition.value)
    return when (condition.op) {
        "equals" -> value == condition.value
        "not_equals" -> value != condition.value
        "empty" -> value.isEmpty()
        "not_empty" -> value.isNotEmpty()
        "greater_than" -> numeric != null && expected != null && numeric > expected
        "greater_or_equal" -> numeric != null && expected != null && numeric >= expected
        "less_than" -> numeric != null && expected != null && numeric < expected
        "less_or_equal" -> numeric != null && expected != null && numeric <= expected
        "before" -> instant != null && expectedInstant != null && instant.isBefore(expectedInstant)
        "after" -> instant != null && expectedInstant != null && instant.isAfter(expectedInstant)
        else -> false
    }
}

@Composable
private fun AssetImageNode(node: PresentationNode, context: PresentationContext) {
    val path = context.localFiles[node.string("variantId", "")]
    val bitmap = remember(path) { path?.let(BitmapFactory::decodeFile) }
    if (bitmap != null) {
        Image(
            bitmap.asImageBitmap(),
            contentDescription = node.string("contentDescription", ""),
            modifier = Modifier.fillMaxSize(),
            contentScale = when (node.string("fit", "contain")) {
                "cover" -> ContentScale.Crop
                "stretch" -> ContentScale.FillBounds
                else -> ContentScale.Fit
            },
        )
    } else {
        Box(Modifier.fillMaxSize().background(node.color("fallbackColor", Color.DarkGray)))
    }
}

@Composable
private fun IconNode(node: PresentationNode, value: String) {
    val glyph = when (value.ifBlank { node.string("name", "info") }) {
        "check", "operational", "complete" -> "✓"
        "warning", "degraded" -> "!"
        "error", "down", "cancelled" -> "×"
        "clock", "scheduled" -> "◷"
        "location" -> "●"
        "up" -> "↑"
        "down_arrow" -> "↓"
        else -> "•"
    }
    Text(glyph, color = node.color("color", Color.White), fontSize = node.int("fontSize", 28).sp)
}

@Composable
private fun ProgressNode(node: PresentationNode, context: PresentationContext) {
    val value = resolve(node.binding, context).toFloatOrNull() ?: 0f
    val target = if (node.bool("targetIsField", false)) {
        val field = node.string("target", "")
        val binding = node.binding?.copy(path = field)
        resolve(binding, context).toFloatOrNull() ?: 0f
    } else node.float("target", 100f)
    val ratio = if (target > 0) (value / target).coerceIn(0f, 1f) else 0f
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        LinearProgressIndicator(progress = { ratio }, modifier = Modifier.fillMaxWidth())
        if (node.bool("showPercent", true)) {
            Text(if (ratio >= 1f && node.string("completionText", "").isNotBlank()) node.string("completionText", "") else "${(ratio * 100).toInt()}%", color = node.color("color", Color.White), fontSize = 24.sp)
        }
    }
}

private data class ChartSeriesValues(val label: String, val color: Color, val values: List<Float>)

@Composable
private fun ChartNode(node: PresentationNode, context: PresentationContext) {
    val binding = node.binding ?: return
    val dataset = context.datasets[binding.dataset] ?: return
    val labels = node.stringList("seriesLabels")
    val colors = node.stringList("seriesColors")
    val palette = listOf(Color(0xFF4DB6FF), Color(0xFFFFB547), Color(0xFF57D38C), Color(0xFFE879F9))
    val series = binding.fields.mapIndexed { index, field ->
        val values = if (dataset.kind == "time_series") dataset.points.mapNotNull { it.values[field]?.display()?.toFloatOrNull() }
        else selectedRecords(dataset, context.now).mapNotNull { it.values[field]?.display()?.toFloatOrNull() }
        ChartSeriesValues(labels.getOrNull(index).orEmpty().ifBlank { field }, parseOptionalColor(colors.getOrNull(index)) ?: palette[index % palette.size], values)
    }.filter { it.values.isNotEmpty() }
    if (series.isEmpty()) {
        Text(node.string("emptyState", "No chart data available"), color = Color.White)
        return
    }
    val explicitMin = node.optionalFloat("minimum")
    val explicitMax = node.optionalFloat("maximum")
    val minimum = explicitMin ?: minOf(0f, series.minOf { it.values.min() })
    val maximum = explicitMax ?: maxOf(1f, series.maxOf { it.values.max() })
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Canvas(Modifier.fillMaxWidth().weight(1f)) {
            val span = (maximum - minimum).takeIf { it > 0 } ?: 1f
            if (node.type == "donut_chart") {
                val totals = series.map { it.values.sum().coerceAtLeast(0f) }
                val total = totals.sum().takeIf { it > 0 } ?: 1f
                var start = -90f
                totals.forEachIndexed { index, value ->
                    val sweep = value / total * 360f
                    drawArc(series[index].color, start, sweep, false, style = Stroke(width = size.minDimension * .18f, cap = StrokeCap.Butt))
                    start += sweep
                }
            } else if (node.type == "bar_chart") {
                val count = series.maxOf { it.values.size }.coerceAtLeast(1)
                val groupWidth = size.width / count
                val barWidth = groupWidth / (series.size + 1)
                series.forEachIndexed { seriesIndex, item ->
                    item.values.forEachIndexed { index, value ->
                        val height = (value - minimum) / span * size.height
                        drawRect(item.color, topLeft = androidx.compose.ui.geometry.Offset(index * groupWidth + seriesIndex * barWidth, size.height - height), size = androidx.compose.ui.geometry.Size(barWidth * .8f, height))
                    }
                }
            } else {
                series.forEach { item ->
                    val path = Path()
                    item.values.forEachIndexed { index, value ->
                        val x = if (item.values.size == 1) size.width / 2 else index.toFloat() / (item.values.size - 1) * size.width
                        val y = size.height - (value - minimum) / span * size.height
                        if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
                    }
                    drawPath(path, item.color, style = Stroke(width = 4f, cap = StrokeCap.Round))
                }
            }
        }
        if (node.bool("showLegend", true)) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                series.forEach { item -> Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(10.dp).background(item.color)); Spacer(Modifier.width(5.dp)); Text(item.label, color = Color.White, fontSize = 14.sp) } }
            }
        }
    }
}

private fun parseComparableInstant(value: String): Instant? =
    runCatching { Instant.parse(value) }.getOrElse { runCatching { LocalDate.parse(value).atStartOfDay(ZoneId.of("UTC")).toInstant() }.getOrNull() }

private fun DocumentValue.display(): String = when (kind) {
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

private fun PresentationNode.string(key: String, fallback: String): String = props[key]?.jsonPrimitive?.contentOrNull ?: fallback
private fun PresentationNode.int(key: String, fallback: Int): Int = props[key]?.jsonPrimitive?.intOrNull ?: fallback
private fun PresentationNode.float(key: String, fallback: Float): Float = props[key]?.jsonPrimitive?.contentOrNull?.toFloatOrNull() ?: fallback
private fun PresentationNode.optionalFloat(key: String): Float? = props[key]?.jsonPrimitive?.contentOrNull?.toFloatOrNull()
private fun PresentationNode.bool(key: String, fallback: Boolean): Boolean = props[key]?.jsonPrimitive?.booleanOrNull ?: fallback
private fun PresentationNode.stringList(key: String): List<String> = (props[key] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()
private fun PresentationNode.color(key: String, fallback: Color): Color = runCatching { Color(android.graphics.Color.parseColor(string(key, ""))) }.getOrDefault(fallback)
private fun parseOptionalColor(value: String?): Color? = value?.takeIf(String::isNotBlank)?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() }
