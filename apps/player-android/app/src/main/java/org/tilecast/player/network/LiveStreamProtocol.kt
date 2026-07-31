package org.tilecast.player.network

import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

private const val LIVE_STREAM_HEADER_BYTES = 33

internal fun encodeLiveStreamFrame(
    sessionId: String,
    capturedAtMillis: Long,
    width: Int,
    height: Int,
    jpeg: ByteArray,
): ByteString {
    require(width in 1..65535 && height in 1..65535)
    val id = UUID.fromString(sessionId)
    return ByteBuffer.allocate(LIVE_STREAM_HEADER_BYTES + jpeg.size)
        .order(ByteOrder.BIG_ENDIAN)
        .put(byteArrayOf('T'.code.toByte(), 'C'.code.toByte(), 'L'.code.toByte(), 'S'.code.toByte()))
        .put(1)
        .putLong(id.mostSignificantBits)
        .putLong(id.leastSignificantBits)
        .putLong(capturedAtMillis)
        .putShort(width.toShort())
        .putShort(height.toShort())
        .put(jpeg)
        .array()
        .toByteString()
}
