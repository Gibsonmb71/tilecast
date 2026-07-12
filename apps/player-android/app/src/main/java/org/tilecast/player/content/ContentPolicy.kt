package org.tilecast.player.content

import java.io.File
import java.security.MessageDigest

object ContentPolicy {
    fun shouldDownload(policy: String, mimeType: String, fileSize: Long, availableBytes: Long, automaticVideoThresholdBytes: Long = 256L * 1024 * 1024): Boolean = when (policy) {
        "download" -> true
        "stream" -> false
        "automatic" -> mimeType.startsWith("image/") || (mimeType.startsWith("video/") && fileSize <= automaticVideoThresholdBytes && fileSize <= availableBytes)
        else -> false
    }
    fun verify(file: File, expectedSize: Long, expectedSha256: String): Boolean {
        if (!file.exists() || file.length() != expectedSize) return false
        val digest=MessageDigest.getInstance("SHA-256");file.inputStream().use{input->val buffer=ByteArray(128*1024);while(true){val count=input.read(buffer);if(count<0)break;digest.update(buffer,0,count)}}
        return digest.digest().joinToString(""){"%02x".format(it)}==expectedSha256
    }
}
