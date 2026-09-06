package com.wakelock.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wakelock.BuildConfig
import com.wakelock.lockdown.LockdownController
import com.wakelock.ui.HomeState
import com.wakelock.ui.MainViewModel
import com.wakelock.ui.theme.WL

@Composable
fun SettingsScreen(vm: MainViewModel, state: HomeState, onHelp: () -> Unit, onDiagnostics: () -> Unit) {
    val ctx = LocalContext.current
    var query by remember { mutableStateOf("") }
    val ld = remember { LockdownController(ctx) }

    fun show(vararg keys: String) = query.isBlank() || keys.any { it.contains(query, true) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("SETTINGS", fontWeight = FontWeight.Black, fontSize = 22.sp, letterSpacing = 2.sp)
        OutlinedTextField(query, { query = it }, label = { Text("Search settings") },
            singleLine = true, modifier = Modifier.fillMaxWidth())

        if (show("theme", "appearance", "dark", "light")) {
            Section("APPEARANCE")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("SYSTEM", "LIGHT", "DARK").forEach { t ->
                    FilterChip(state.settings.theme == t, { vm.setTheme(t) }, { Text(t, fontSize = 11.sp) })
                }
            }
        }

        if (show("speech", "sensitivity", "challenge", "microphone")) {
            Section("SPEECH SENSITIVITY")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("LENIENT", "NORMAL", "STRICT").forEach { s ->
                    FilterChip(state.settings.sensitivity == s, { vm.setSensitivity(s) },
                        { Text(s, fontSize = 11.sp) })
                }
            }
            Text("Controls how closely your speech must match the required line.",
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        if (show("lockdown", "device owner", "kiosk", "maximum")) {
            Section("LOCKDOWN")
            InfoCard("Current mode", ld.mode())
            Text(
                if (ld.isDeviceOwner())
                    "This device is provisioned as Device Owner. Maximum Lockdown (Android Lock Task) is available."
                else
                    "This is a normal Android device. WakeLock uses the strongest standard restrictions available: " +
                        "full-screen alarm, foreground service, persisted challenge and re-entry. " +
                        "Full kiosk restriction requires Device Owner provisioning (see README).",
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        if (show("testing", "test mode", "exit code", "developer", "0000")) {
            Section("TESTING")
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Text("Test mode")
                Switch(state.settings.testModeEnabled, { vm.setTestMode(it) })
            }
            Text("Exit code ${state.settings.exitCode} ends a TEST challenge only. " +
                "This is a testing convenience, not a security feature, and it is excluded from release builds.",
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (BuildConfig.TEST_TOOLS) {
                OutlinedButton(onClick = onDiagnostics, modifier = Modifier.fillMaxWidth(),
                    shape = WL.ButtonShape) { Text("DEVELOPER DIAGNOSTICS") }
            }
        }

        if (show("help", "battery", "reliability", "permissions")) {
            Section("HELP")
            OutlinedButton(onClick = onHelp, modifier = Modifier.fillMaxWidth(), shape = WL.ButtonShape) {
                Text("HELP & RELIABILITY")
            }
        }

        Section("ABOUT")
        InfoCard("WAKELOCK BETA", "Version ${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE})")
        Text("Beta testing build. Not a production release.",
            fontSize = 12.sp, color = WL.Orange)
        Text("Privacy: WakeLock never stores raw voice recordings, never uploads challenge history, " +
            "performs no facial recognition and only reads location while you run an Outside verification.",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(30.dp))
    }
}

@Composable private fun Section(t: String) {
    Text(t, fontSize = 11.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
}

@Composable private fun InfoCard(title: String, body: String) {
    ElevatedCard(shape = WL.CardShape, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text(body, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
