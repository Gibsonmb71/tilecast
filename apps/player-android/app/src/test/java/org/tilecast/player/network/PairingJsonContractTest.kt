package org.tilecast.player.network

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class PairingJsonContractTest {
    private val json=Json{encodeDefaults=true}
    @Test fun createPairingUsesExactServerFields(){
        val metadata=DeviceMetadata("installation","android-tv","Amazon","Fire TV","11","0.10.1",1920,1080,1.5f,"en-US","America/New_York")
        assertEquals("{\"installationId\":\"server\",\"metadata\":{\"playerInstallationId\":\"installation\",\"platform\":\"android-tv\",\"manufacturer\":\"Amazon\",\"model\":\"Fire TV\",\"androidVersion\":\"11\",\"playerVersion\":\"0.10.1\",\"screenWidth\":1920,\"screenHeight\":1080,\"density\":1.5,\"locale\":\"en-US\",\"timezone\":\"America/New_York\"}}",json.encodeToString(PairingCreateRequest("server",metadata)))
    }
    @Test fun enrollmentUsesExactServerFields(){
        assertEquals("{\"pairingSessionId\":\"session\",\"enrollmentToken\":\"token\"}",json.encodeToString(EnrollmentRequest("session","token")))
    }
}
