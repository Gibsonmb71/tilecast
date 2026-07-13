package org.tilecast.player.data

import org.tilecast.player.network.PairingSession
import java.util.UUID

class ConfigurationRepository(private val dao: PlayerConfigurationDao) {
    suspend fun getOrCreate(): PlayerConfiguration {
        dao.get()?.let { return it }
        val created = PlayerConfiguration(playerInstallationId = UUID.randomUUID().toString())
        dao.save(created)
        return created
    }

    suspend fun saveServer(current: PlayerConfiguration, url: String, installationId: String, organizationName: String): PlayerConfiguration =
        current.copy(serverUrl = url, serverInstallationId = installationId, organizationName = organizationName).also { dao.save(it) }

    suspend fun saveEnrollment(current: PlayerConfiguration, screenId: String, screenName: String): PlayerConfiguration =
        current.copy(screenId = screenId, screenName = screenName, pairingSessionId = null, pairingPollSecret = null, pairingCode = null, pairingExpiresAt = null, pairingPollingIntervalSeconds = null).also { dao.save(it) }

    suspend fun savePairingSession(current: PlayerConfiguration, session: PairingSession): PlayerConfiguration =
        current.copy(pairingSessionId=session.id,pairingPollSecret=session.pollSecret,pairingCode=session.code,pairingExpiresAt=session.expiresAt,pairingPollingIntervalSeconds=session.pollingIntervalSeconds).also { dao.save(it) }

    suspend fun clearPairingSession(current: PlayerConfiguration): PlayerConfiguration =
        current.copy(pairingSessionId=null,pairingPollSecret=null,pairingCode=null,pairingExpiresAt=null,pairingPollingIntervalSeconds=null).also { dao.save(it) }

    suspend fun clearPairing() = dao.clearPairing()
    suspend fun reset() = dao.reset()
}
