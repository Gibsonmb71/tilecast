package org.tilecast.player.content

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters

internal fun resolveCountdownTarget(
    target: String,
    timezone: String,
    recurrence: String,
    now: Instant,
): Instant {
    val zone = runCatching { ZoneId.of(timezone) }.getOrDefault(ZoneId.of("UTC"))
    val original = parseCountdownTarget(target, zone) ?: return now
    if (recurrence == "none") return original
    val seed = original.atZone(zone)
    val current = now.atZone(zone)
    fun at(date: LocalDate): ZonedDateTime = date.atTime(seed.toLocalTime()).atZone(zone)
    var candidate = when (recurrence) {
        "daily" -> at(current.toLocalDate())
        "weekly" -> at(current.toLocalDate().with(TemporalAdjusters.nextOrSame(seed.dayOfWeek)))
        "monthly" -> at(current.toLocalDate().withDayOfMonth(seed.dayOfMonth.coerceAtMost(current.toLocalDate().lengthOfMonth())))
        "yearly" -> {
            val month = current.toLocalDate().withDayOfMonth(1).withMonth(seed.monthValue)
            at(month.withDayOfMonth(seed.dayOfMonth.coerceAtMost(month.lengthOfMonth())))
        }
        else -> return original
    }
    if (!candidate.toInstant().isAfter(now)) {
        candidate = when (recurrence) {
            "daily" -> at(candidate.toLocalDate().plusDays(1))
            "weekly" -> at(candidate.toLocalDate().plusWeeks(1))
            "monthly" -> {
                val month = candidate.toLocalDate().plusMonths(1).withDayOfMonth(1)
                at(month.withDayOfMonth(seed.dayOfMonth.coerceAtMost(month.lengthOfMonth())))
            }
            else -> {
                val year = candidate.toLocalDate().plusYears(1).withMonth(seed.monthValue).withDayOfMonth(1)
                at(year.withDayOfMonth(seed.dayOfMonth.coerceAtMost(year.lengthOfMonth())))
            }
        }
    }
    return candidate.toInstant()
}

private fun parseCountdownTarget(target: String, zone: ZoneId): Instant? =
    runCatching { Instant.parse(target) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(target).toInstant() }.getOrNull()
        ?: runCatching { LocalDateTime.parse(target).atZone(zone).toInstant() }.getOrNull()

internal fun formatCountdown(
    target: String,
    timezone: String,
    mode: String,
    recurrence: String,
    completionAction: String,
    completionText: String,
    visibleUnits: String,
    now: Instant,
): String? {
    val resolvedTarget = resolveCountdownTarget(target, timezone, recurrence, now)
    val complete = mode == "countdown" && recurrence == "none" && !now.isBefore(resolvedTarget)
    if (complete && completionAction == "hide") return null
    if (complete && completionAction == "completed_text") return completionText.ifBlank { "Complete" }
    val countUp = mode == "count_up" || (complete && completionAction == "count_up")
    val duration = Duration.between(if (countUp) resolvedTarget else now, if (countUp) now else resolvedTarget).abs()
    var seconds = duration.seconds
    val days = seconds / 86_400; seconds %= 86_400
    val hours = seconds / 3_600; seconds %= 3_600
    val minutes = seconds / 60; seconds %= 60
    return buildList {
        if (visibleUnits.getOrNull(0) == '1') add("${days}d")
        if (visibleUnits.getOrNull(1) == '1') add("${hours}h")
        if (visibleUnits.getOrNull(2) == '1') add("${minutes}m")
        if (visibleUnits.getOrNull(3) == '1') add("${seconds}s")
    }.joinToString(" ")
}
