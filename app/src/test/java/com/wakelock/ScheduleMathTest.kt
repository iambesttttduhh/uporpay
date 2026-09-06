package com.wakelock

import com.wakelock.util.ScheduleMath
import org.junit.Assert.*
import org.junit.Test
import java.util.Calendar

class ScheduleMathTest {

    private fun cal(y: Int, m: Int, d: Int, h: Int, min: Int): Long =
        Calendar.getInstance().apply {
            set(y, m, d, h, min, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis

    @Test fun one_shot_today_if_later() {
        val now = cal(2026, 0, 5, 6, 0)
        val t = ScheduleMath.nextTrigger(7, 0, "", now)
        assertEquals(cal(2026, 0, 5, 7, 0), t)
    }

    @Test fun one_shot_tomorrow_if_passed() {
        val now = cal(2026, 0, 5, 8, 0)
        val t = ScheduleMath.nextTrigger(7, 0, "", now)
        assertEquals(cal(2026, 0, 6, 7, 0), t)
    }

    @Test fun repeat_picks_a_future_allowed_day() {
        val now = cal(2026, 0, 5, 8, 0)
        val t = ScheduleMath.nextTrigger(7, 0, "1,2,3,4,5", now)
        assertTrue(t > now)
        val c = Calendar.getInstance().apply { timeInMillis = t }
        assertTrue(ScheduleMath.isoDow(c) in 1..5)
        assertEquals(7, c.get(Calendar.HOUR_OF_DAY))
    }

    @Test fun weekend_repeat_lands_on_weekend() {
        val now = cal(2026, 0, 5, 8, 0)
        val t = ScheduleMath.nextTrigger(9, 30, "6,7", now)
        val c = Calendar.getInstance().apply { timeInMillis = t }
        assertTrue(ScheduleMath.isoDow(c) in 6..7)
    }

    @Test fun labels() {
        assertEquals("Once", ScheduleMath.repeatLabel(""))
        assertEquals("Daily", ScheduleMath.repeatLabel("1,2,3,4,5,6,7"))
        assertEquals("Weekdays", ScheduleMath.repeatLabel("1,2,3,4,5"))
        assertEquals("Weekends", ScheduleMath.repeatLabel("6,7"))
    }

    @Test fun duration_formatting() {
        assertEquals("0:09", ScheduleMath.fmtDuration(9_000))
        assertEquals("10:00", ScheduleMath.fmtDuration(600_000))
        assertEquals("0:00", ScheduleMath.fmtDuration(-5))
    }

    @Test fun csv_roundtrip() {
        assertEquals(setOf(1, 3, 5), ScheduleMath.parseDays("1,3,5"))
        assertEquals("1,3,5", ScheduleMath.daysToCsv(setOf(5, 1, 3)))
    }
}
