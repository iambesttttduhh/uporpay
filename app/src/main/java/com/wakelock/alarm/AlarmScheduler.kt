package com.wakelock.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.wakelock.data.db.AlarmEntity
import com.wakelock.data.db.WakeLockDb
import com.wakelock.util.ScheduleMath

object AlarmScheduler {
    const val EXTRA_ALARM_ID = "alarm_id"
    const val EXTRA_TEST = "is_test"
    private const val TAG = "WL/Scheduler"

    private fun pi(ctx: Context, alarmId: Long, test: Boolean): PendingIntent {
        val i = Intent(ctx, AlarmReceiver::class.java).apply {
            action = "com.wakelock.FIRE"
            putExtra(EXTRA_ALARM_ID, alarmId)
            putExtra(EXTRA_TEST, test)
            data = android.net.Uri.parse("wakelock://alarm/$alarmId")
        }
        return PendingIntent.getBroadcast(
            ctx, alarmId.toInt(), i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    fun canScheduleExact(ctx: Context): Boolean {
        val am = ctx.getSystemService(AlarmManager::class.java)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.canScheduleExactAlarms() else true
    }

    /** @return the epoch millis the alarm was scheduled for, or null if it could not be scheduled. */
    fun schedule(ctx: Context, alarm: AlarmEntity): Long? {
        if (!alarm.enabled) { cancel(ctx, alarm.id); return null }
        val at = ScheduleMath.nextTrigger(alarm.hour, alarm.minute, alarm.repeatDays, System.currentTimeMillis())
        return scheduleAt(ctx, alarm.id, at, false)
    }

    fun scheduleAt(ctx: Context, alarmId: Long, atMs: Long, test: Boolean): Long? {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val operation = pi(ctx, alarmId, test)
        return try {
            if (canScheduleExact(ctx)) {
                // setAlarmClock: highest priority, survives Doze, shows the system alarm icon
                am.setAlarmClock(AlarmManager.AlarmClockInfo(atMs, operation), operation)
            } else {
                // honest degradation: inexact, may be delayed by Doze
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, operation)
            }
            Log.i(TAG, "scheduled alarm=$alarmId at=$atMs exact=${canScheduleExact(ctx)} test=$test")
            atMs
        } catch (e: SecurityException) {
            Log.e(TAG, "exact alarm denied", e)
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, operation); atMs
            } catch (e2: Exception) { Log.e(TAG, "schedule failed", e2); null }
        }
    }

    fun cancel(ctx: Context, alarmId: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        am.cancel(pi(ctx, alarmId, false))
        Log.i(TAG, "cancelled alarm=$alarmId")
    }

    suspend fun rescheduleAll(ctx: Context) {
        val alarms = WakeLockDb.get(ctx).alarms().getEnabled()
        alarms.forEach { schedule(ctx, it) }
        Log.i(TAG, "rescheduled ${alarms.size} alarms")
    }

    suspend fun nextScheduled(ctx: Context): Pair<AlarmEntity, Long>? {
        val alarms = WakeLockDb.get(ctx).alarms().getEnabled()
        val now = System.currentTimeMillis()
        return alarms.map { it to ScheduleMath.nextTrigger(it.hour, it.minute, it.repeatDays, now) }
            .minByOrNull { it.second }
    }
}
