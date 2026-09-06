package com.wakelock.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.wakelock.service.AlarmForegroundService

/** Entry point for a fired alarm. Hands straight over to the foreground service. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getLongExtra(AlarmScheduler.EXTRA_ALARM_ID, -1L)
        val test = intent.getBooleanExtra(AlarmScheduler.EXTRA_TEST, false)
        Log.i("WL/Receiver", "alarm fired id=$id test=$test")
        if (id <= 0) return
        AlarmForegroundService.start(context, id, test)
    }
}
