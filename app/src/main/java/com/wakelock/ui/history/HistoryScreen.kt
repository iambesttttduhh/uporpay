package com.wakelock.ui.history

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wakelock.ui.HomeState
import com.wakelock.ui.theme.WL
import com.wakelock.util.ScheduleMath
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun HistoryScreen(state: HomeState) {
    LazyColumn(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text("HISTORY", fontWeight = FontWeight.Black, fontSize = 22.sp, letterSpacing = 2.sp,
                modifier = Modifier.padding(bottom = 6.dp))
        }
        if (state.events.isEmpty()) {
            item { Text("No wake-ups recorded yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        items(state.events, key = { it.id }) { e ->
            ElevatedCard(shape = WL.CardShape, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(SimpleDateFormat("d MMM, h:mm a", Locale.getDefault()).format(Date(e.firedAt)),
                            fontWeight = FontWeight.Bold)
                        Text(
                            "${e.alarmName} · ${e.lineCount} lines" +
                                (e.completionMs?.let { " · ${ScheduleMath.fmtCompletion(it)}" } ?: "") +
                                (if (e.outsideUsed) " · outside" else "") +
                                (if (e.isTest) " · test" else ""),
                            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        e.failureActionApplied?.let {
                            Text("action: $it", fontSize = 11.sp, color = WL.Orange)
                        }
                    }
                    Text(
                        if (e.result == "SUCCESS") "✓" else "✗",
                        color = if (e.result == "SUCCESS") WL.Success else WL.Red,
                        fontWeight = FontWeight.Black, fontSize = 24.sp
                    )
                }
            }
        }
    }
}
