package com.wakelock.ui.help

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
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
import com.wakelock.ui.theme.WL

@Composable
fun HelpScreen() {
    val ctx = LocalContext.current
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("HELP & RELIABILITY", fontWeight = FontWeight.Black, fontSize = 22.sp, letterSpacing = 2.sp)

        Article("Why didn't my alarm ring?",
            "Android can delay or block alarms from apps it considers inactive. Grant exact alarms, " +
                "disable battery optimisation for WakeLock, and allow notifications.")

        Article("Battery optimisation",
            "Aggressive battery management (especially on Xiaomi, Oppo, Vivo, Huawei and Samsung) can stop " +
                "alarms firing on time. WakeLock cannot change these settings for you — open them below and allow it manually.")

        ActionButton("Open battery optimisation settings") {
            runCatching {
                ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ActionButton("Open exact alarm settings") {
                runCatching {
                    ctx.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
        }
        ActionButton("Open app notification settings") {
            runCatching {
                ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }

        Article("Microphone problems",
            "WakeLock needs microphone access to verify your spoken lines. If recognition keeps failing, " +
                "check that a speech recognition service is installed and that the microphone permission is granted.")

        Article("Speech recognition & offline",
            "WakeLock asks Android for on-device recognition where possible. Some devices still require a " +
                "network connection for speech-to-text — that is a device limitation, not a WakeLock setting.")

        Article("Outside Mode",
            "Outside verification combines movement, ambient light and location change. No single signal is " +
                "treated as proof. Nothing is uploaded and no images are stored.")

        Article("Lockdown Mode — what it really does",
            "NORMAL MODE: WakeLock shows a full-screen alarm over the lock screen, runs a foreground service, " +
                "persists your challenge and returns you to it. Android does not allow an ordinary app to take over " +
                "the whole device, and WakeLock does not pretend otherwise.\n\n" +
                "MAXIMUM LOCKDOWN: real kiosk restriction via Android Lock Task, which only works if this device " +
                "is provisioned as a Device Owner (a factory-reset device set up over ADB). See the README.")

        Article("Emergency & system behaviour",
            "WakeLock never blocks emergency calls, shutdown, recovery or factory reset, and never uses " +
                "exploits or accessibility abuse.")
    }
}

@Composable private fun Article(title: String, body: String) {
    ElevatedCard(shape = WL.CardShape, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(body, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 19.sp)
        }
    }
}

@Composable private fun ActionButton(label: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = WL.ButtonShape) {
        Text(label)
    }
}
