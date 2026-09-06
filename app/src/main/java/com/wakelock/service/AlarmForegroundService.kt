package com.wakelock.service

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import com.wakelock.data.db.AlarmEntity
import com.wakelock.data.db.SessionEntity
import com.wakelock.data.db.WakeLockDb
import com.wakelock.data.prefs.LockdownStore
import com.wakelock.data.repo.Achievements
import com.wakelock.data.repo.ChallengeRepo
import com.wakelock.domain.model.AlarmState
import com.wakelock.domain.model.FailureAction
import com.wakelock.notifications.Notifications
import com.wakelock.ui.alarmscreen.AlarmActivity
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Single source of truth for an active alarm.
 *
 * Owns: sound, vibration, the deadline timer, the challenge state machine and
 * completion/failure handling. The UI observes [state] and never drives it directly.
 */
class AlarmForegroundService : Service() {

    companion object {
        private const val TAG = "WL/Service"
        const val ACTION_START = "start"
        const val ACTION_STOP = "stop"
        const val EXTRA_ALARM_ID = "alarm_id"
        const val EXTRA_TEST = "test"

        private val _state = MutableStateFlow(RuntimeState())
        val state: StateFlow<RuntimeState> = _state

        fun start(ctx: Context, alarmId: Long, test: Boolean) {
            val i = Intent(ctx, AlarmForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_ALARM_ID, alarmId)
                putExtra(EXTRA_TEST, test)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
            else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, AlarmForegroundService::class.java).apply { action = ACTION_STOP })
        }
    }

    data class RuntimeState(
        val active: Boolean = false,
        val alarm: AlarmEntity? = null,
        val session: SessionEntity? = null,
        val lines: List<String> = emptyList(),
        val state: AlarmState = AlarmState.IDLE,
        val remainingMs: Long = 0,
        val totalMs: Long = 1,
        val message: String? = null,
        val lastScore: Double? = null,
        val outsidePending: Boolean = false,
        val isTest: Boolean = false,
        val finished: Boolean = false,
        val success: Boolean = false
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var audio: AlarmAudio
    private lateinit var repo: ChallengeRepo
    private var wakeLock: PowerManager.WakeLock? = null
    private var ticker: Job? = null
    private var warned = mutableSetOf<Int>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        audio = AlarmAudio(this)
        repo = ChallengeRepo(this)
        Notifications.ensureChannels(this)
        com.wakelock.ui.alarmscreen.ActiveService.instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { finishAlarm(success = false, cancelled = true); return START_NOT_STICKY }
            ACTION_START -> {
                val id = intent.getLongExtra(EXTRA_ALARM_ID, -1L)
                val test = intent.getBooleanExtra(EXTRA_TEST, false)
                startForeground(Notifications.ID_ALARM, buildNotification("WAKE UP", "Complete your challenge"))
                beginAlarm(id, test)
            }
            else -> {
                // restarted by the system with no intent -> try to restore a pending session
                startForeground(Notifications.ID_ALARM, buildNotification("WAKE UP", "Restoring challenge"))
                scope.launch { restoreOrDie() }
            }
        }
        return START_STICKY
    }

    private fun buildNotification(title: String, text: String) =
        Notifications.alarmNotification(this, title, text, fullScreenIntent())

    private fun fullScreenIntent(): PendingIntent {
        val i = Intent(this, AlarmActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(this, 0, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    @Suppress("DEPRECATION")
    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(PowerManager::class.java)
            wakeLock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "wakelock:alarm"
            ).apply { acquire(60 * 60 * 1000L) }
        } catch (e: Exception) { Log.e(TAG, "wakelock failed", e) }
    }

    private fun beginAlarm(alarmId: Long, test: Boolean) {
        scope.launch {
            try {
                WakeLockDb.seedIfNeeded(applicationContext)
                val alarm = WakeLockDb.get(applicationContext).alarms().get(alarmId) ?: run {
                    Log.e(TAG, "alarm $alarmId missing"); stopSelf(); return@launch
                }
                // reuse an in-flight session for this alarm (process death / re-entry)
                val existing = repo.active()
                val session = if (existing != null && existing.alarmId == alarmId) existing
                else repo.createSession(alarm, test)

                acquireWakeLock()
                audio.start(alarm.soundUri, alarm.vibrationEnabled, alarm.vibrationPattern)
                warned.clear()
                publish(alarm, session, AlarmState.CHALLENGE_STARTED)
                launchUi()
                startTicker()
                Log.i(TAG, "alarm active id=$alarmId session=${session.id} test=$test")
                // reschedule the next occurrence for repeating alarms
                if (!test) com.wakelock.alarm.AlarmScheduler.schedule(applicationContext, alarm)
            } catch (e: Exception) {
                Log.e(TAG, "beginAlarm failed", e); stopSelf()
            }
        }
    }

    private suspend fun restoreOrDie() {
        val s = repo.active()
        if (s == null) { withContext(Dispatchers.Main) { stopSelf() }; return }
        val alarm = WakeLockDb.get(applicationContext).alarms().get(s.alarmId)
        if (alarm == null) { withContext(Dispatchers.Main) { stopSelf() }; return }
        acquireWakeLock()
        audio.start(alarm.soundUri, alarm.vibrationEnabled, alarm.vibrationPattern)
        publish(alarm, s, AlarmState.CHALLENGE_STARTED)
        launchUi()
        startTicker()
    }

    private fun launchUi() {
        try {
            startActivity(Intent(this, AlarmActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            })
        } catch (e: Exception) { Log.e(TAG, "could not launch alarm UI; full-screen intent will handle it", e) }
    }

    private suspend fun publish(alarm: AlarmEntity, session: SessionEntity, st: AlarmState, msg: String? = null) {
        val lines = repo.linesFor(session).map { it.text }
        val total = session.deadlineAt - session.startedAt
        _state.value = _state.value.copy(
            active = true, alarm = alarm, session = session, lines = lines, state = st,
            remainingMs = (session.deadlineAt - System.currentTimeMillis()).coerceAtLeast(0),
            totalMs = total.coerceAtLeast(1), message = msg, isTest = session.isTest,
            finished = false, outsidePending = st == AlarmState.OUTSIDE_PENDING
        )
    }

    /** Deadline-based: never "subtract one per second". */
    private fun startTicker() {
        ticker?.cancel()
        ticker = scope.launch {
            while (isActive) {
                val s = _state.value.session ?: break
                val remaining = (s.deadlineAt - System.currentTimeMillis()).coerceAtLeast(0)
                val total = (s.deadlineAt - s.startedAt).coerceAtLeast(1)
                val pctLeft = ((remaining * 100) / total).toInt()
                _state.value = _state.value.copy(remainingMs = remaining, totalMs = total)

                listOf(50, 25, 10).forEach { mark ->
                    if (pctLeft <= mark && warned.add(mark)) {
                        audio.tick(60)
                        _state.value = _state.value.copy(
                            message = when (mark) {
                                50 -> "You're halfway through your challenge."
                                25 -> "You need to finish your challenge."
                                else -> "FINAL MINUTES"
                            },
                            state = AlarmState.TIME_WARNING
                        )
                    }
                }
                if (remaining <= 0L) { onTimeout(); break }
                delay(500)
            }
        }
    }

    // ---------------- challenge progression ----------------

    fun submitSpeech(spoken: String, accepted: Boolean, score: Double) {
        scope.launch {
            val st = _state.value
            val s = st.session ?: return@launch
            val alarm = st.alarm ?: return@launch
            if (!accepted) {
                val next = repo.recordFailedAttempt(s)
                _state.value = _state.value.copy(
                    session = next, lastScore = score, state = AlarmState.SPEAKING,
                    message = "I couldn't match that. Try speaking clearly and a little louder."
                )
                return@launch
            }
            audio.tick(50)
            val advanced = repo.advance(s)
            val total = repo.totalLines(advanced)
            if (advanced.currentIndex >= total) {
                if (alarm.outsideModeEnabled && advanced.outsideVerifiedAt == null) {
                    val pending = advanced.copy(state = AlarmState.OUTSIDE_PENDING.name)
                    repo.update(pending)
                    publish(alarm, pending, AlarmState.OUTSIDE_PENDING, "Prove you're outside to finish.")
                } else {
                    completeSuccess()
                }
            } else {
                publish(alarm, advanced, AlarmState.LINE_COMPLETED, null)
                _state.value = _state.value.copy(lastScore = score)
            }
        }
    }

    fun onOutsideVerified() {
        scope.launch {
            val st = _state.value
            val s = st.session ?: return@launch
            val alarm = st.alarm ?: return@launch
            val next = repo.appendOutsideLines(s, alarm.categories)
            publish(alarm, next, AlarmState.OUTSIDE_VERIFIED, "Outside verified. Two final lines.")
        }
    }

    private suspend fun completeSuccess() {
        val st = _state.value
        val s = st.session ?: return
        repo.finish(s, success = true, failureAction = null, alarm = st.alarm)
        refreshAchievements()
        ticker?.cancel()
        audio.stop()
        com.wakelock.lockdown.LockdownController(applicationContext).stop()
        _state.value = st.copy(state = AlarmState.CHALLENGE_COMPLETED, finished = true,
            success = true, active = false, message = null)
        Log.i(TAG, "challenge completed session=${s.id}")
        stopSelfSafely()
    }

    private fun onTimeout() {
        scope.launch {
            val st = _state.value
            val s = st.session ?: return@launch
            val alarm = st.alarm ?: return@launch
            val action = runCatching { FailureAction.valueOf(alarm.failureAction) }
                .getOrDefault(FailureAction.KEEP_TRYING)
            Log.i(TAG, "challenge FAILED session=${s.id} action=$action")
            repo.finish(s, success = false, failureAction = action.name, alarm = alarm)
            refreshAchievements()

            when (action) {
                FailureAction.KEEP_TRYING -> {
                    val next = repo.restartWith(s, alarm.lineCount, alarm.timeLimitSec, alarm.categories)
                    warned.clear()
                    publish(alarm, next, AlarmState.FAILED, "Challenge failed. The alarm continues.")
                    startTicker()
                }
                FailureAction.NEW_CHALLENGE -> {
                    val next = repo.restartWith(s, alarm.lineCount, alarm.timeLimitSec, alarm.categories)
                    warned.clear()
                    publish(alarm, next, AlarmState.FAILED, "New challenge generated.")
                    startTicker()
                }
                FailureAction.HARDER_CHALLENGE -> {
                    val harder = (alarm.lineCount + 2).coerceAtMost(10)
                    val next = repo.restartWith(s, harder, alarm.timeLimitSec, alarm.categories)
                    warned.clear()
                    publish(alarm, next, AlarmState.FAILED, "Harder challenge: $harder lines.")
                    startTicker()
                }
                FailureAction.OUTSIDE_MODE -> {
                    val next = s.copy(state = AlarmState.OUTSIDE_PENDING.name,
                        result = com.wakelock.domain.model.SessionResult.PENDING.name,
                        deadlineAt = System.currentTimeMillis() + alarm.timeLimitSec * 1000,
                        startedAt = System.currentTimeMillis())
                    repo.update(next)
                    warned.clear()
                    publish(alarm, next, AlarmState.OUTSIDE_PENDING, "Failed. Prove you're outside.")
                    startTicker()
                }
                FailureAction.LOCKDOWN -> {
                    val mins = alarm.lockdownDurationMin
                    LockdownStore(applicationContext).start(
                        System.currentTimeMillis() + mins * 60_000L, "Challenge failed")
                    com.wakelock.lockdown.LockdownController(applicationContext).start()
                    ticker?.cancel(); audio.stop()
                    _state.value = st.copy(state = AlarmState.LOCKDOWN, finished = true,
                        success = false, active = false,
                        message = "Lockdown active for $mins minutes.")
                    Notifications.show(applicationContext, Notifications.ID_LOCKDOWN,
                        Notifications.lockdownNotification(applicationContext, "$mins minutes remaining"))
                    stopSelfSafely()
                }
            }
        }
    }

    private suspend fun refreshAchievements() {
        try {
            val db = WakeLockDb.get(applicationContext)
            val events = db.events().allReal()
            val existing = db.achievements().getAll()
            Achievements.evaluate(events, existing).forEach { db.achievements().update(it) }
        } catch (e: Exception) { Log.e(TAG, "achievements failed", e) }
    }

    /** Test-mode exit code. Only ends TEST sessions. */
    fun testExit() {
        scope.launch {
            val st = _state.value
            val s = st.session ?: return@launch
            if (!s.isTest) { Log.w(TAG, "exit code rejected: not a test session"); return@launch }
            repo.finish(s, success = false, failureAction = "TEST_EXIT", alarm = st.alarm)
            ticker?.cancel(); audio.stop()
            _state.value = st.copy(active = false, finished = true, success = false,
                state = AlarmState.IDLE, message = "Test challenge exited.")
            stopSelfSafely()
        }
    }

    private fun finishAlarm(success: Boolean, cancelled: Boolean) {
        scope.launch {
            ticker?.cancel(); audio.stop()
            if (cancelled) {
                val s = repo.active()
                if (s != null && s.isTest) repo.finish(s, false, "CANCELLED", null)
            }
            _state.value = RuntimeState()
            stopSelfSafely()
        }
    }

    private fun stopSelfSafely() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
            wakeLock = null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
            else @Suppress("DEPRECATION") stopForeground(true)
            stopSelf()
        } catch (e: Exception) { Log.e(TAG, "stop failed", e) }
    }

    override fun onDestroy() {
        com.wakelock.ui.alarmscreen.ActiveService.instance = null
        ticker?.cancel(); audio.stop()
        try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
        scope.cancel()
        super.onDestroy()
    }
}
