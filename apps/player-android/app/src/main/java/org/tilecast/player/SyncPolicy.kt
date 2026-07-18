package org.tilecast.player

internal fun manifestPollDelayMillis(configuredSeconds: Int?): Long =
    (configuredSeconds ?: 300).coerceIn(60, 86_400).toLong() * 1_000L
