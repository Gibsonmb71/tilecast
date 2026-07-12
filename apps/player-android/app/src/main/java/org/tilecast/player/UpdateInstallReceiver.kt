package org.tilecast.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

class UpdateInstallReceiver:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){val status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);if(status==PackageInstaller.STATUS_PENDING_USER_ACTION){@Suppress("DEPRECATION") val confirm=intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT);confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);if(confirm!=null)context.startActivity(confirm)}else{val result=when(status){PackageInstaller.STATUS_SUCCESS->"success";PackageInstaller.STATUS_FAILURE_ABORTED->"installer_rejected";PackageInstaller.STATUS_FAILURE_CONFLICT->"installer_conflict";PackageInstaller.STATUS_FAILURE_INCOMPATIBLE->"installer_incompatible";else->"installer_failed"};context.getSharedPreferences("tilecast-player-updates",Context.MODE_PRIVATE).edit().putString("installer-result",result).apply()}}}
