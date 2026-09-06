package com.wakelock.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.wakelock.alarm.AlarmScheduler
import com.wakelock.data.db.*
import com.wakelock.data.prefs.AppSettings
import com.wakelock.data.prefs.SettingsStore
import com.wakelock.data.repo.*
import com.wakelock.domain.adaptive.AdaptiveTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class HomeState(
    val alarms: List<AlarmEntity> = emptyList(),
    val nextAlarm: Pair<AlarmEntity, Long>? = null,
    val stats: Stats = Stats(),
    val settings: AppSettings = AppSettings(),
    val events: List<WakeEventEntity> = emptyList(),
    val achievements: List<AchievementEntity> = emptyList(),
    val adaptiveHint: String? = null
)

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val db = WakeLockDb.get(app)
    private val settingsStore = SettingsStore(app)

    private val _next = MutableStateFlow<Pair<AlarmEntity, Long>?>(null)
    private val _adaptive = MutableStateFlow<String?>(null)

    val state: StateFlow<HomeState> = combine(
        db.alarms().observeAll(),
        db.events().observeRecent(),
        db.achievements().observeAll(),
        settingsStore.flow,
        combine(_next, _adaptive) { n, a -> n to a }
    ) { alarms, events, achievements, settings, (next, adaptive) ->
        HomeState(
            alarms = alarms,
            nextAlarm = next,
            stats = StatsCalculator.compute(events),
            settings = settings,
            events = events,
            achievements = achievements,
            adaptiveHint = adaptive
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), HomeState())

    init { refreshNext() }

    fun refreshNext() = viewModelScope.launch(Dispatchers.IO) {
        _next.value = AlarmScheduler.nextScheduled(getApplication())
    }

    fun saveAlarm(a: AlarmEntity) = viewModelScope.launch(Dispatchers.IO) {
        val id = if (a.id == 0L) db.alarms().insert(a) else { db.alarms().update(a); a.id }
        val saved = db.alarms().get(id)
        if (saved != null) AlarmScheduler.schedule(getApplication(), saved)
        refreshNext()
    }

    fun toggle(a: AlarmEntity, on: Boolean) = viewModelScope.launch(Dispatchers.IO) {
        val u = a.copy(enabled = on)
        db.alarms().update(u)
        if (on) AlarmScheduler.schedule(getApplication(), u) else AlarmScheduler.cancel(getApplication(), a.id)
        refreshNext()
    }

    fun delete(a: AlarmEntity) = viewModelScope.launch(Dispatchers.IO) {
        AlarmScheduler.cancel(getApplication(), a.id)
        db.alarms().delete(a.id)
        refreshNext()
    }

    /** Fires the REAL pipeline (receiver -> service -> challenge), not a fake UI. */
    fun testAlarmNow(a: AlarmEntity, delaySec: Int = 3) = viewModelScope.launch(Dispatchers.IO) {
        val id = if (a.id == 0L) db.alarms().insert(a) else { db.alarms().update(a); a.id }
        AlarmScheduler.scheduleAt(getApplication(), id, System.currentTimeMillis() + delaySec * 1000L, true)
    }

    fun computeAdaptive(a: AlarmEntity) = viewModelScope.launch(Dispatchers.IO) {
        val samples = db.events().recentCompletions(14)
        val rec = AdaptiveTime.recommend(samples, a.timeLimitSec, a.adaptiveMinSec, a.adaptiveMaxSec)
        _adaptive.value = if (rec == null)
            "Not enough data yet (need ${AdaptiveTime.MIN_SAMPLES} completed challenges)."
        else AdaptiveTime.explain(rec, a.timeLimitSec, samples.size)
    }

    fun settings() = settingsStore

    fun setOnboarded() = viewModelScope.launch(Dispatchers.IO) { settingsStore.setOnboarded(true) }
    fun setTheme(v: String) = viewModelScope.launch(Dispatchers.IO) { settingsStore.setTheme(v) }
    fun setSensitivity(v: String) = viewModelScope.launch(Dispatchers.IO) { settingsStore.setSensitivity(v) }
    fun setTestMode(v: Boolean) = viewModelScope.launch(Dispatchers.IO) { settingsStore.setTestMode(v) }

    fun resetStats() = viewModelScope.launch(Dispatchers.IO) {
        db.sessions().cancelAllPending()
    }
}
