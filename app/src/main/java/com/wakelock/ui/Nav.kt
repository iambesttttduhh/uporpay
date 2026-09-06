package com.wakelock.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.navigation.compose.*
import androidx.navigation.NavGraphBuilder
import com.wakelock.data.db.AlarmEntity
import com.wakelock.ui.edit.AlarmEditScreen
import com.wakelock.ui.help.HelpScreen
import com.wakelock.ui.history.HistoryScreen
import com.wakelock.ui.home.HomeScreen
import com.wakelock.ui.onboarding.OnboardingScreen
import com.wakelock.ui.settings.SettingsScreen
import com.wakelock.ui.stats.StatsScreen
import com.wakelock.ui.achievements.AchievementsScreen
import com.wakelock.ui.dev.DiagnosticsScreen

@Composable
fun WakeLockApp(vm: MainViewModel, state: HomeState, requestNotifications: () -> Unit) {
    val nav = rememberNavController()
    var editing by remember { mutableStateOf<AlarmEntity?>(null) }

    if (!state.settings.onboarded) {
        OnboardingScreen(
            onDone = {
                requestNotifications()
                vm.setOnboarded()
                editing = AlarmEntity(
                    lineCount = state.settings.defaultLineCount,
                    timeLimitSec = state.settings.defaultTimeLimitSec
                )
                nav.navigate("edit")
            }
        )
        return
    }

    val tabs = listOf(
        Triple("home", "Home", Icons.Filled.Home),
        Triple("stats", "Stats", Icons.Filled.BarChart),
        Triple("history", "History", Icons.Filled.History),
        Triple("settings", "Settings", Icons.Filled.Settings)
    )
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route

    Scaffold(
        bottomBar = {
            if (route in tabs.map { it.first }) {
                NavigationBar {
                    tabs.forEach { (r, label, icon) ->
                        NavigationBarItem(
                            selected = route == r,
                            onClick = { if (route != r) nav.navigate(r) { popUpTo("home"); launchSingleTop = true } },
                            icon = { Icon(icon, contentDescription = label) },
                            label = { Text(label) }
                        )
                    }
                }
            }
        }
    ) { pad ->
        NavHost(nav, startDestination = "home", modifier = Modifier.padding(pad)) {
            composable("home") {
                HomeScreen(
                    state = state,
                    onAdd = { editing = AlarmEntity(
                        lineCount = state.settings.defaultLineCount,
                        timeLimitSec = state.settings.defaultTimeLimitSec); nav.navigate("edit") },
                    onEdit = { editing = it; nav.navigate("edit") },
                    onToggle = { a, on -> vm.toggle(a, on) },
                    onDelete = { vm.delete(it) },
                    onTest = { vm.testAlarmNow(it) }
                )
            }
            composable("stats") { StatsScreen(state) { nav.navigate("achievements") } }
            composable("history") { HistoryScreen(state) }
            composable("settings") {
                SettingsScreen(
                    vm = vm, state = state,
                    onHelp = { nav.navigate("help") },
                    onDiagnostics = { nav.navigate("diagnostics") }
                )
            }
            composable("help") { HelpScreen() }
            composable("achievements") { AchievementsScreen(state) }
            composable("diagnostics") { DiagnosticsScreen(state, vm) }
            composable("edit") {
                AlarmEditScreen(
                    initial = editing ?: AlarmEntity(),
                    adaptiveHint = state.adaptiveHint,
                    onComputeAdaptive = { vm.computeAdaptive(it) },
                    onSave = { vm.saveAlarm(it); nav.popBackStack("home", false) },
                    onTestNow = { vm.testAlarmNow(it) },
                    onCancel = { nav.popBackStack() }
                )
            }
        }
    }
}
