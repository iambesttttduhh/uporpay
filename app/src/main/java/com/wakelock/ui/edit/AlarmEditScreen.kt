package com.wakelock.ui.edit

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wakelock.data.db.AlarmEntity
import com.wakelock.domain.model.*
import com.wakelock.ui.theme.WL
import com.wakelock.util.ScheduleMath

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AlarmEditScreen(
    initial: AlarmEntity,
    adaptiveHint: String?,
    onComputeAdaptive: (AlarmEntity) -> Unit,
    onSave: (AlarmEntity) -> Unit,
    onTestNow: (AlarmEntity) -> Unit,
    onCancel: () -> Unit
) {
    var a by remember { mutableStateOf(initial) }
    var advanced by remember { mutableStateOf(false) }
    var showLockdownConsent by remember { mutableStateOf(false) }
    var showConfirm by remember { mutableStateOf(false) }
    var showLongLockdown by remember { mutableStateOf(false) }

    val timePicker = rememberTimePickerState(a.hour, a.minute, true)
    LaunchedEffect(timePicker.hour, timePicker.minute) {
        a = a.copy(hour = timePicker.hour, minute = timePicker.minute)
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text(if (initial.id == 0L) "NEW ALARM" else "EDIT ALARM",
            fontWeight = FontWeight.Black, fontSize = 22.sp, letterSpacing = 2.sp)

        TimeInput(state = timePicker, modifier = Modifier.align(Alignment.CenterHorizontally))

        OutlinedTextField(a.name, { a = a.copy(name = it) },
            label = { Text("Alarm name") }, singleLine = true, modifier = Modifier.fillMaxWidth())

        SectionTitle("REPEAT")
        val presets = listOf("Once" to "", "Daily" to "1,2,3,4,5,6,7",
            "Weekdays" to "1,2,3,4,5", "Weekends" to "6,7")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            presets.forEach { (label, csv) ->
                FilterChip(a.repeatDays == csv, { a = a.copy(repeatDays = csv) }, { Text(label, fontSize = 12.sp) })
            }
        }
        DayToggles(a.repeatDays) { a = a.copy(repeatDays = it) }

        SectionTitle("CHALLENGE")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(ChallengeType.QUICK, ChallengeType.STANDARD, ChallengeType.HARD, ChallengeType.EXTREME)
                .forEach { t ->
                    FilterChip(
                        a.challengeType == t.name,
                        { a = a.copy(challengeType = t.name, lineCount = t.lines) },
                        { Text("${t.label} ${t.lines}", fontSize = 11.sp) })
                }
        }
        Text("Lines: ${a.lineCount}", fontSize = 13.sp)
        Slider(a.lineCount.toFloat(), { a = a.copy(lineCount = it.toInt(), challengeType = ChallengeType.CUSTOM.name) },
            valueRange = 1f..10f, steps = 8)

        SectionTitle("TIME LIMIT")
        Text("${a.timeLimitSec / 60} minutes", fontSize = 13.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(1, 2, 5, 10, 15, 30).forEach { m ->
                FilterChip(a.timeLimitSec == m * 60L, { a = a.copy(timeLimitSec = m * 60L) },
                    { Text("${m}m", fontSize = 11.sp) })
            }
        }
        Slider((a.timeLimitSec / 60).toFloat(), { a = a.copy(timeLimitSec = it.toLong() * 60) },
            valueRange = 1f..60f, steps = 58)

        SwitchRow("Vibration", a.vibrationEnabled) { a = a.copy(vibrationEnabled = it) }

        SwitchRow("Lockdown Mode", a.lockdownEnabled) { on ->
            if (on && a.lockdownConsentedAt == null) showLockdownConsent = true
            else a = a.copy(lockdownEnabled = on, snoozeEnabled = if (on) false else a.snoozeEnabled)
        }

        TextButton(onClick = { advanced = !advanced }) {
            Text(if (advanced) "Hide advanced settings" else "Show advanced settings")
        }

        if (advanced) {
            SectionTitle("ADAPTIVE TIME")
            SwitchRow("Adaptive time", a.adaptiveTimeEnabled) {
                a = a.copy(adaptiveTimeEnabled = it); if (it) onComputeAdaptive(a)
            }
            if (a.adaptiveTimeEnabled) {
                Text("Minimum: ${a.adaptiveMinSec / 60} min", fontSize = 12.sp)
                Slider((a.adaptiveMinSec / 60).toFloat(), { a = a.copy(adaptiveMinSec = it.toLong() * 60) },
                    valueRange = 1f..30f, steps = 28)
                Text("Maximum: ${a.adaptiveMaxSec / 60} min", fontSize = 12.sp)
                Slider((a.adaptiveMaxSec / 60).toFloat(), { a = a.copy(adaptiveMaxSec = it.toLong() * 60) },
                    valueRange = 2f..60f, steps = 57)
                adaptiveHint?.let {
                    Text(it, fontSize = 12.sp, color = WL.Amber, modifier = Modifier.padding(top = 4.dp))
                }
                TextButton(onClick = { onComputeAdaptive(a) }) { Text("Recalculate recommendation") }
            }

            SectionTitle("SPEECH SENSITIVITY")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("LENIENT", "NORMAL", "STRICT").forEach { s ->
                    FilterChip(a.sensitivity == s, { a = a.copy(sensitivity = s) }, { Text(s, fontSize = 11.sp) })
                }
            }

            SectionTitle("IF YOU FAIL")
            Column {
                FailureAction.entries.forEach { f ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(a.failureAction == f.name, { a = a.copy(failureAction = f.name) })
                        Text(f.label, fontSize = 14.sp)
                    }
                }
            }
            if (a.failureAction == FailureAction.LOCKDOWN.name) {
                Text("Lockdown duration: ${a.lockdownDurationMin / 60} hours", fontSize = 13.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(1, 2, 4, 6, 8, 12).forEach { h ->
                        FilterChip(a.lockdownDurationMin == h * 60,
                            {
                                if (h >= 8) showLongLockdown = true
                                a = a.copy(lockdownDurationMin = h * 60)
                            }, { Text("${h}h", fontSize = 11.sp) })
                    }
                }
            }

            SwitchRow("Outside Mode", a.outsideModeEnabled) { a = a.copy(outsideModeEnabled = it) }
            SwitchRow("Snooze", a.snoozeEnabled) { a = a.copy(snoozeEnabled = it) }
            if (a.snoozeEnabled) {
                Text("Snooze: ${a.snoozeMinutes} min, max ${a.maxSnoozes}", fontSize = 12.sp)
                Slider(a.snoozeMinutes.toFloat(), { a = a.copy(snoozeMinutes = it.toInt()) },
                    valueRange = 1f..30f, steps = 28)
            }
        }

        Spacer(Modifier.height(6.dp))
        Button(onClick = { showConfirm = true }, modifier = Modifier.fillMaxWidth().height(54.dp),
            shape = WL.ButtonShape) {
            Text("SAVE ALARM", fontWeight = FontWeight.Black)
        }
        OutlinedButton(onClick = { onTestNow(a) }, modifier = Modifier.fillMaxWidth(), shape = WL.ButtonShape) {
            Text("TEST THIS ALARM NOW")
        }
        TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
        Spacer(Modifier.height(30.dp))
    }

    if (showLockdownConsent) {
        AlertDialog(
            onDismissRequest = { showLockdownConsent = false },
            title = { Text("ENABLE LOCKDOWN MODE?") },
            text = {
                Text(
                    "When your alarm rings, WakeLock will restrict normal access to the alarm experience " +
                        "until you complete your challenge.\n\n" +
                        "The exact level of device restriction depends on your Android device and configuration. " +
                        "Full kiosk restriction requires this device to be provisioned as a Device Owner.\n\n" +
                        "Emergency and operating-system functions remain available.",
                    fontSize = 14.sp
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    a = a.copy(lockdownEnabled = true, snoozeEnabled = false,
                        lockdownConsentedAt = System.currentTimeMillis())
                    showLockdownConsent = false
                }) { Text("I UNDERSTAND — ENABLE") }
            },
            dismissButton = { TextButton({ showLockdownConsent = false }) { Text("CANCEL") } }
        )
    }

    if (showLongLockdown) {
        AlertDialog(
            onDismissRequest = { showLongLockdown = false },
            title = { Text("Long lockdown selected") },
            text = { Text("You are choosing to restrict normal access for this period if you fail your challenge. " +
                "Make sure you understand how this behaves on your device.") },
            confirmButton = { TextButton({ showLongLockdown = false }) { Text("I UNDERSTAND") } }
        )
    }

    if (showConfirm) {
        AlertDialog(
            onDismissRequest = { showConfirm = false },
            title = { Text("YOUR MORNING PLAN") },
            text = {
                Column {
                    Line("Time", "%02d:%02d".format(a.hour, a.minute))
                    Line("Repeat", ScheduleMath.repeatLabel(a.repeatDays))
                    Line("Challenge", "${a.lineCount} spoken lines")
                    Line("Time limit", "${a.timeLimitSec / 60} minutes")
                    Line("Adaptive time", if (a.adaptiveTimeEnabled) "ON" else "OFF")
                    Line("Lockdown", if (a.lockdownEnabled) "ON" else "OFF")
                    Line("If failed", FailureAction.valueOf(a.failureAction).label)
                    Line("Outside mode", if (a.outsideModeEnabled) "ON" else "OFF")
                    Line("Snooze", if (a.snoozeEnabled) "ON" else "OFF")
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showConfirm = false
                    onSave(a.copy(lastConfirmedAt = System.currentTimeMillis()))
                }) { Text("CONFIRM ALARM") }
            },
            dismissButton = { TextButton({ showConfirm = false }) { Text("BACK") } }
        )
    }
}

@Composable private fun Line(k: String, v: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), Arrangement.SpaceBetween) {
        Text(k, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(v, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable private fun SectionTitle(t: String) {
    Text(t, fontSize = 11.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
}

@Composable private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
        Text(label, fontSize = 15.sp)
        Switch(checked, onChange)
    }
}

@Composable private fun DayToggles(csv: String, onChange: (String) -> Unit) {
    val days = ScheduleMath.parseDays(csv).toMutableSet()
    val names = listOf("M", "T", "W", "T", "F", "S", "S")
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        names.forEachIndexed { i, n ->
            val d = i + 1
            FilterChip(days.contains(d), {
                if (days.contains(d)) days.remove(d) else days.add(d)
                onChange(ScheduleMath.daysToCsv(days))
            }, { Text(n, fontSize = 11.sp) })
        }
    }
}
