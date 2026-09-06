package com.wakelock.notifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.wakelock.R

object Notifications {
    const val CH_ALARM = "alarm"
    const val CH_ACTIVE = "challenge_active"
    const val CH_UPCOMING = "upcoming"
    const val CH_LOCKDOWN = "lockdown"
    const val ID_ALARM = 1001
    const val ID_LOCKDOWN = 1003

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_ALARM, "Alarm", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "The full-screen wake-up alarm"
                setSound(null, null)   // audio is owned by the service
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            })
        nm.createNotificationChannel(
            NotificationChannel(CH_ACTIVE, "Challenge in progress", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(
            NotificationChannel(CH_UPCOMING, "Upcoming alarms", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(
            NotificationChannel(CH_LOCKDOWN, "Lockdown status", NotificationManager.IMPORTANCE_LOW))
    }

    fun alarmNotification(ctx: Context, title: String, text: String, fullScreen: PendingIntent): Notification =
        Notification.Builder(ctx, CH_ALARM)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .build()

    fun lockdownNotification(ctx: Context, text: String): Notification =
        Notification.Builder(ctx, CH_LOCKDOWN)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("WakeLock lockdown active")
            .setContentText(text)
            .setOngoing(true)
            .build()

    fun show(ctx: Context, id: Int, n: Notification) =
        ctx.getSystemService(NotificationManager::class.java).notify(id, n)

    fun cancel(ctx: Context, id: Int) =
        ctx.getSystemService(NotificationManager::class.java).cancel(id)
}
