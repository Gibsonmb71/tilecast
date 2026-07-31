package org.tilecast.player.network

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class LiveStreamProtocolTest {
    @Test
    fun `encodes server binary frame header`() {
        val jpeg = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 1, 0xff.toByte(), 0xd9.toByte())
        val frame = encodeLiveStreamFrame(
            "bffef4b1-f9b5-4b25-9d4f-864fba88d86d",
            1_775_000_000_123,
            640,
            360,
            jpeg,
        ).toByteArray()
        val buffer = ByteBuffer.wrap(frame).order(ByteOrder.BIG_ENDIAN)
        val magic = ByteArray(4).also(buffer::get)

        assertArrayEquals("TCLS".encodeToByteArray(), magic)
        assertEquals(1, buffer.get().toInt())
        buffer.position(21)
        assertEquals(1_775_000_000_123, buffer.long)
        assertEquals(640, buffer.short.toInt() and 0xffff)
        assertEquals(360, buffer.short.toInt() and 0xffff)
        assertArrayEquals(jpeg, frame.copyOfRange(33, frame.size))
    }
}
