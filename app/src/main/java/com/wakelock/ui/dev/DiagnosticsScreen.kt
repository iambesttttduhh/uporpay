package com.wakelock.ui.dev

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.speech.SpeechRecognizer
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wakelock.alarm.AlarmScheduler
import com.wakelock.lockdown.LockdownController
import com.wakelock.service.AlarmForegroundService
import com.wakelock.ui.HomeState
import com.wakelock.ui.theme.WL
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun DiagnosticsScreen(state: HomeState) {
    val ctx = LocalContext.current
    val ld = remember { LockdownController(ctx) }
    val rt by AlarmForegroundService.state.collectAsState()

    val nm = ctx.getSystemService(android.app.NotificationManager::class.java)
    val pm = ctx.getSystemService(PowerManager::class.java)

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text("DIAGNOSTICS", fontWeight = FontWeight.Black, fontSize = 22.sp, letterSpacing = 2.sp)

        val next = state.nextAlarm
        Row2("Next alarm", next?.let {
            SimpleDateFormat("d MMM h:mm a", Locale.getDefault()).format(Date(it.second))
        } ?: "none")
        Row2("Next alarm id", next?.first?.id?.toString() ?: "—")
        Row2("Alarm state", rt.state.name)
        Row2("Session id", rt.session?.id?.toString() ?: "—")
        Row2("Session deadline", rt.session?.let {
            SimpleDateFormat("h:mm:ss a", Locale.getDefault()).format(Date(it.deadlineAt))
        } ?: "—")
        Row2("Remaining", "${rt.remainingMs / 1000}s")
        Row2("Speech recogniser", if (SpeechRecognizer.isRecognitionAvailable(ctx)) "available" else "UNAVAILABLE")
        Row2("Notifications enabled", nm.areNotificationsEnabled().toString())
        Row2("Exact alarms", AlarmScheduler.canScheduleExact(ctx).toString())
        Row2("Battery optimised", (!pm.isIgnoringBatteryOptimizations(ctx.packageName)).toString())
        Row2("Device owner", ld.isDeviceOwner().toString())
        Row2("Lock task permitted", ld.lockTaskPermitted().toString())
        Row2("Lockdown mode", ld.mode())
        Row2("Android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        Row2("Device", "${Build.MANUFACTURER} ${Build.MODEL}")
        Row2("Events recorded", state.events.size.toString())
        Spacer(Modifier.height(30.dp))
    }
}

@Composable private fun Row2(k: String, v: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), Arrangement.SpaceBetween) {
        Text(k, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(v, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = WL.Amber)
    }
}
