package org.tilecast.player.data

import java.util.UUID
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class ConfigurationRepositoryTest {
    @Test fun playerGeneratedIdIsDurableAcrossReads() = runTest {
        val dao = FakeDao(); val repository = ConfigurationRepository(dao)
        val first = repository.getOrCreate(); val second = repository.getOrCreate()
        assertEquals(first.playerInstallationId, second.playerInstallationId)
        assertNotNull(UUID.fromString(first.playerInstallationId))
    }
    private class FakeDao : PlayerConfigurationDao {
        var value: PlayerConfiguration? = null
        override suspend fun get() = value
        override suspend fun save(configuration: PlayerConfiguration) { value = configuration }
        override suspend fun clearPairing() { value = value?.copy(screenId = null, screenName = null) }
        override suspend fun reset() { value = null }
    }
}

