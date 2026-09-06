package com.wakelock

import android.app.Application
import android.util.Log
import com.wakelock.data.db.WakeLockDb
import com.wakelock.notifications.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class WakeLockApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
        scope.launch {
            try {
                WakeLockDb.seedIfNeeded(this@WakeLockApp)
                com.wakelock.alarm.AlarmScheduler.rescheduleAll(this@WakeLockApp)
            } catch (e: Exception) { Log.e("WL/App", "startup failed", e) }
        }
    }
}
