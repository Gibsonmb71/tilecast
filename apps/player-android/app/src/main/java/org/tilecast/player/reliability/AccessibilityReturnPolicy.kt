package org.tilecast.player.reliability

import java.time.Duration
import java.time.Instant

object AccessibilityPackages {
    val defaults=setOf("org.tilecast.player","com.android.settings","com.android.packageinstaller","com.google.android.packageinstaller","com.android.permissioncontroller","com.google.android.permissioncontroller","com.android.captiveportallogin","com.google.android.tv.setupwizard")
}
class AccessibilityReturnPolicy(private val delay:Duration,private val maximumReturns:Int,private val window:Duration,extraExcluded:Set<String> = emptySet()) {
    private val attempts=ArrayDeque<Instant>()
    val excluded=AccessibilityPackages.defaults+extraExcluded
    fun shouldReturn(packageName:String,exitedAt:Instant,now:Instant,paused:Boolean):Boolean {
        if(paused||packageName in excluded||now.isBefore(exitedAt.plus(delay)))return false
        while(attempts.firstOrNull()?.isBefore(now.minus(window))==true)attempts.removeFirst()
        return attempts.size<maximumReturns
    }
    fun recordAttempt(now:Instant){attempts.addLast(now)}
    fun attemptsInWindow(now:Instant):Int {while(attempts.firstOrNull()?.isBefore(now.minus(window))==true)attempts.removeFirst();return attempts.size}
}
