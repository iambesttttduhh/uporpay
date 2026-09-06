package com.wakelock.util

import java.util.Calendar

object ScheduleMath {

    fun parseDays(csv: String): Set<Int> =
        csv.split(",").mapNotNull { it.trim().toIntOrNull() }.filter { it in 1..7 }.toSet()

    fun daysToCsv(days: Set<Int>): String = days.sorted().joinToString(",")

    /** Calendar.DAY_OF_WEEK (Sun=1..Sat=7) -> ISO (Mon=1..Sun=7) */
    fun isoDow(cal: Calendar): Int {
        val d = cal.get(Calendar.DAY_OF_WEEK)
        return if (d == Calendar.SUNDAY) 7 else d - 1
    }

    /**
     * Next trigger time in epoch millis for the given wall-clock time and repeat set.
     * Repeat empty => next occurrence today or tomorrow (one-shot).
     */
    fun nextTrigger(hour: Int, minute: Int, repeatCsv: String, nowMs: Long): Long {
        val days = parseDays(repeatCsv)
        val cal = Calendar.getInstance().apply {
            timeInMillis = nowMs
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (days.isEmpty()) {
            if (cal.timeInMillis <= nowMs) cal.add(Calendar.DAY_OF_YEAR, 1)
            return cal.timeInMillis
        }
        for (i in 0..7) {
            val c = (cal.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, i) }
            if (isoDow(c) in days && c.timeInMillis > nowMs) return c.timeInMillis
        }
        return cal.timeInMillis
    }

    fun repeatLabel(csv: String): String {
        val d = parseDays(csv)
        return when {
            d.isEmpty() -> "Once"
            d == setOf(1, 2, 3, 4, 5, 6, 7) -> "Daily"
            d == setOf(1, 2, 3, 4, 5) -> "Weekdays"
            d == setOf(6, 7) -> "Weekends"
            else -> {
                val n = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
                d.sorted().joinToString(" ") { n[it - 1] }
            }
        }
    }

    fun fmtDuration(ms: Long): String {
        val total = (ms / 1000).coerceAtLeast(0)
        val m = total / 60
        val s = total % 60
        return "%d:%02d".format(m, s)
    }

    fun fmtCompletion(ms: Long): String {
        val total = ms / 1000
        return if (total >= 60) "${total / 60}m ${total % 60}s" else "${total}s"
    }
}
