package org.tilecast.player.content
import org.junit.Assert.*
import org.junit.Test
import org.tilecast.player.network.ManifestSchedule
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
private val fixtureJson=Json{ignoreUnknownKeys=true}
class ScheduleEngineTest {
 @Test fun precedenceHalfOpenAndFallback(){val at=Instant.parse("2026-07-12T16:00:00Z");val group=ManifestSchedule("b","group","one_time","UTC",100,0,oneTimeStart="2026-07-12T15:00:00Z",oneTimeEnd="2026-07-12T17:00:00Z");val direct=group.copy(id="a",playlistId="direct",specificity=1);assertEquals("a",ScheduleEngine.resolve(at,listOf(group,direct),"fallback").scheduleId);assertEquals("fallback",ScheduleEngine.resolve(Instant.parse("2026-07-12T17:00:00Z"),listOf(group,direct),"fallback").playlistId)}
 @Test fun overnightAndSpringGap(){val overnight=ManifestSchedule("night","p","weekly","America/New_York",0,0,dailyStart="22:00",dailyEnd="02:00",daysOfWeek=listOf(5));assertEquals("night",ScheduleEngine.resolve(Instant.parse("2026-07-11T05:00:00Z"),listOf(overnight),null).scheduleId);val gap=overnight.copy(id="gap",dailyStart="02:30",dailyEnd="04:00",daysOfWeek=listOf(0));val result=ScheduleEngine.resolve(Instant.parse("2026-03-08T07:15:00Z"),listOf(gap),null);assertEquals("gap",result.scheduleId)}
 @Test fun repeatedTimeUsesEarlierStartAndLaterEnd(){val repeated=ManifestSchedule("fall","p","weekly","America/New_York",0,0,dailyStart="01:30",dailyEnd="01:45",daysOfWeek=listOf(0));assertEquals("fall",ScheduleEngine.resolve(Instant.parse("2026-11-01T06:35:00Z"),listOf(repeated),null).scheduleId)}
 @Serializable data class Fixture(val name:String,val now:String,val fallbackPlaylistId:String?=null,val schedules:List<ManifestSchedule>,val expectedScheduleId:String?=null,val expectedPlaylistId:String?=null,val expectedSource:String)
 @Test fun sharedParityFixtures(){val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}.map{File(it,"packages/manifest-schema/schedule-fixtures.json")}.first{it.exists()};val fixtures=fixtureJson.decodeFromString<List<Fixture>>(file.readText());fixtures.forEach{fixture->val result=ScheduleEngine.resolve(Instant.parse(fixture.now),fixture.schedules,fixture.fallbackPlaylistId);assertEquals(fixture.name,fixture.expectedScheduleId,result.scheduleId);assertEquals(fixture.name,fixture.expectedPlaylistId,result.playlistId);assertEquals(fixture.name,fixture.expectedSource,result.source)}}
}
