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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.tilecast.player.network.ManifestItem
import org.tilecast.player.network.ManifestSource
import org.tilecast.player.network.StructuredRecord
import org.tilecast.player.network.StructuredSourceConfig

@Composable
fun StructuredSourceItem(item:ManifestItem,source:ManifestSource,config:StructuredSourceConfig,onDone:()->Unit,onStatus:(SourcePlaybackStatus)->Unit,startOffsetMs:Long=0){
    val state=if(config.data.unavailable)"unavailable" else if(config.data.usingCachedData)"cached" else if(config.data.records.isEmpty())"empty" else "ready"
    DisposableEffect(source.assetId,state){onStatus(SourcePlaybackStatus(source.assetId,source.provider,state));onDispose{onStatus(SourcePlaybackStatus())}}
    LaunchedEffect(item.id,startOffsetMs){delay(((item.durationMs?:30_000)-startOffsetMs).coerceAtLeast(1));onDone()}
    Column(Modifier.fillMaxSize().background(Color(0xFF0E141B)).padding(horizontal=56.dp,vertical=40.dp)){
        Text(source.name,color=Color(0xFFF5F7FA),fontSize=34.sp,fontWeight=FontWeight.SemiBold)
        Spacer(Modifier.height(24.dp))
        if(config.data.unavailable||config.data.records.isEmpty()) Column(Modifier.fillMaxSize(),verticalArrangement=Arrangement.Center,horizontalAlignment=Alignment.CenterHorizontally){Text(if(config.data.unavailable)"Source temporarily unavailable" else config.emptyState,color=Color(0xFFB8C2CC),fontSize=26.sp)}
        else when(config.presentation){
            "cards"->LazyRow(horizontalArrangement=Arrangement.spacedBy(18.dp)){items(config.data.records,key={it.id}){record->Column(Modifier.fillParentMaxWidth(.36f).background(Color(0xFF18232D)).padding(22.dp)){RecordText(record,config)}}}
            "ticker"->LazyRow(horizontalArrangement=Arrangement.spacedBy(42.dp),verticalAlignment=Alignment.CenterVertically){items(config.data.records,key={it.id}){record->Row(horizontalArrangement=Arrangement.spacedBy(14.dp),verticalAlignment=Alignment.CenterVertically){Text("•",color=Color(0xFF69B7E7),fontSize=30.sp);Text(record.title.ifBlank{"Untitled item"},color=Color(0xFFF5F7FA),fontSize=28.sp)}}}
            else->LazyColumn(verticalArrangement=Arrangement.spacedBy(14.dp)){items(config.data.records,key={it.id}){record->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(22.dp)){if(config.presentation=="agenda"&&config.fields.date&&record.date.isNotBlank())Text(record.date,color=Color(0xFF9FB7CB),fontSize=17.sp,modifier=Modifier.fillMaxWidth(.22f),maxLines=2);Column(Modifier.weight(1f)){RecordText(record,config);HorizontalDivider(Modifier.padding(top=12.dp),color=Color(0xFF273642))}}}}
        }
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
