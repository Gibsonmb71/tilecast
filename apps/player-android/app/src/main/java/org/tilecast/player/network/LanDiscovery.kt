package org.tilecast.player.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import org.tilecast.player.core.DiscoveredServer

class LanDiscovery(context: Context) {
    private val manager = context.getSystemService(Context.NSD_SERVICE) as NsdManager

    fun discover(): Flow<DiscoveredServer> = callbackFlow {
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String) = Unit
            override fun onStartDiscoveryFailed(type: String, code: Int) { close(IllegalStateException("LAN discovery could not start ($code)")) }
            override fun onStopDiscoveryFailed(type: String, code: Int) = Unit
            override fun onDiscoveryStopped(type: String) = Unit
            override fun onServiceLost(service: NsdServiceInfo) = Unit
            override fun onServiceFound(service: NsdServiceInfo) {
                if (!service.serviceType.startsWith("_tilecast._tcp")) return
                manager.resolveService(service, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, code: Int) = Unit
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        val attributes = info.attributes.mapValues { String(it.value, Charsets.UTF_8) }
                        val baseUrl = attributes["base-url"] ?: "http://${info.host.hostAddress}:${info.port}"
                        trySend(DiscoveredServer(info.serviceName, baseUrl.trimEnd('/'), attributes["installation-id"]))
                    }
                })
            }
        }
        manager.discoverServices("_tilecast._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
        awaitClose { runCatching { manager.stopServiceDiscovery(listener) } }
    }
}

