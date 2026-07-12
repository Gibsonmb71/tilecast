package org.tilecast.player.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerStateMachineTest {
    @Test fun followsPairingLifecycleAndRevocation() {
        val machine = PlayerStateMachine()
        assertEquals(PlayerState.Discovering, machine.transition(PlayerEvent.Start))
        assertTrue(machine.transition(PlayerEvent.DiscoveryFinished(emptyList())) is PlayerState.ServerSelection)
        assertTrue(machine.transition(PlayerEvent.EnterManualAddress) is PlayerState.ManualServerEntry)
        assertTrue(machine.transition(PlayerEvent.Validate("https://example.com")) is PlayerState.ValidatingServer)
        assertTrue(machine.transition(PlayerEvent.Enrolled("Lobby")) is PlayerState.PairedConnecting)
        assertEquals(PlayerState.PairedIdle("Lobby", true), machine.transition(PlayerEvent.Connected("Lobby")))
        assertEquals(PlayerState.CredentialRevoked("Lobby"), machine.transition(PlayerEvent.Revoked("Lobby")))
    }
    @Test fun representsInstallationMismatchExplicitly() {
        val state = PlayerStateMachine().transition(PlayerEvent.IdentityChanged("expected", "actual"))
        assertEquals(PlayerState.ServerIdentityMismatch("expected", "actual"), state)
    }
}

