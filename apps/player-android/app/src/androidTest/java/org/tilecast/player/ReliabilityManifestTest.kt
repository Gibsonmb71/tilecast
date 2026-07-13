package org.tilecast.player

import android.Manifest
import android.content.ComponentName
import android.content.pm.PackageManager
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.tilecast.player.reliability.BootReceiver
import org.tilecast.player.reliability.TilecastAccessibilityService

class ReliabilityManifestTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun bootReceiverAndAccessibilityServiceAreExplicitlyDeclared(){
        val packageManager=context.packageManager
        @Suppress("DEPRECATION")
        assertNotNull(packageManager.getReceiverInfo(ComponentName(context,BootReceiver::class.java),0))
        @Suppress("DEPRECATION")
        val service=packageManager.getServiceInfo(ComponentName(context,TilecastAccessibilityService::class.java),0)
        assertEquals(Manifest.permission.BIND_ACCESSIBILITY_SERVICE,service.permission)
    }
}
