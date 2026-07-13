package org.tilecast.player.reliability

import java.time.Duration
import java.time.Instant

enum class RecoveryLevel { RETRY, SKIP_ITEM, RECREATE_RENDERER, RECREATE_CONTROLLER, RESTART_ACTIVITY, RESTART_PROCESS, SAFE_MODE }
data class RecoveryDecision(val level:RecoveryLevel,val recoveryCount:Int,val safeMode:Boolean)

class ReliabilitySupervisor(private val maximumProcessRestarts:Int=3,private val window:Duration=Duration.ofMinutes(10),private val safeModeEnabled:Boolean=true) {
    private val failures=ArrayDeque<Instant>()
    var safeMode:Boolean=false; private set
    fun recordFailure(now:Instant=Instant.now()):RecoveryDecision {
        while(failures.firstOrNull()?.isBefore(now.minus(window))==true)failures.removeFirst()
        failures.addLast(now)
        val count=failures.size
        val level=when(count){1->RecoveryLevel.RETRY;2->RecoveryLevel.SKIP_ITEM;3->RecoveryLevel.RECREATE_RENDERER;4->RecoveryLevel.RECREATE_CONTROLLER;5->RecoveryLevel.RESTART_ACTIVITY;else->if(count<=5+maximumProcessRestarts) RecoveryLevel.RESTART_PROCESS else RecoveryLevel.SAFE_MODE}
        if(level==RecoveryLevel.SAFE_MODE&&safeModeEnabled)safeMode=true
        return RecoveryDecision(if(level==RecoveryLevel.SAFE_MODE&&!safeModeEnabled)RecoveryLevel.RESTART_PROCESS else level,count,safeMode)
    }
    fun exitSafeMode(){safeMode=false;failures.clear()}
}
