package com.wakelock.ui.home

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wakelock.R
import com.wakelock.data.db.AlarmEntity
import com.wakelock.ui.HomeState
import com.wakelock.ui.theme.WL
import com.wakelock.util.ScheduleMath
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun HomeScreen(
    state: HomeState,
    onAdd: () -> Unit,
    onEdit: (AlarmEntity) -> Unit,
    onToggle: (AlarmEntity, Boolean) -> Unit,
    onDelete: (AlarmEntity) -> Unit,
    onTest: (AlarmEntity) -> Unit
) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Row(Modifier.fillMaxWidth().padding(top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.ic_wakelock_logo), "WakeLock", Modifier.size(34.dp))
                Spacer(Modifier.width(8.dp))
                Text("WAKELOCK", fontWeight = FontWeight.Black, letterSpacing = 3.sp, fontSize = 18.sp)
            }
        }
        item {
            Column {
                Text(SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(now)),
                    fontSize = 52.sp, fontWeight = FontWeight.Black)
                Text(SimpleDateFormat("EEEE, d MMMM", Locale.getDefault()).format(Date(now)),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            ElevatedCard(shape = WL.CardShape, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Text("NEXT ALARM", fontSize = 11.sp, letterSpacing = 2.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    val next = state.nextAlarm
                    if (next == null) {
                        Text("No alarm scheduled", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    } else {
                        val (a, at) = next
                        Text("%02d:%02d".format(a.hour, a.minute), fontSize = 30.sp, fontWeight = FontWeight.Black)
                        val diff = at - now
                        val h = diff / 3_600_000; val m = (diff % 3_600_000) / 60_000
                        Text("${a.name} · in ${h}h ${m}m", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatChip("🔥 ${state.stats.currentStreak}", "DAY STREAK", Modifier.weight(1f))
                StatChip("${state.stats.successRate}%", "SUCCESS", Modifier.weight(1f))
                StatChip(
                    if (state.stats.averageCompletionMs > 0)
                        ScheduleMath.fmtCompletion(state.stats.averageCompletionMs) else "—",
                    "AVG TIME", Modifier.weight(1f)
                )
            }
        }
        item {
            Button(onClick = onAdd, modifier = Modifier.fillMaxWidth().height(56.dp), shape = WL.ButtonShape) {
                Icon(Icons.Filled.Add, null); Spacer(Modifier.width(8.dp))
                Text("ADD ALARM", fontWeight = FontWeight.Black)
            }
        }
        item {
            Text("ALARMS", fontSize = 12.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (state.alarms.isEmpty()) {
            item {
                Text("No alarms yet. Add one to get started.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 12.dp))
            }
        }
        items(state.alarms, key = { it.id }) { a ->
            AlarmCard(a, onEdit, onToggle, onDelete, onTest)
        }
        item { Spacer(Modifier.height(20.dp)) }
    }
}

@Composable
private fun StatChip(value: String, label: String, modifier: Modifier = Modifier) {
    ElevatedCard(shape = WL.CardShape, modifier = modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(value, fontWeight = FontWeight.Black, fontSize = 19.sp, maxLines = 1)
            Text(label, fontSize = 10.sp, letterSpacing = 1.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun AlarmCard(
    a: AlarmEntity,
    onEdit: (AlarmEntity) -> Unit,
    onToggle: (AlarmEntity, Boolean) -> Unit,
    onDelete: (AlarmEntity) -> Unit,
    onTest: (AlarmEntity) -> Unit
) {
    var menu by remember { mutableStateOf(false) }
    ElevatedCard(shape = WL.CardShape, modifier = Modifier.fillMaxWidth(), onClick = { onEdit(a) }) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("%02d:%02d".format(a.hour, a.minute), fontSize = 30.sp, fontWeight = FontWeight.Black)
                Text(a.name, fontWeight = FontWeight.Bold)
                Text(
                    "${ScheduleMath.repeatLabel(a.repeatDays)} · ${a.lineCount} lines · ${a.timeLimitSec / 60} min" +
                        (if (a.lockdownEnabled) " · LOCKDOWN" else ""),
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Switch(checked = a.enabled, onCheckedChange = { onToggle(a, it) })
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More options") }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text("Test alarm now") },
                            onClick = { menu = false; onTest(a) })
                        DropdownMenuItem(text = { Text("Edit") }, onClick = { menu = false; onEdit(a) })
                        DropdownMenuItem(text = { Text("Delete") }, onClick = { menu = false; onDelete(a) })
                    }
                }
            }
        }
    }
}
