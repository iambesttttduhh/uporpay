package com.wakelock.data.db

import androidx.room.*
import com.wakelock.domain.model.*

@Entity(tableName = "alarms")
data class AlarmEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String = "Wake up",
    val hour: Int = 7,
    val minute: Int = 0,
    /** comma separated ISO day numbers 1..7 (Mon..Sun); empty = one-shot */
    val repeatDays: String = "",
    val enabled: Boolean = true,
    val soundUri: String? = null,
    val vibrationEnabled: Boolean = true,
    val vibrationPattern: String = VibrationPattern.STRONG.name,
    val challengeType: String = ChallengeType.STANDARD.name,
    val lineCount: Int = 5,
    val categories: String = "",           // empty = all
    val timeLimitSec: Long = 600,
    val adaptiveTimeEnabled: Boolean = false,
    val adaptiveMinSec: Long = 180,
    val adaptiveMaxSec: Long = 900,
    val adaptiveDifficultyEnabled: Boolean = false,
    val sensitivity: String = "NORMAL",
    val lockdownEnabled: Boolean = false,
    val lockdownConsentedAt: Long? = null,
    val failureAction: String = FailureAction.KEEP_TRYING.name,
    val lockdownDurationMin: Int = 720,
    val outsideModeEnabled: Boolean = false,
    val snoozeEnabled: Boolean = false,
    val snoozeMinutes: Int = 5,
    val maxSnoozes: Int = 2,
    val createdAt: Long = System.currentTimeMillis(),
    val lastConfirmedAt: Long? = null
)

@Entity(tableName = "lines")
data class LineEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val text: String,
    val category: String,
    val lastUsedAt: Long? = null,
    val useCount: Int = 0
)

@Entity(tableName = "sessions")
data class SessionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val alarmId: Long,
    val lineIds: String,               // comma separated
    val currentIndex: Int = 0,
    val state: String = AlarmState.CHALLENGE_STARTED.name,
    val startedAt: Long = System.currentTimeMillis(),
    val deadlineAt: Long,
    val completedAt: Long? = null,
    val completionMs: Long? = null,
    val attempts: Int = 0,
    val failedAttempts: Int = 0,
    val snoozesUsed: Int = 0,
    val outsideVerifiedAt: Long? = null,
    val result: String = SessionResult.PENDING.name,
    val isTest: Boolean = false,
    val extraLineIds: String = ""      // outside-mode follow-up lines
)

@Entity(tableName = "events")
data class WakeEventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val alarmId: Long,
    val alarmName: String,
    val firedAt: Long,
    val resolvedAt: Long,
    val result: String,
    val challengeType: String,
    val lineCount: Int,
    val completionMs: Long?,
    val snoozes: Int,
    val outsideUsed: Boolean,
    val failureActionApplied: String?,
    val isTest: Boolean = false
)

@Entity(tableName = "achievements")
data class AchievementEntity(
    @PrimaryKey val key: String,
    val unlockedAt: Long? = null,
    val progress: Int = 0,
    val target: Int = 1
)
