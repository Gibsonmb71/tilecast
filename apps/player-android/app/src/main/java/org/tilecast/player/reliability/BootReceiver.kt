package org.tilecast.player.reliability

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.tilecast.player.MainActivity

class BootReceiver:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){if(intent.action!=Intent.ACTION_BOOT_COMPLETED&&intent.action!="android.intent.action.LOCKED_BOOT_COMPLETED")return;val store=context.getSharedPreferences("tilecast-reliability",Context.MODE_PRIVATE);store.edit().putString("boot-result","received").putLong("last-cold-boot",System.currentTimeMillis()).apply();if(store.getBoolean("launch-after-boot",true))runCatching{context.startActivity(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))}.onFailure{store.edit().putString("boot-result","foreground_launch_blocked").apply()}}}
