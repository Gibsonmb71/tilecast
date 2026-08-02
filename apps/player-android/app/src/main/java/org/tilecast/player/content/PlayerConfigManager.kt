package org.tilecast.player.content

import androidx.room.withTransaction
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.tilecast.player.data.PlayerDatabase
import org.tilecast.player.data.StoredPlayerConfig
import org.tilecast.player.network.PlayerConfig
import org.tilecast.player.network.TilecastApi

internal fun shouldAcceptPlayerConfig(
    activeRevision: Long?,
    incomingRevision: Long,
    activeConfigVerified: Boolean = true,
): Boolean = activeRevision == null ||
    incomingRevision > activeRevision ||
    (!activeConfigVerified && incomingRevision == activeRevision)

internal fun playerConfigEtagForRequest(activeConfigVerified: Boolean, etag: String?): String? =
    etag.takeIf { activeConfigVerified }

class PlayerConfigManager(private val database:PlayerDatabase,private val api:TilecastApi){
    private val reconcileMutex = Mutex()
    private var activeConfigVerified = false
    private var currentIdentity: CacheIdentity? = null
    suspend fun clear() = reconcileMutex.withLock {
        database.playerConfigs().clear()
        activeConfigVerified = false
        currentIdentity = null
    }
    suspend fun loadActive(serverUrl: String? = null, installationId: String? = null, screenId: String? = null):PlayerConfig? = reconcileMutex.withLock {
        val identity = serverUrl?.let { cacheIdentity(it, installationId, screenId) }
        if (identity == null) {
            database.playerConfigs().clear()
            activeConfigVerified = false
            currentIdentity = null
            return@withLock null
        }
        currentIdentity = identity
        val stored = database.playerConfigs().active() ?: run { activeConfigVerified = false; return@withLock null }
        if (!identity.matches(stored.installationId, stored.screenId, stored.normalizedServerUrl)) {
            database.playerConfigs().clear()
            activeConfigVerified = false
            return@withLock null
        }
        val config = runCatching { api.decodePlayerConfig(stored.rawJson).also(PlayerConfigValidator::validate) }.getOrNull()
            ?: run { activeConfigVerified = false; return@withLock null }
        activeConfigVerified = true
        config
    }
    suspend fun reconcile(server:String,credential:String,installationId:String?=null,screenId:String?=null):PlayerConfig? = reconcileMutex.withLock {
        val identity = cacheIdentity(server, installationId, screenId)
        if (identity == null) {
            activeConfigVerified = false
            return@withLock null
        }
        currentIdentity = identity
        val active=database.playerConfigs().active()
        val verifiedBeforeRequest=activeConfigVerified
        val response=api.playerConfig(server,credential,playerConfigEtagForRequest(verifiedBeforeRequest,active?.etag))
        if(response.notModified)return@withLock null
        val config=response.config?:return@withLock null
        PlayerConfigValidator.validate(config)
        if(!shouldAcceptPlayerConfig(active?.configRevision,config.configRevision,verifiedBeforeRequest))return@withLock null
        val raw=response.rawJson?:return@withLock null
        database.withTransaction{database.playerConfigs().save(StoredPlayerConfig(config.configRevision,config.schemaVersion,raw,response.etag,"ready",System.currentTimeMillis(),installationId=identity?.installationId,screenId=identity?.screenId,normalizedServerUrl=identity?.normalizedServerUrl));database.playerConfigs().activate(config.configRevision,System.currentTimeMillis())}
        activeConfigVerified = true
        config
    }
}
internal fun watchdogThresholdSeconds(policy: org.tilecast.player.network.PlayerReliabilityPolicy, websitePending: Boolean): Int =
    if (websitePending) policy.webviewStallSeconds else policy.playbackStallSeconds

object PlayerConfigValidator{fun validate(config:PlayerConfig){require(config.schemaVersion==1);require(config.cache.maximumBytes in 268435456..1099511627776);require(config.cache.minimumFreeBytes in 134217728..config.cache.maximumBytes);require(config.cache.concurrentDownloads in 1..8);require(config.sync.manifestReconciliationSeconds in 60..86400);require(config.sync.statusReportSeconds in 15..3600);require(config.playback.defaultVolume in 0.0..1.0);require(config.playback.defaultFitMode in listOf("contain","cover","stretch"));require(config.playback.defaultImageDurationSeconds in 1..86400);require(config.playback.defaultTransition in listOf("none","fade","crossfade"));require(config.website.timeoutSeconds in 1..120);require(config.website.defaultTimeoutSeconds in 1..120);require(config.website.cookiePolicy in listOf("disabled","first_party","first_and_third_party"));require(config.website.defaultCookiePolicy in listOf("disabled","first_party","first_and_third_party"));require(config.website.defaultReloadPolicy in listOf("load_once","on_each_activation","interval"));require(config.website.minimumRefreshSeconds in 30..86400);require(config.website.defaultFailureBehavior in listOf("last_success","placeholder","fallback_image","skip"));require(config.website.defaultZoomPercent in 50..200);require(Regex("^#[0-9A-Fa-f]{6}$").matches(config.branding.backgroundColor));require(Regex("^#[0-9A-Fa-f]{6}$").matches(config.branding.textColor));require(config.reliability.mode in listOf("standard","managed_kiosk"));require(config.reliability.playbackStallSeconds in 10..600);require(config.reliability.webviewStallSeconds in 15..600);require(config.reliability.maximumProcessRestarts in 0..10);require(config.reliability.restartWindowMinutes in 1..120);require(config.power.activeHoursDays.isNotEmpty()&&config.power.activeHoursDays.all{it in 1..7});require(Regex("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$").matches(config.power.activeHoursStart));require(Regex("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$").matches(config.power.activeHoursEnd));java.time.ZoneId.of(config.power.activeHoursTimezone);require(config.accessibility.returnDelaySeconds in 3..300);require(config.accessibility.maximumReturns in 1..20);require(config.accessibility.returnWindowMinutes in 1..120);require(config.updates.channel in listOf("stable","beta"))}}
