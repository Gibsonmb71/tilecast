package org.tilecast.player.data

import java.util.UUID
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.tilecast.player.network.PairingSession

class ConfigurationRepositoryTest {
    @Test fun playerGeneratedIdIsDurableAcrossReads() = runTest {
        val dao = FakeDao(); val repository = ConfigurationRepository(dao)
        val first = repository.getOrCreate(); val second = repository.getOrCreate()
        assertEquals(first.playerInstallationId, second.playerInstallationId)
        assertNotNull(UUID.fromString(first.playerInstallationId))
    }
    @Test fun pairingSessionSurvivesRepositoryRecreationAndClearsAfterEnrollment() = runTest {
        val dao=FakeDao();val first=ConfigurationRepository(dao);val config=first.getOrCreate();val id=config.playerInstallationId
        first.savePairingSession(config,PairingSession("session","ABC234","poll-secret","2030-01-01T00:00:00Z","2029-01-01T00:00:00Z",3,"/pair","Tilecast"))
        val restored=ConfigurationRepository(dao).getOrCreate()
        assertEquals("session",restored.pairingSessionId);assertEquals("poll-secret",restored.pairingPollSecret);assertEquals(id,restored.playerInstallationId)
        val enrolled=ConfigurationRepository(dao).saveEnrollment(restored,"screen","Cafeteria Display")
        assertEquals(null,enrolled.pairingSessionId);assertEquals(id,enrolled.playerInstallationId)
    }
    private class FakeDao : PlayerConfigurationDao {
        var value: PlayerConfiguration? = null
        override suspend fun get() = value
        override suspend fun save(configuration: PlayerConfiguration) { value = configuration }
        override suspend fun clearPairing() { value = value?.copy(screenId = null, screenName = null) }
        override suspend fun reset() { value = null }
    }
}
