package org.tilecast.player.content

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import org.tilecast.player.network.ClockAppConfig
import org.tilecast.player.network.DateAppConfig
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestSource
import org.tilecast.player.network.QRCodeAppConfig
import org.tilecast.player.network.StructuredSourceConfig
import org.tilecast.player.network.TickerAppConfig

@Composable
fun NativeAppItem(item: ManifestItem, app: ManifestSource, session: PlaybackSession, onDone: () -> Unit, onFailure: (String) -> Unit, onStatus: (SourcePlaybackStatus) -> Unit, startOffsetMs: Long = 0) {
    DisposableEffect(app.assetId) { onStatus(SourcePlaybackStatus(app.assetId, app.provider, "ready")); onDispose { onStatus(SourcePlaybackStatus()) } }
    LaunchedEffect(item.id, startOffsetMs) { delay(((item.durationMs ?: 30_000) - startOffsetMs).coerceAtLeast(1)); onDone() }
    when (app.provider) {
        "clock" -> runCatching { Json.decodeFromJsonElement<ClockAppConfig>(app.configuration) }.onSuccess { ClockApp(it) }.onFailure { onFailure("Clock App configuration is invalid") }
        "date" -> runCatching { Json.decodeFromJsonElement<DateAppConfig>(app.configuration) }.onSuccess { DateApp(it) }.onFailure { onFailure("Date App configuration is invalid") }
        "qrcode" -> runCatching { Json.decodeFromJsonElement<QRCodeAppConfig>(app.configuration) }.onSuccess { QRCodeApp(it) }.onFailure { onFailure("QR Code App configuration is invalid") }
        "ticker" -> runCatching { Json.decodeFromJsonElement<TickerAppConfig>(app.configuration) }.onSuccess { config ->
            val data = session.content.manifest.sources.firstOrNull { it.assetId == config.sourceAssetId } ?: return@onSuccess onFailure("Ticker data is unavailable")
            val structured = runCatching { Json.decodeFromJsonElement<StructuredSourceConfig>(data.configuration) }.getOrElse { return@onSuccess onFailure("Ticker data is invalid") }
            TickerApp(config, structured)
        }.onFailure { onFailure("Ticker App configuration is invalid") }
    }
}

@Composable private fun ClockApp(config: ClockAppConfig) { var now by remember { mutableStateOf(Instant.now()) }; LaunchedEffect(config.timezone, config.showSeconds) { while (true) { now = Instant.now(); delay(if (config.showSeconds) 1_000 else 15_000) } }; val pattern = if (config.format == "24") { if (config.showSeconds) "HH:mm:ss" else "HH:mm" } else { if (config.showSeconds) "h:mm:ss a" else "h:mm a" }; CenteredApp(config.backgroundColor) { Text(now.atZone(ZoneId.of(config.timezone)).format(DateTimeFormatter.ofPattern(pattern)), color = parseColor(config.foregroundColor), fontSize = 86.sp, fontWeight = FontWeight.SemiBold) } }
@Composable private fun DateApp(config: DateAppConfig) { var now by remember { mutableStateOf(Instant.now()) }; LaunchedEffect(config.timezone) { while (true) { now = Instant.now(); delay(30_000) } }; val style = when (config.format) { "short" -> FormatStyle.SHORT; "medium" -> FormatStyle.MEDIUM; "long" -> FormatStyle.LONG; else -> FormatStyle.FULL }; CenteredApp(config.backgroundColor) { Text(now.atZone(ZoneId.of(config.timezone)).format(DateTimeFormatter.ofLocalizedDate(style)), color = parseColor(config.foregroundColor), fontSize = 58.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center) } }
@Composable private fun QRCodeApp(config: QRCodeAppConfig) { val bitmap = remember(config) { qrBitmap(config) }; CenteredApp(config.backgroundColor) { Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) { Image(bitmap.asImageBitmap(), null); if (config.label.isNotBlank()) Text(config.label, color = parseColor(config.foregroundColor), fontSize = 24.sp, textAlign = TextAlign.Center) } } }
@Composable private fun TickerApp(config: TickerAppConfig, data: StructuredSourceConfig) { var now by remember { mutableStateOf(Instant.now()) }; LaunchedEffect(data.dateSelection.timezone) { while (true) { now = Instant.now(); delay(30_000) } }; val records = selectDateAwareRecords(data, now); val text = records.mapNotNull { record -> when (config.field) { "title" -> record.title; "subtitle" -> record.subtitle; "date" -> record.date; "author" -> record.author; "description" -> record.description; else -> record.values[config.field] }.takeIf { !it.isNullOrBlank() } }.joinToString(config.separator); CenteredApp(config.backgroundColor) { Text(text.ifBlank { data.emptyState }, color = parseColor(config.foregroundColor), fontSize = 34.sp, maxLines = 2, textAlign = TextAlign.Center) } }
@Composable private fun CenteredApp(background: String, content: @Composable () -> Unit) = Box(Modifier.fillMaxSize().background(parseColor(background)).padding(40.dp), contentAlignment = Alignment.Center) { content() }
private fun parseColor(value: String) = runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(Color.Black)
private fun qrBitmap(config: QRCodeAppConfig): Bitmap { val level = when (config.errorCorrection) { "low" -> ErrorCorrectionLevel.L; "quartile" -> ErrorCorrectionLevel.Q; "high" -> ErrorCorrectionLevel.H; else -> ErrorCorrectionLevel.M }; val matrix = QRCodeWriter().encode(config.value, BarcodeFormat.QR_CODE, 480, 480, mapOf(EncodeHintType.ERROR_CORRECTION to level, EncodeHintType.MARGIN to 2)); val foreground = android.graphics.Color.parseColor(config.foregroundColor); val background = android.graphics.Color.parseColor(config.backgroundColor); return Bitmap.createBitmap(480, 480, Bitmap.Config.RGB_565).apply { for (x in 0 until 480) for (y in 0 until 480) setPixel(x, y, if (matrix[x, y]) foreground else background) } }
