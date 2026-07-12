package org.tilecast.player.core

import org.tilecast.player.network.PairingSession
import org.tilecast.player.network.ServerIdentity

sealed interface PlayerState {
    data object Unconfigured : PlayerState
    data object Discovering : PlayerState
    data class ServerSelection(val servers: List<DiscoveredServer>, val message: String? = null) : PlayerState
    data class ManualServerEntry(val error: String? = null) : PlayerState
    data class ValidatingServer(val serverUrl: String) : PlayerState
    data class ServerConfirmation(val serverUrl: NormalizedServerUrl, val identity: ServerIdentity) : PlayerState
    data object PairingRequest : PlayerState
    data class WaitingForApproval(val serverUrl: String, val organizationName: String, val pairing: PairingSession) : PlayerState
    data object Enrolling : PlayerState
    data class PairedConnecting(val screenName: String) : PlayerState
    data class PairedIdle(val screenName: String, val connected: Boolean, val detail: String? = null) : PlayerState
    data class CredentialRevoked(val screenName: String?) : PlayerState
    data class ServerIdentityMismatch(val expected: String, val actual: String) : PlayerState
    data class ConnectionError(val message: String, val recoverable: Boolean = true) : PlayerState
}

data class DiscoveredServer(val name: String, val baseUrl: String, val installationId: String?)

sealed interface PlayerEvent {
    data object Start : PlayerEvent
    data class DiscoveryFinished(val servers: List<DiscoveredServer>) : PlayerEvent
    data object EnterManualAddress : PlayerEvent
    data class Validate(val url: String) : PlayerEvent
    data class IdentityConfirmed(val url: NormalizedServerUrl, val identity: ServerIdentity) : PlayerEvent
    data object RequestPairing : PlayerEvent
    data class PairingCreated(val url: String, val organization: String, val session: PairingSession) : PlayerEvent
    data object EnrollmentStarted : PlayerEvent
    data class Enrolled(val screenName: String) : PlayerEvent
    data class Connected(val screenName: String) : PlayerEvent
    data class Disconnected(val screenName: String, val reason: String?) : PlayerEvent
    data class Revoked(val screenName: String?) : PlayerEvent
    data class IdentityChanged(val expected: String, val actual: String) : PlayerEvent
    data class Failed(val message: String) : PlayerEvent
    data object Reset : PlayerEvent
}

class PlayerStateMachine(initial: PlayerState = PlayerState.Unconfigured) {
    var state: PlayerState = initial
        private set

    fun transition(event: PlayerEvent): PlayerState {
        state = when (event) {
            PlayerEvent.Start -> PlayerState.Discovering
            is PlayerEvent.DiscoveryFinished -> PlayerState.ServerSelection(event.servers)
            PlayerEvent.EnterManualAddress -> PlayerState.ManualServerEntry()
            is PlayerEvent.Validate -> PlayerState.ValidatingServer(event.url)
            is PlayerEvent.IdentityConfirmed -> PlayerState.ServerConfirmation(event.url, event.identity)
            PlayerEvent.RequestPairing -> PlayerState.PairingRequest
            is PlayerEvent.PairingCreated -> PlayerState.WaitingForApproval(event.url, event.organization, event.session)
            PlayerEvent.EnrollmentStarted -> PlayerState.Enrolling
            is PlayerEvent.Enrolled -> PlayerState.PairedConnecting(event.screenName)
            is PlayerEvent.Connected -> PlayerState.PairedIdle(event.screenName, true)
            is PlayerEvent.Disconnected -> PlayerState.PairedIdle(event.screenName, false, event.reason)
            is PlayerEvent.Revoked -> PlayerState.CredentialRevoked(event.screenName)
            is PlayerEvent.IdentityChanged -> PlayerState.ServerIdentityMismatch(event.expected, event.actual)
            is PlayerEvent.Failed -> PlayerState.ConnectionError(event.message)
            PlayerEvent.Reset -> PlayerState.Unconfigured
        }
        return state
    }
}

