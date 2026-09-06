package com.wakelock.lockdown

import android.app.Activity
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.util.Log

class WakeLockDeviceAdminReceiver : DeviceAdminReceiver()

/**
 * Lockdown using ONLY legitimate public Android APIs.
 *
 * NORMAL  : full-screen alarm + foreground service + persisted state + re-entry.
 *           Android does not let an ordinary app own the whole device, and we do not pretend it does.
 * MAXIMUM : real DevicePolicyManager Lock Task (kiosk), available only when this app is
 *           genuinely provisioned as Device Owner. Never provisioned silently.
 */
class LockdownController(private val ctx: Context) {

    private val dpm: DevicePolicyManager? =
        try { ctx.getSystemService(DevicePolicyManager::class.java) } catch (_: Exception) { null }

    private val admin = ComponentName(ctx, WakeLockDeviceAdminReceiver::class.java)

    fun isDeviceOwner(): Boolean = try {
        dpm?.isDeviceOwnerApp(ctx.packageName) == true
    } catch (_: Exception) { false }

    fun lockTaskPermitted(): Boolean = try {
        dpm?.isLockTaskPermitted(ctx.packageName) == true
    } catch (_: Exception) { false }

    fun mode(): String = if (isDeviceOwner()) "MAXIMUM (Device Owner)" else "NORMAL (standard Android)"

    /** Whitelists this app for lock task; only possible as Device Owner. */
    fun start() {
        if (!isDeviceOwner()) { Log.i("WL/Lockdown", "normal mode: no device owner"); return }
        try {
            dpm?.setLockTaskPackages(admin, arrayOf(ctx.packageName))
            Log.i("WL/Lockdown", "lock task packages set")
        } catch (e: Exception) { Log.e("WL/Lockdown", "setLockTaskPackages failed", e) }
    }

    fun stop() { /* lock task is released by the activity; nothing device-wide to undo */ }

    /** Called by the alarm activity. Falls back silently to normal mode when not permitted. */
    fun enterLockTask(activity: Activity) {
        try {
            if (isDeviceOwner() || lockTaskPermitted()) {
                activity.startLockTask()
                Log.i("WL/Lockdown", "entered lock task")
            }
        } catch (e: Exception) { Log.e("WL/Lockdown", "startLockTask failed", e) }
    }

    fun exitLockTask(activity: Activity) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val am = activity.getSystemService(android.app.ActivityManager::class.java)
                if (am.lockTaskModeState != android.app.ActivityManager.LOCK_TASK_MODE_NONE) {
                    activity.stopLockTask()
                }
            }
        } catch (e: Exception) { Log.e("WL/Lockdown", "stopLockTask failed", e) }
    }
}
