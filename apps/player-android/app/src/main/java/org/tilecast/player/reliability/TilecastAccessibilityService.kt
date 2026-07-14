package org.tilecast.player.reliability

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import org.tilecast.player.MainActivity
import java.time.Duration
import java.time.Instant

class TilecastAccessibilityService:AccessibilityService(){
    companion object { @Volatile private var active:TilecastAccessibilityService?=null;fun requestLock():Boolean=active?.performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)?:false }
    private val handler=Handler(Looper.getMainLooper())
    private var exitedAt=Instant.now()
    private var policy:AccessibilityReturnPolicy?=null
    private var policySignature=""
    override fun onAccessibilityEvent(event:AccessibilityEvent?) {
        if(event?.eventType!=AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED)return
        val packageName=event.packageName?.toString()?:return
        val store=getSharedPreferences("tilecast-reliability",Context.MODE_PRIVATE)
        if(store.getBoolean("request-lock",false)){store.edit().putBoolean("request-lock",false).apply();performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);return}
        val enabled=store.getBoolean("accessibility-enabled-by-policy",false)
        if(!enabled||packageName==this.packageName)return
        store.edit().putLong("last-foreground-exit",System.currentTimeMillis()).apply()
        if(store.getBoolean("report-foreground-package",false))store.edit().putString("last-foreground-package",packageName).apply()
        val maintenance=store.getBoolean("pause-accessibility-during-admin",true)&&store.getLong("maintenance-until",0)>System.currentTimeMillis()
        val updating=store.getBoolean("pause-accessibility-during-updates",true)&&store.getBoolean("update-active",false)
        val extra=store.getStringSet("allowed-packages", emptySet()).orEmpty()
        val delay=store.getInt("return-delay",10).coerceIn(3,300)
        val signature="$delay|${store.getInt("maximum-returns",3)}|${store.getInt("return-window",10)}|${extra.sorted()}"
        if(policy==null||signature!=policySignature){policy=AccessibilityReturnPolicy(Duration.ofSeconds(delay.toLong()),store.getInt("maximum-returns",3).coerceIn(1,20),Duration.ofMinutes(store.getInt("return-window",10).coerceIn(1,120).toLong()),extra);policySignature=signature}
        exitedAt=Instant.now()
        handler.postDelayed({policy?.let{if(it.shouldReturn(packageName,exitedAt,Instant.now(),maintenance||updating)){it.recordAttempt(Instant.now());store.edit().putInt("accessibility-return-attempts",it.attemptsInWindow(Instant.now())).putString("accessibility-return-state","return_requested").apply();startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))}else if(it.attemptsInWindow(Instant.now())>=store.getInt("maximum-returns",3))store.edit().putString("accessibility-return-state","loop_prevented").apply()}},delay*1000L)
    }
    override fun onServiceConnected(){super.onServiceConnected();active=this;val store=getSharedPreferences("tilecast-reliability",Context.MODE_PRIVATE);val attempts=store.getInt("update-relaunch-attempts",0);if(store.getBoolean("update-relaunch-requested",false)&&attempts<3){store.edit().putInt("update-relaunch-attempts",attempts+1).apply();handler.postDelayed({startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))},1500)}}
    override fun onDestroy(){if(active===this)active=null;super.onDestroy()}
    override fun onInterrupt() = Unit
}
