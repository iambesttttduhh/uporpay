package com.wakelock.data.repo

import com.wakelock.data.db.AchievementEntity
import com.wakelock.data.db.WakeEventEntity
import java.util.Calendar

data class Stats(
    val currentStreak: Int = 0,
    val longestStreak: Int = 0,
    val totalCompleted: Int = 0,
    val totalFailed: Int = 0,
    val successRate: Int = 0,
    val averageCompletionMs: Long = 0,
    val fastestMs: Long = 0,
    val snoozes: Int = 0,
    val outsideCompletions: Int = 0
)

object StatsCalculator {

    private fun dayKey(ms: Long): Long {
        val c = Calendar.getInstance().apply {
            timeInMillis = ms
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        return c.timeInMillis / 86_400_000L
    }

    /** Streak = consecutive calendar days with at least one successful wake-up, ending today or yesterday. */
    fun streaks(events: List<WakeEventEntity>): Pair<Int, Int> {
        val days = events.filter { it.result == "SUCCESS" && !it.isTest }
            .map { dayKey(it.firedAt) }.toSortedSet().toList()
        if (days.isEmpty()) return 0 to 0

        var longest = 1; var run = 1
        for (i in 1 until days.size) {
            run = if (days[i] == days[i - 1] + 1) run + 1 else 1
            if (run > longest) longest = run
        }
        val today = dayKey(System.currentTimeMillis())
        var current = 0
        if (days.last() == today || days.last() == today - 1) {
            current = 1
            var i = days.size - 1
            while (i > 0 && days[i] == days[i - 1] + 1) { current++; i-- }
        }
        return current to longest
    }

    fun compute(events: List<WakeEventEntity>): Stats {
        val real = events.filter { !it.isTest }
        val ok = real.filter { it.result == "SUCCESS" }
        val failed = real.filter { it.result == "FAILED" }
        val times = ok.mapNotNull { it.completionMs }.filter { it > 0 }
        val (cur, longest) = streaks(real)
        return Stats(
            currentStreak = cur,
            longestStreak = longest,
            totalCompleted = ok.size,
            totalFailed = failed.size,
            successRate = if (real.isEmpty()) 0 else (ok.size * 100) / real.size,
            averageCompletionMs = if (times.isEmpty()) 0 else times.sum() / times.size,
            fastestMs = times.minOrNull() ?: 0,
            snoozes = real.sumOf { it.snoozes },
            outsideCompletions = ok.count { it.outsideUsed }
        )
    }
}

object Achievements {
    data class Def(val key: String, val title: String, val desc: String, val target: Int)

    val ALL = listOf(
        Def("first_wake", "First Wake-Up", "Complete your first challenge", 1),
        Def("streak_3", "3-Day Streak", "Three consecutive mornings", 3),
        Def("streak_7", "7-Day Streak", "Seven consecutive mornings", 7),
        Def("streak_30", "30-Day Streak", "Thirty consecutive mornings", 30),
        Def("no_snooze_10", "No Snooze", "10 alarms without snoozing", 10),
        Def("outside_first", "Outside", "Complete an Outside Mode challenge", 1),
        Def("speed", "Speed", "Finish a challenge under 60 seconds", 1),
        Def("discipline_50", "Discipline", "Complete 50 challenges", 50)
    )

    fun defaults() = ALL.map { AchievementEntity(key = it.key, target = it.target) }

    /** Recomputes progress from the event log; returns entities needing an update. */
    fun evaluate(events: List<WakeEventEntity>, existing: List<AchievementEntity>): List<AchievementEntity> {
        val real = events.filter { !it.isTest }
        val ok = real.filter { it.result == "SUCCESS" }
        val (_, longest) = StatsCalculator.streaks(real)
        val noSnooze = ok.count { it.snoozes == 0 }
        val progress = mapOf(
            "first_wake" to ok.size.coerceAtMost(1),
            "streak_3" to longest.coerceAtMost(3),
            "streak_7" to longest.coerceAtMost(7),
            "streak_30" to longest.coerceAtMost(30),
            "no_snooze_10" to noSnooze.coerceAtMost(10),
            "outside_first" to ok.count { it.outsideUsed }.coerceAtMost(1),
            "speed" to ok.count { (it.completionMs ?: Long.MAX_VALUE) < 60_000 }.coerceAtMost(1),
            "discipline_50" to ok.size.coerceAtMost(50)
        )
        val now = System.currentTimeMillis()
        return existing.mapNotNull { a ->
            val p = progress[a.key] ?: return@mapNotNull null
            val unlocked = if (p >= a.target && a.unlockedAt == null) now else a.unlockedAt
            if (p != a.progress || unlocked != a.unlockedAt) a.copy(progress = p, unlockedAt = unlocked) else null
        }
    }
}
