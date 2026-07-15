package org.tilecast.player.content

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestSource
import org.tilecast.player.network.StructuredRecord
import org.tilecast.player.network.StructuredSourceConfig

@Composable
fun StructuredSourceItem(item:ManifestItem,source:ManifestSource,config:StructuredSourceConfig,onDone:()->Unit,onStatus:(SourcePlaybackStatus)->Unit,startOffsetMs:Long=0){
	var now by remember { mutableStateOf(Instant.now()) }
	LaunchedEffect(config.dateSelection.timezone) { while (true) { now = Instant.now(); delay(30_000) } }
	val visibleRecords = selectDateAwareRecords(config, now)
	val state = when {
		config.data.unavailable -> "unavailable"
		config.data.usingCachedData -> "cached"
		visibleRecords.isEmpty() -> "empty"
		else -> "ready"
	}
    DisposableEffect(source.assetId,state){onStatus(SourcePlaybackStatus(source.assetId,source.provider,state));onDispose{onStatus(SourcePlaybackStatus())}}
    LaunchedEffect(item.id,startOffsetMs){delay(((item.durationMs?:30_000)-startOffsetMs).coerceAtLeast(1));onDone()}
    Column(Modifier.fillMaxSize().background(Color(0xFF0E141B)).padding(horizontal=56.dp,vertical=40.dp)){
        Text(source.name,color=Color(0xFFF5F7FA),fontSize=34.sp,fontWeight=FontWeight.SemiBold)
        Spacer(Modifier.height(24.dp))
		if(config.dateSelection.enabled&&visibleRecords.isEmpty()&&config.dateSelection.noMatchBehavior=="hide") Spacer(Modifier.fillMaxSize())
		else if(config.data.unavailable||visibleRecords.isEmpty()) Column(Modifier.fillMaxSize(),verticalArrangement=Arrangement.Center,horizontalAlignment=Alignment.CenterHorizontally){Text(if(config.data.unavailable)"App temporarily unavailable" else config.emptyState,color=Color(0xFFB8C2CC),fontSize=26.sp)}
		else when(config.presentation){
			"cards"->LazyRow(horizontalArrangement=Arrangement.spacedBy(18.dp)){items(visibleRecords,key={it.id}){record->Column(Modifier.fillParentMaxWidth(.36f).background(Color(0xFF18232D)).padding(22.dp)){RecordText(record,config)}}}
			"ticker"->LazyRow(horizontalArrangement=Arrangement.spacedBy(42.dp),verticalAlignment=Alignment.CenterVertically){items(visibleRecords,key={it.id}){record->Row(horizontalArrangement=Arrangement.spacedBy(14.dp),verticalAlignment=Alignment.CenterVertically){Text("•",color=Color(0xFF69B7E7),fontSize=30.sp);Text(record.title.ifBlank{"Untitled item"},color=Color(0xFFF5F7FA),fontSize=28.sp)}}}
			else->LazyColumn(verticalArrangement=Arrangement.spacedBy(14.dp)){items(visibleRecords,key={it.id}){record->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(22.dp)){if(config.presentation=="agenda"&&config.fields.date&&record.date.isNotBlank())Text(record.date,color=Color(0xFF9FB7CB),fontSize=17.sp,modifier=Modifier.fillMaxWidth(.22f),maxLines=2);Column(Modifier.weight(1f)){RecordText(record,config);HorizontalDivider(Modifier.padding(top=12.dp),color=Color(0xFF273642))}}}}
        }
    }
}

internal fun selectDateAwareRecords(config: StructuredSourceConfig, now: Instant): List<StructuredRecord> {
	val selection = config.dateSelection
	if (!selection.enabled) return config.data.records
	val zone = runCatching { ZoneId.of(selection.timezone) }.getOrDefault(ZoneId.of("UTC"))
	val today = now.atZone(zone).toLocalDate()
	val target = if (selection.mode == "tomorrow") today.plusDays(1) else today
	fun date(record: StructuredRecord): LocalDate? = runCatching { if (record.date.contains('T')) Instant.parse(record.date).atZone(zone).toLocalDate() else LocalDate.parse(record.date.take(10)) }.getOrNull()
	val dated = config.data.records.mapNotNull { record -> date(record)?.let { it to record } }
	var matches = dated.filter { (value, _) -> !selection.excludePast || !value.isBefore(today) }.filter { (value, _) -> when (selection.mode) {
		"next_available" -> !value.isBefore(target)
		"current_week" -> { val start = today.minusDays((today.dayOfWeek.value - 1).toLong()); !value.isBefore(start) && !value.isAfter(start.plusDays(6)) }
		"custom_range" -> runCatching { !value.isBefore(LocalDate.parse(selection.customStartDate)) && !value.isAfter(LocalDate.parse(selection.customEndDate)) }.getOrDefault(false)
		else -> value == target
	} }
	if (selection.mode == "next_available" && matches.isNotEmpty()) { val first = matches.minOf { it.first }; matches = matches.filter { it.first == first } }
	if (matches.isNotEmpty()) return matches.map { it.second }
	return when (selection.noMatchBehavior) {
		"next_available" -> { val future = dated.filter { it.first.isAfter(target) }; future.minOfOrNull { it.first }?.let { next -> future.filter { it.first == next }.map { it.second } } ?: emptyList() }
		"last_known_good" -> { val past = dated.filter { it.first.isBefore(target) }; past.maxOfOrNull { it.first }?.let { last -> past.filter { it.first == last }.map { it.second } } ?: emptyList() }
		"fallback_text" -> listOf(StructuredRecord("date-fallback", selection.fallbackText))
		else -> emptyList()
	}
}

@Composable private fun RecordText(record:StructuredRecord,config:StructuredSourceConfig){
    if(config.fields.title)Text(record.title.ifBlank{"Untitled item"},color=Color(0xFFF5F7FA),fontSize=24.sp,fontWeight=FontWeight.Medium,maxLines=2,overflow=TextOverflow.Ellipsis)
    if(config.fields.subtitle&&record.subtitle.isNotBlank())Text(record.subtitle,color=Color(0xFFB8C2CC),fontSize=18.sp,maxLines=2)
    if(config.fields.author&&record.author.isNotBlank())Text(record.author,color=Color(0xFF9FB7CB),fontSize=16.sp,maxLines=1)
    if(config.fields.date&&config.presentation!="agenda"&&record.date.isNotBlank())Text(record.date,color=Color(0xFF9FB7CB),fontSize=16.sp,maxLines=1)
    if(config.fields.description&&record.description.isNotBlank())Text(record.description,color=Color(0xFFB8C2CC),fontSize=16.sp,maxLines=3,overflow=TextOverflow.Ellipsis)
    record.values.entries.take(4).forEach{(label,value)->if(value.isNotBlank())Text("$label: $value",color=Color(0xFFB8C2CC),fontSize=15.sp,maxLines=1)}
}
