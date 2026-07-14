package org.tilecast.player

import android.content.pm.PackageInstaller
import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Test

class UpdateInstallReceiverTest {
    @Test fun preservesInstallerFailureCategories() {
        assertEquals("installer_conflict", installerResultCode(PackageInstaller.STATUS_FAILURE_CONFLICT))
        assertEquals("installer_incompatible", installerResultCode(PackageInstaller.STATUS_FAILURE_INCOMPATIBLE))
        assertEquals("installer_storage", installerResultCode(PackageInstaller.STATUS_FAILURE_STORAGE))
    }
    @Test fun relaunchesOnlyAfterSuccessfulInstallOrPackageReplacement() {
        assertEquals(true,shouldRelaunchAfterInstall(null,PackageInstaller.STATUS_SUCCESS))
        assertEquals(true,shouldRelaunchAfterInstall(Intent.ACTION_MY_PACKAGE_REPLACED,PackageInstaller.STATUS_FAILURE))
        assertEquals(false,shouldRelaunchAfterInstall(null,PackageInstaller.STATUS_FAILURE))
    }
}
