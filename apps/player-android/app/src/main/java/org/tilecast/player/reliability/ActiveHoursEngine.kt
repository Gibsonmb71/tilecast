package org.tilecast.player.reliability

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

data class ActiveHoursRule(val enabled:Boolean,val timezone:String,val days:Set<DayOfWeek>,val start:LocalTime,val end:LocalTime)
data class ActiveHoursResult(val active:Boolean,val nextTransition:Instant?,val overnight:Boolean)

object ActiveHoursEngine {
    fun evaluate(now:Instant,rule:ActiveHoursRule,takeoverActive:Boolean=false):ActiveHoursResult {
        if(takeoverActive)return ActiveHoursResult(true,null,rule.end<=rule.start)
        if(!rule.enabled)return ActiveHoursResult(true,null,rule.end<=rule.start)
        val zone=ZoneId.of(rule.timezone)
        val local=now.atZone(zone)
        val overnight=rule.end<=rule.start
        val active=if(!overnight) local.dayOfWeek in rule.days && !local.toLocalTime().isBefore(rule.start) && local.toLocalTime().isBefore(rule.end)
        else (local.dayOfWeek in rule.days && !local.toLocalTime().isBefore(rule.start)) || (local.minusDays(1).dayOfWeek in rule.days && local.toLocalTime().isBefore(rule.end))
        return ActiveHoursResult(active,nextTransition(now,rule,zone),overnight)
    }
    private fun nextTransition(now:Instant,rule:ActiveHoursRule,zone:ZoneId):Instant? {
        val base=now.atZone(zone).toLocalDate()
        val candidates=mutableListOf<Instant>()
        for(offset in -1L..8L){val date=base.plusDays(offset);if(date.dayOfWeek !in rule.days)continue
            candidates+=resolve(date,rule.start,zone,false).toInstant()
            val endDate=if(rule.end<=rule.start)date.plusDays(1) else date
            candidates+=resolve(endDate,rule.end,zone,true).toInstant()
        }
        return candidates.filter{it>now}.minOrNull()
    }
    private fun resolve(date:LocalDate,time:LocalTime,zone:ZoneId,end:Boolean):ZonedDateTime {
        val local=LocalDateTime.of(date,time)
        val offsets=zone.rules.getValidOffsets(local)
        if(offsets.isEmpty())return ZonedDateTime.of(zone.rules.getTransition(local).dateTimeAfter,zone)
        return ZonedDateTime.ofLocal(local,zone,if(end) offsets.last() else offsets.first())
    }
}
