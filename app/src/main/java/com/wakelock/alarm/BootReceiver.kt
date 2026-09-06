package com.wakelock.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Restores scheduled alarms after reboot, app update, time or timezone change. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i("WL/Boot", "received ${intent.action}")
        val pending = goAsync()
        val app = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                com.wakelock.data.db.WakeLockDb.seedIfNeeded(app)
                AlarmScheduler.rescheduleAll(app)
            } catch (e: Exception) {
                Log.e("WL/Boot", "reschedule failed", e)
            } finally {
                pending.finish()
            }
        }
    }
}
