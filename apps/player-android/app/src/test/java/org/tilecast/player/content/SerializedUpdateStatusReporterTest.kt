package org.tilecast.player.content

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SerializedUpdateStatusReporterTest {
    @Test
    fun serializesReportsAndWaitsForTheLatestOne() = runTest {
        val firstStarted = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val reported = mutableListOf<Long>()
        var activeReports = 0
        var maximumActiveReports = 0

        val reporter = SerializedUpdateStatusReporter(
            scope = this,
            intervalMs = 0,
            now = { 0L },
        ) { downloadedBytes ->
            activeReports += 1
            maximumActiveReports = maxOf(maximumActiveReports, activeReports)
            reported += downloadedBytes
            if (downloadedBytes == 1L) {
                firstStarted.complete(Unit)
                releaseFirst.await()
            }
            activeReports -= 1
        }

        reporter.submit(1)
        runCurrent()
        firstStarted.await()

        reporter.submit(2)
        runCurrent()
        assertEquals(listOf(1L), reported)

        releaseFirst.complete(Unit)
        advanceUntilIdle()
        reporter.awaitIdle()

        assertEquals(listOf(1L, 2L), reported)
        assertEquals(1, maximumActiveReports)
    }
}
