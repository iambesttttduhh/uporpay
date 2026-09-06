package com.wakelock

import com.wakelock.data.db.WakeEventEntity
import com.wakelock.data.repo.Achievements
import com.wakelock.data.repo.StatsCalculator
import org.junit.Assert.*
import org.junit.Test

class StatsTest {

    private val day = 86_400_000L

    private fun ev(daysAgo: Int, ok: Boolean, ms: Long? = 120_000, snoozes: Int = 0,
                   outside: Boolean = false, test: Boolean = false) = WakeEventEntity(
        id = 0, alarmId = 1, alarmName = "a",
        firedAt = System.currentTimeMillis() - daysAgo * day,
        resolvedAt = System.currentTimeMillis() - daysAgo * day,
        result = if (ok) "SUCCESS" else "FAILED",
        challengeType = "STANDARD", lineCount = 5,
        completionMs = if (ok) ms else null, snoozes = snoozes,
        outsideUsed = outside, failureActionApplied = null, isTest = test
    )

    @Test fun streak_counts_consecutive_days() {
        val e = listOf(ev(0, true), ev(1, true), ev(2, true), ev(5, true))
        val (cur, longest) = StatsCalculator.streaks(e)
        assertEquals(3, cur)
        assertEquals(3, longest)
    }

    @Test fun streak_breaks_on_gap() {
        val e = listOf(ev(0, true), ev(3, true))
        assertEquals(1, StatsCalculator.streaks(e).first)
    }

    @Test fun no_streak_when_last_success_is_old() {
        val e = listOf(ev(5, true), ev(6, true))
        assertEquals(0, StatsCalculator.streaks(e).first)
    }

    @Test fun test_events_excluded_from_stats() {
        val e = listOf(ev(0, true), ev(0, true, test = true))
        assertEquals(1, StatsCalculator.compute(e).totalCompleted)
    }

    @Test fun success_rate_and_averages() {
        val e = listOf(ev(0, true, 60_000), ev(1, true, 180_000), ev(2, false))
        val s = StatsCalculator.compute(e)
        assertEquals(2, s.totalCompleted)
        assertEquals(1, s.totalFailed)
        assertEquals(66, s.successRate)
        assertEquals(120_000, s.averageCompletionMs)
        assertEquals(60_000, s.fastestMs)
    }

    @Test fun achievements_unlock_from_events() {
        val events = List(3) { ev(it, true, 30_000) }
        val updated = Achievements.evaluate(events, Achievements.defaults())
        val first = updated.first { it.key == "first_wake" }
        assertNotNull(first.unlockedAt)
        val speed = updated.first { it.key == "speed" }
        assertNotNull("sub-60s completion should unlock speed", speed.unlockedAt)
    }

    @Test fun locked_achievement_stays_locked() {
        val updated = Achievements.evaluate(listOf(ev(0, true)), Achievements.defaults())
        val thirty = updated.firstOrNull { it.key == "streak_30" }
        assertTrue(thirty == null || thirty.unlockedAt == null)
    }
}
