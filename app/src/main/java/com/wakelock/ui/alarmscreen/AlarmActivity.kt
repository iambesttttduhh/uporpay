package com.wakelock.ui.alarmscreen

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.wakelock.lockdown.LockdownController
import com.wakelock.ui.theme.WakeLockTheme

/**
 * Full-screen alarm. Shows over the lock screen, turns the screen on and
 * refuses ordinary dismissal while a challenge is active.
 */
class AlarmActivity : ComponentActivity() {

    private lateinit var lockdown: LockdownController

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lockdown = LockdownController(this)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true); setTurnScreenOn(true)
        } else {
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) micPermission.launch(Manifest.permission.RECORD_AUDIO)

        setContent {
            WakeLockTheme(themePref = "DARK") {
                AlarmScreen(onFinished = { finishAndRemoveTask() })
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Maximum Lockdown: real kiosk mode, only when genuinely provisioned as Device Owner.
        val st = com.wakelock.service.AlarmForegroundService.state.value
        if (st.active && st.alarm?.lockdownEnabled == true) lockdown.enterLockTask(this)
    }

    override fun onPause() {
        super.onPause()
        val st = com.wakelock.service.AlarmForegroundService.state.value
        if (!st.active) lockdown.exitLockTask(this)
    }

    /** No ordinary escape while the challenge is running. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val st = com.wakelock.service.AlarmForegroundService.state.value
        if (!st.active) { lockdown.exitLockTask(this); @Suppress("DEPRECATION") super.onBackPressed() }
    }

    override fun onDestroy() {
        runCatching { lockdown.exitLockTask(this) }
        super.onDestroy()
    }
}
