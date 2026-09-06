package com.wakelock.ui.stats

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wakelock.ui.HomeState
import com.wakelock.ui.theme.WL
import com.wakelock.util.ScheduleMath
import java.util.*

@Composable
fun StatsScreen(state: HomeState, onAchievements: () -> Unit) {
    val s = state.stats
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("STATISTICS", fontWeight = FontWeight.Black, fontSize = 22.sp, letterSpacing = 2.sp)

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Big("🔥 ${s.currentStreak}", "CURRENT STREAK", Modifier.weight(1f))
            Big("${s.longestStreak}", "LONGEST", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Big("${s.successRate}%", "SUCCESS RATE", Modifier.weight(1f))
            Big(if (s.averageCompletionMs > 0) ScheduleMath.fmtCompletion(s.averageCompletionMs) else "—",
                "AVG COMPLETION", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Big("${s.totalCompleted}", "COMPLETED", Modifier.weight(1f))
            Big("${s.totalFailed}", "FAILED", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Big("${s.snoozes}", "SNOOZES", Modifier.weight(1f))
            Big("${s.outsideCompletions}", "OUTSIDE", Modifier.weight(1f))
        }

        Text("LAST 7 DAYS", fontSize = 11.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        WeeklyChart(state)

        Button(onClick = onAchievements, modifier = Modifier.fillMaxWidth(), shape = WL.ButtonShape) {
            Text("ACHIEVEMENTS", fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.height(20.dp))
    }
}

@Composable private fun Big(v: String, l: String, m: Modifier = Modifier) {
    ElevatedCard(shape = WL.CardShape, modifier = m) {
        Column(Modifier.padding(16.dp)) {
            Text(v, fontWeight = FontWeight.Black, fontSize = 24.sp, maxLines = 1)
            Text(l, fontSize = 10.sp, letterSpacing = 1.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun WeeklyChart(state: HomeState) {
    val cal = Calendar.getInstance()
    val today = cal.timeInMillis / 86_400_000L
    val counts = IntArray(7)
    val fails = IntArray(7)
    state.events.filter { !it.isTest }.forEach { e ->
        val d = (today - e.firedAt / 86_400_000L).toInt()
        if (d in 0..6) { if (e.result == "SUCCESS") counts[6 - d]++ else fails[6 - d]++ }
    }
    val maxV = (counts.zip(fails.toTypedArray()) { a, b -> a + b }.maxOrNull() ?: 1).coerceAtLeast(1)
    ElevatedCard(shape = WL.CardShape, modifier = Modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(140.dp).padding(16.dp)) {
            val bw = size.width / 7f
            for (i in 0..6) {
                val okH = size.height * (counts[i].toFloat() / maxV)
                val failH = size.height * (fails[i].toFloat() / maxV)
                drawRect(WL.Success, Offset(i * bw + bw * 0.2f, size.height - okH),
                    Size(bw * 0.6f, okH))
                drawRect(WL.Red, Offset(i * bw + bw * 0.2f, size.height - okH - failH),
                    Size(bw * 0.6f, failH))
            }
        }
    }
}
