package org.tilecast.player

import java.util.concurrent.atomic.AtomicLong

internal class ConnectionEpoch {
    private val value = AtomicLong()

    fun capture(): Long = value.get()
    fun isCurrent(captured: Long): Boolean = value.get() == captured
    fun invalidate(): Long = value.incrementAndGet()
}
