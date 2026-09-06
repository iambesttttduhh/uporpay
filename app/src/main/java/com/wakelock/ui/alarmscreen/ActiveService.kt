package com.wakelock.ui.alarmscreen

import com.wakelock.service.AlarmForegroundService

/** Weak handle to the running alarm service so the UI can push user actions into it. */
object ActiveService {
    @Volatile var instance: AlarmForegroundService? = null
}
