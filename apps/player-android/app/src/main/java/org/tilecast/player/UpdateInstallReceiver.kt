package org.tilecast.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

class UpdateInstallReceiver:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){if(intent.action==Intent.ACTION_MY_PACKAGE_REPLACED){relaunchPlayer(context);return};val status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);if(status==PackageInstaller.STATUS_PENDING_USER_ACTION){context.getSharedPreferences("tilecast-player-updates",Context.MODE_PRIVATE).edit().putString("installer-result","installer_confirmation_required").apply();@Suppress("DEPRECATION") val confirm=intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT);confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);if(confirm!=null)context.startActivity(confirm)}else{context.getSharedPreferences("tilecast-player-updates",Context.MODE_PRIVATE).edit().putString("installer-result",installerResultCode(status)).apply();if(shouldRelaunchAfterInstall(intent.action,status))relaunchPlayer(context)}}}

internal fun shouldRelaunchAfterInstall(action:String?,status:Int)=action==Intent.ACTION_MY_PACKAGE_REPLACED||status==PackageInstaller.STATUS_SUCCESS

internal fun relaunchPlayer(context:Context):Boolean {context.getSharedPreferences("tilecast-reliability",Context.MODE_PRIVATE).edit().putBoolean("update-active",false).apply();val launch=context.packageManager.getLeanbackLaunchIntentForPackage(context.packageName)?:context.packageManager.getLaunchIntentForPackage(context.packageName)?:return false;launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP);return runCatching{context.startActivity(launch);true}.getOrDefault(false)}

internal fun installerResultCode(status:Int)=when(status){
    PackageInstaller.STATUS_SUCCESS->"success"
    PackageInstaller.STATUS_FAILURE_ABORTED->"installer_aborted"
    PackageInstaller.STATUS_FAILURE_BLOCKED->"installer_blocked"
    PackageInstaller.STATUS_FAILURE_CONFLICT->"installer_conflict"
    PackageInstaller.STATUS_FAILURE_INCOMPATIBLE->"installer_incompatible"
    PackageInstaller.STATUS_FAILURE_INVALID->"installer_invalid"
    PackageInstaller.STATUS_FAILURE_STORAGE->"installer_storage"
    else->"installer_failed"
}
