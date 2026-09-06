package com.wakelock.data.prefs

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.ds by preferencesDataStore("wakelock_settings")

data class AppSettings(
    val onboarded: Boolean = false,
    val theme: String = "SYSTEM",           // SYSTEM | LIGHT | DARK
    val haptics: Boolean = true,
    val testModeEnabled: Boolean = true,
    val exitCode: String = "0000",
    val exitCodeEnabled: Boolean = true,
    val sensitivity: String = "NORMAL",
    val defaultLineCount: Int = 5,
    val defaultTimeLimitSec: Long = 600,
    val lockdownTestSeconds: Int = 60,
    val adaptiveApplyAuto: Boolean = false
)

class SettingsStore(private val ctx: Context) {
    private object K {
        val onboarded = booleanPreferencesKey("onboarded")
        val theme = stringPreferencesKey("theme")
        val haptics = booleanPreferencesKey("haptics")
        val testMode = booleanPreferencesKey("test_mode")
        val exitCode = stringPreferencesKey("exit_code")
        val exitCodeEnabled = booleanPreferencesKey("exit_code_enabled")
        val sensitivity = stringPreferencesKey("sensitivity")
        val lineCount = intPreferencesKey("line_count")
        val timeLimit = longPreferencesKey("time_limit")
        val lockdownTest = intPreferencesKey("lockdown_test")
        val adaptiveAuto = booleanPreferencesKey("adaptive_auto")
    }

    val flow: Flow<AppSettings> = ctx.ds.data.map { p ->
        AppSettings(
            onboarded = p[K.onboarded] ?: false,
            theme = p[K.theme] ?: "SYSTEM",
            haptics = p[K.haptics] ?: true,
            testModeEnabled = p[K.testMode] ?: true,
            exitCode = p[K.exitCode] ?: "0000",
            exitCodeEnabled = p[K.exitCodeEnabled] ?: true,
            sensitivity = p[K.sensitivity] ?: "NORMAL",
            defaultLineCount = p[K.lineCount] ?: 5,
            defaultTimeLimitSec = p[K.timeLimit] ?: 600,
            lockdownTestSeconds = p[K.lockdownTest] ?: 60,
            adaptiveApplyAuto = p[K.adaptiveAuto] ?: false
        )
    }

    suspend fun setOnboarded(v: Boolean) { ctx.ds.edit { it[K.onboarded] = v } }
    suspend fun setTheme(v: String) { ctx.ds.edit { it[K.theme] = v } }
    suspend fun setHaptics(v: Boolean) { ctx.ds.edit { it[K.haptics] = v } }
    suspend fun setTestMode(v: Boolean) { ctx.ds.edit { it[K.testMode] = v } }
    suspend fun setExitCode(v: String) { ctx.ds.edit { it[K.exitCode] = v } }
    suspend fun setExitCodeEnabled(v: Boolean) { ctx.ds.edit { it[K.exitCodeEnabled] = v } }
    suspend fun setSensitivity(v: String) { ctx.ds.edit { it[K.sensitivity] = v } }
    suspend fun setLineCount(v: Int) { ctx.ds.edit { it[K.lineCount] = v } }
    suspend fun setTimeLimit(v: Long) { ctx.ds.edit { it[K.timeLimit] = v } }
    suspend fun setLockdownTest(v: Int) { ctx.ds.edit { it[K.lockdownTest] = v } }
    suspend fun setAdaptiveAuto(v: Boolean) { ctx.ds.edit { it[K.adaptiveAuto] = v } }
}

/** Lockdown state must survive process death and reboot -> stored separately. */
class LockdownStore(private val ctx: Context) {
    private object K {
        val active = booleanPreferencesKey("ld_active")
        val endsAt = longPreferencesKey("ld_ends_at")
        val reason = stringPreferencesKey("ld_reason")
    }
    val flow: Flow<Triple<Boolean, Long, String>> = ctx.ds.data.map {
        Triple(it[K.active] ?: false, it[K.endsAt] ?: 0L, it[K.reason] ?: "")
    }
    suspend fun start(endsAt: Long, reason: String) {
        ctx.ds.edit { it[K.active] = true; it[K.endsAt] = endsAt; it[K.reason] = reason }
    }
    suspend fun clear() { ctx.ds.edit { it[K.active] = false; it[K.endsAt] = 0L } }
}
