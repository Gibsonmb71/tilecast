package org.tilecast.player.content

import org.tilecast.player.network.ManifestSchedule
import java.time.*

data class ScheduleSelection(val scheduleId:String?,val playlistId:String?,val layoutId:String?,val source:String,val nextTransition:Instant?,val error:String?=null,val playbackAnchor:Instant?=null)
private data class ActiveWindow(val schedule:ManifestSchedule,val start:Instant,val end:Instant)

/** Bound the server-provided grace before a pending manifest must activate. */
fun pendingActivationDelayMillis(graceSeconds:Int):Long = (if(graceSeconds>0)graceSeconds else 30).coerceAtMost(3_600)*1_000L

/** Offline, timezone-aware schedule evaluator. Intervals are half-open [start,end). */
object ScheduleEngine {
    fun resolve(now:Instant,schedules:List<ManifestSchedule>,fallbackPlaylistId:String?,fallbackLayoutId:String?=null):ScheduleSelection = try {
        val active=mutableListOf<ActiveWindow>();val transitions=mutableListOf<Instant>()
        schedules.forEach { schedule -> windows(schedule,now).forEach { window -> transitions += window.start;transitions += window.end;if(!now.isBefore(window.start)&&now.isBefore(window.end))active+=window } }
        val winner=active.sortedWith(compareByDescending<ActiveWindow>{it.schedule.priority}.thenByDescending{it.schedule.specificity}.thenByDescending{it.start}.thenBy{it.schedule.id}).firstOrNull()
        val playlistId=if(winner!=null)winner.schedule.playlistId?.takeIf(String::isNotBlank) else fallbackPlaylistId
        val layoutId=if(winner!=null)winner.schedule.layoutId else fallbackLayoutId
        ScheduleSelection(winner?.schedule?.id,playlistId,layoutId,if(winner!=null)"schedule" else if(fallbackPlaylistId!=null||fallbackLayoutId!=null)"direct_fallback" else "none",transitions.filter{it.isAfter(now)}.minOrNull(),playbackAnchor=winner?.start)
    } catch(error:Exception){ScheduleSelection(null,fallbackPlaylistId,fallbackLayoutId,if(fallbackPlaylistId!=null||fallbackLayoutId!=null)"direct_fallback" else "none",null,"Schedule evaluation failed")}

    private fun windows(s:ManifestSchedule,now:Instant):List<ActiveWindow>{
        if(s.type=="one_time")return listOf(ActiveWindow(s,Instant.parse(s.oneTimeStart),Instant.parse(s.oneTimeEnd)))
        val zone=ZoneId.of(s.timezone);val local=now.atZone(zone).toLocalDate();val dates=(-1..8).map{local.plusDays(it.toLong())};val startTime=LocalTime.parse(s.dailyStart);val endTime=LocalTime.parse(s.dailyEnd)
        return dates.filter{it.dayOfWeek.value%7 in s.daysOfWeek}.filter{(s.startDate==null||!it.isBefore(LocalDate.parse(s.startDate)))&&(s.endDate==null||!it.isAfter(LocalDate.parse(s.endDate)))}.map{date->val endDate=if(endTime<=startTime)date.plusDays(1)else date;ActiveWindow(s,resolve(date,startTime,zone,false),resolve(endDate,endTime,zone,true))}
    }
    private fun resolve(date:LocalDate,time:LocalTime,zone:ZoneId,end:Boolean):Instant { val local=LocalDateTime.of(date,time);val rules=zone.rules;val offsets=rules.getValidOffsets(local);if(offsets.isNotEmpty())return local.toInstant(if(end)offsets.last()else offsets.first());val transition=rules.getTransition(local)?:error("Invalid timezone transition");return transition.dateTimeAfter.atZone(zone).toInstant() }
}
