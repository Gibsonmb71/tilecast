package org.tilecast.player.content

import androidx.room.withTransaction
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.data.StoredPlayerConfig
import org.tilecast.player.network.PlayerConfig
import org.tilecast.player.network.TilecastApi

class PlayerConfigManager(private val database:PlayerDatabase,private val api:TilecastApi){
    suspend fun loadActive():PlayerConfig?=database.playerConfigs().active()?.let{runCatching{api.decodePlayerConfig(it.rawJson)}.getOrNull()}
    suspend fun reconcile(server:String,credential:String):PlayerConfig?{val active=database.playerConfigs().active();val response=api.playerConfig(server,credential,active?.etag);if(response.notModified)return null;val config=response.config?:return null;PlayerConfigValidator.validate(config);val raw=response.rawJson?:return null;database.withTransaction{database.playerConfigs().save(StoredPlayerConfig(config.configRevision,config.schemaVersion,raw,response.etag,"ready",System.currentTimeMillis()));database.playerConfigs().activate(config.configRevision,System.currentTimeMillis())};return config}
}
object PlayerConfigValidator{fun validate(config:PlayerConfig){require(config.schemaVersion==1);require(config.cache.maximumBytes in 268435456..1099511627776);require(config.cache.minimumFreeBytes in 134217728..config.cache.maximumBytes);require(config.cache.concurrentDownloads in 1..8);require(config.sync.manifestReconciliationSeconds in 60..86400);require(config.sync.statusReportSeconds in 15..3600);require(config.playback.defaultVolume in 0.0..1.0);require(config.playback.defaultFitMode in listOf("contain","cover","stretch"));require(Regex("^#[0-9A-Fa-f]{6}$").matches(config.branding.backgroundColor));require(Regex("^#[0-9A-Fa-f]{6}$").matches(config.branding.textColor))}}
