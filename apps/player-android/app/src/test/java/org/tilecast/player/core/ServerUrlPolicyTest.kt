package org.tilecast.player.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlPolicyTest {
    @Test fun normalizesHttpsAndTrailingSlash() {
        assertEquals("https://signage.example.com", ServerUrlPolicy.normalize(" signage.example.com/ ").getOrThrow().value)
        assertFalse(ServerUrlPolicy.normalize("https://signage.example.com/").getOrThrow().localInsecure)
    }
    @Test fun acceptsExplicitPortsAndPrivateLanHttp() {
        val values = listOf("http://192.168.1.50:8080", "http://10.2.3.4", "http://172.16.0.2", "http://tilecast.local:8080", "http://localhost:8080", "http://169.254.1.2")
        values.forEach { assertTrue(it, ServerUrlPolicy.normalize(it).getOrThrow().localInsecure) }
    }
    @Test fun rejectsPublicHttpAndUnsupportedSchemes() {
        assertTrue(ServerUrlPolicy.normalize("http://example.com").isFailure)
        assertTrue(ServerUrlPolicy.normalize("ftp://192.168.1.2").isFailure)
        assertTrue(ServerUrlPolicy.normalize("https://example.com/path").isFailure)
    }
}

