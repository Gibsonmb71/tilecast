package org.tilecast.player.content

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Throttles update progress while serializing the accepted reports. Download
 * callbacks may arrive on an IO dispatcher, so all shared state is guarded and
 * each request waits for its predecessor before it starts.
 */
internal class SerializedUpdateStatusReporter(
    private val scope: CoroutineScope,
    private val intervalMs: Long,
    private val now: () -> Long = System::currentTimeMillis,
    private val report: suspend (Long) -> Unit,
) {
    private val lock = Any()
    private var reportedAt = now()
    private var latestReport: Job? = null

    fun submit(downloadedBytes: Long) {
        synchronized(lock) {
            val current = now()
            if (current - reportedAt < intervalMs) return
            reportedAt = current
            val previous = latestReport
            latestReport = scope.launch {
                previous?.join()
                runCatching { report(downloadedBytes) }
            }
        }
    }

    suspend fun awaitIdle() {
        while (true) {
            val report = synchronized(lock) { latestReport } ?: return
            report.join()
            if (synchronized(lock) { latestReport === report }) return
        }
    }
}
