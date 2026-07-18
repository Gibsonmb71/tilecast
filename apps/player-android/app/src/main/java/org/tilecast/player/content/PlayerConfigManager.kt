package org.tilecast.player.content

import androidx.room.withTransaction
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.data.StoredPlayerConfig
import org.tilecast.player.network.PlayerConfig
import org.tilecast.player.network.TilecastApi

internal fun shouldAcceptPlayerConfig(activeRevision: Long?, incomingRevision: Long): Boolean =
    activeRevision == null || incomingRevision > activeRevision

class PlayerConfigManager(private val database:PlayerDatabase,private val api:TilecastApi){
    suspend fun loadActive():PlayerConfig?=database.playerConfigs().active()?.let{runCatching{api.decodePlayerConfig(it.rawJson).also(PlayerConfigValidator::validate)}.getOrNull()}
    suspend fun reconcile(server:String,credential:String):PlayerConfig?{val active=database.playerConfigs().active();val response=api.playerConfig(server,credential,active?.etag);if(response.notModified)return null;val config=response.config?:return null;PlayerConfigValidator.validate(config);if(!shouldAcceptPlayerConfig(active?.configRevision,config.configRevision))return null;val raw=response.rawJson?:return null;database.withTransaction{database.playerConfigs().save(StoredPlayerConfig(config.configRevision,config.schemaVersion,raw,response.etag,"ready",System.currentTimeMillis()));database.playerConfigs().activate(config.configRevision,System.currentTimeMillis())};return config}
}
object PlayerConfigValidator{fun validate(config:PlayerConfig){require(config.schemaVersion==1);require(config.cache.maximumBytes in 268435456..1099511627776);require(config.cache.minimumFreeBytes in 134217728..config.cache.maximumBytes);require(config.cache.concurrentDownloads in 1..8);require(config.sync.manifestReconciliationSeconds in 60..86400);require(config.sync.statusReportSeconds in 15..3600);require(config.playback.defaultVolume in 0.0..1.0);require(config.playback.defaultFitMode in listOf("contain","cover","stretch"));require(Regex("^#[0-9A-Fa-f]{6}$").matches(config.branding.backgroundColor));require(Regex("^#[0-9A-Fa-f]{6}$").matches(config.branding.textColor));require(config.reliability.mode in listOf("standard","managed_kiosk"));require(config.reliability.playbackStallSeconds in 10..600);require(config.reliability.webviewStallSeconds in 15..600);require(config.reliability.maximumProcessRestarts in 0..10);require(config.reliability.restartWindowMinutes in 1..120);require(config.power.activeHoursDays.isNotEmpty()&&config.power.activeHoursDays.all{it in 1..7});require(Regex("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$").matches(config.power.activeHoursStart));require(Regex("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$").matches(config.power.activeHoursEnd));java.time.ZoneId.of(config.power.activeHoursTimezone);require(config.accessibility.returnDelaySeconds in 3..300);require(config.accessibility.maximumReturns in 1..20);require(config.accessibility.returnWindowMinutes in 1..120);require(config.updates.channel in listOf("stable","beta"))}}
