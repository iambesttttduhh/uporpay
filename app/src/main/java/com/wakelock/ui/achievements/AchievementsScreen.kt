package com.wakelock.ui.achievements

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wakelock.data.repo.Achievements
import com.wakelock.ui.HomeState
import com.wakelock.ui.theme.WL

@Composable
fun AchievementsScreen(state: HomeState) {
    val byKey = state.achievements.associateBy { it.key }
    LazyColumn(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("ACHIEVEMENTS", fontWeight = FontWeight.Black, fontSize = 22.sp, letterSpacing = 2.sp) }
        items(Achievements.ALL) { def ->
            val e = byKey[def.key]
            val unlocked = e?.unlockedAt != null
            val progress = e?.progress ?: 0
            ElevatedCard(shape = WL.CardShape, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (unlocked) "🏆" else "🔒", fontSize = 26.sp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(def.title, fontWeight = FontWeight.Bold,
                            color = if (unlocked) WL.Amber else MaterialTheme.colorScheme.onSurface)
                        Text(def.desc, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        LinearProgressIndicator(
                            progress = { (progress.toFloat() / def.target).coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth().padding(top = 6.dp)
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Text("$progress/${def.target}", fontSize = 12.sp)
                }
            }
        }
    }
}
