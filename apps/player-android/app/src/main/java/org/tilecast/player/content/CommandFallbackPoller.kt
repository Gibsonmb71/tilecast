package org.tilecast.player.content

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Polls Player commands over plain HTTP on a fixed interval, independent of the WebSocket.
 *
 * The WebSocket alone cannot be trusted to deliver `commands.available`: a half-open
 * socket still looks connected while silently receiving nothing, which strands Studio
 * screen controls in `pending` even though ordinary HTTP (previews, heartbeats) keeps
 * working. This poller keeps command handling alive through such a wedge. WebSocket
 * notification remains the fast path; each tick simply re-runs the same guarded poll,
 * whose mutex and idempotency store make overlapping notification and timer polls safe.
 *
 * The poller starts once after the first successful paired command fetch and runs for the
 * life of the owning scope (the ViewModel), deliberately surviving socket closure. It
 * stops only on [stop] (credential rejection / local revocation) or scope cancellation.
 */
class CommandFallbackPoller(private val intervalMillis: Long = 7_000L) {
    private var job: Job? = null
    private var key: String? = null

    val running: Boolean get() = job?.isActive == true

    /**
     * Starts the loop if it is not already running for [key]. A changed key (new server URL
     * or credential) replaces the old loop so the poller never keeps polling a stale target.
     * [pollOnce] is the guarded command poll.
     */
    fun ensureStarted(scope: CoroutineScope, key: String, pollOnce: suspend () -> Unit) {
        if (job?.isActive == true && this.key == key) return
        job?.cancel()
        this.key = key
        job = scope.launch {
            while (true) {
                delay(intervalMillis)
                pollOnce()
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        key = null
    }
}
