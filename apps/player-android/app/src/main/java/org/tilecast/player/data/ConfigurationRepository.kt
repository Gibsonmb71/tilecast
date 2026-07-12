package org.tilecast.player.data

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
        current.copy(screenId = screenId, screenName = screenName).also { dao.save(it) }

    suspend fun clearPairing() = dao.clearPairing()
    suspend fun reset() = dao.reset()
}

