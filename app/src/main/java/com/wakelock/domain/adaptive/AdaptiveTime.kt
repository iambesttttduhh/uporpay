package com.wakelock.domain.adaptive

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/**
 * Adaptive challenge duration.
 *
 * Rolling median of recent successful completion times x safety margin, rounded up
 * to the next whole minute, hard-clamped to the user's min/max, and allowed to move
 * at most +/- 1 minute from the currently configured limit per recalculation.
 */
object AdaptiveTime {

    const val SAFETY_MARGIN = 1.4
    private const val MAX_STEP_SECONDS = 60L
    const val MIN_SAMPLES = 3

    fun median(values: List<Long>): Double {
        if (values.isEmpty()) return 0.0
        val s = values.sorted()
        val m = s.size / 2
        return if (s.size % 2 == 1) s[m].toDouble() else (s[m - 1] + s[m]) / 2.0
    }

    /**
     * @param recentCompletionMs completion durations (ms) of recent SUCCESSFUL sessions, newest last
     * @param currentLimitSec    currently configured limit in seconds
     * @param minSec/maxSec      user-defined hard bounds in seconds
     * @return recommended limit in seconds, or null when there is not enough data
     */
    fun recommend(
        recentCompletionMs: List<Long>,
        currentLimitSec: Long,
        minSec: Long,
        maxSec: Long,
        window: Int = 14
    ): Long? {
        if (recentCompletionMs.size < MIN_SAMPLES) return null
        val lo = min(minSec, maxSec)
        val hi = max(minSec, maxSec)

        val sample = recentCompletionMs.takeLast(window)
        val medMs = median(sample)
        if (medMs <= 0.0) return null

        val targetSec = ceil((medMs / 1000.0) * SAFETY_MARGIN / 60.0).roundToLong() * 60L

        // gradual movement: never jump more than one minute at a time
        val stepped = when {
            targetSec > currentLimitSec -> min(targetSec, currentLimitSec + MAX_STEP_SECONDS)
            targetSec < currentLimitSec -> max(targetSec, currentLimitSec - MAX_STEP_SECONDS)
            else -> currentLimitSec
        }
        return stepped.coerceIn(lo, hi)
    }

    /** Human explanation for why the recommendation changed. */
    fun explain(recommendedSec: Long, currentSec: Long, samples: Int): String {
        val rm = recommendedSec / 60
        return when {
            recommendedSec > currentSec -> "Based on your last $samples wake-ups you need a little more time. Recommended: $rm min."
            recommendedSec < currentSec -> "You have been finishing early. Recommended: $rm min."
            else -> "Your current limit matches your pace. Recommended: $rm min."
        }
    }
}
