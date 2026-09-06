package com.wakelock.data.repo

import android.content.Context
import com.wakelock.data.db.*
import com.wakelock.domain.model.*

/**
 * Owns challenge creation and progression. Lines are chosen ONCE per session and
 * frozen; restarting the app restores the same lines, index and deadline.
 */
class ChallengeRepo(private val ctx: Context) {

    private val db get() = WakeLockDb.get(ctx)
    companion object { const val COOLDOWN_DAYS = 14 }

    private fun ids(csv: String) = csv.split(",").mapNotNull { it.trim().toLongOrNull() }

    suspend fun pickLines(count: Int, categories: String): List<LineEntity> {
        val cats = categories.split(",").map { it.trim() }.filter { it.isNotBlank() }
        val noFilter = if (cats.isEmpty()) 1 else 0
        val cutoff = System.currentTimeMillis() - COOLDOWN_DAYS * 86_400_000L
        val fresh = db.lines().pickFresh(cats, noFilter, cutoff, count)
        if (fresh.size >= count) return fresh
        // pool exhausted -> fall back to least-recently-used, no duplicates
        val extra = db.lines().pickLeastRecent(cats, noFilter, count * 3)
            .filter { e -> fresh.none { it.id == e.id } }
            .take(count - fresh.size)
        return fresh + extra
    }

    suspend fun createSession(alarm: AlarmEntity, isTest: Boolean, limitSecOverride: Long? = null): SessionEntity {
        db.sessions().cancelAllPending()
        val lines = pickLines(alarm.lineCount.coerceIn(1, 10), alarm.categories)
        val now = System.currentTimeMillis()
        val limit = limitSecOverride ?: alarm.timeLimitSec
        val s = SessionEntity(
            alarmId = alarm.id,
            lineIds = lines.joinToString(",") { it.id.toString() },
            deadlineAt = now + limit * 1000,
            startedAt = now,
            isTest = isTest
        )
        db.lines().markUsed(lines.map { it.id }, now)
        val id = db.sessions().insert(s)
        return s.copy(id = id)
    }

    suspend fun active(): SessionEntity? = db.sessions().activeSession()

    suspend fun linesFor(s: SessionEntity): List<LineEntity> {
        val all = ids(s.lineIds) + ids(s.extraLineIds)
        val map = db.lines().byIds(all).associateBy { it.id }
        return all.mapNotNull { map[it] }
    }

    suspend fun totalLines(s: SessionEntity): Int = ids(s.lineIds).size + ids(s.extraLineIds).size

    suspend fun advance(s: SessionEntity): SessionEntity {
        val next = s.copy(currentIndex = s.currentIndex + 1, attempts = s.attempts + 1,
            state = AlarmState.LINE_COMPLETED.name)
        db.sessions().update(next)
        return next
    }

    suspend fun recordFailedAttempt(s: SessionEntity): SessionEntity {
        val next = s.copy(failedAttempts = s.failedAttempts + 1, attempts = s.attempts + 1)
        db.sessions().update(next)
        return next
    }

    suspend fun update(s: SessionEntity) = db.sessions().update(s)

    /** Appends the two Outside-mode follow-up lines to an existing session. */
    suspend fun appendOutsideLines(s: SessionEntity, categories: String): SessionEntity {
        val extra = pickLines(2, categories)
        db.lines().markUsed(extra.map { it.id }, System.currentTimeMillis())
        val next = s.copy(
            extraLineIds = extra.joinToString(",") { it.id.toString() },
            outsideVerifiedAt = System.currentTimeMillis(),
            state = AlarmState.OUTSIDE_VERIFIED.name
        )
        db.sessions().update(next)
        return next
    }

    /** Regenerates lines for NEW_CHALLENGE / HARDER_CHALLENGE failure actions. */
    suspend fun restartWith(s: SessionEntity, lineCount: Int, limitSec: Long, categories: String): SessionEntity {
        val lines = pickLines(lineCount.coerceIn(1, 10), categories)
        val now = System.currentTimeMillis()
        db.lines().markUsed(lines.map { it.id }, now)
        val next = s.copy(
            lineIds = lines.joinToString(",") { it.id.toString() },
            extraLineIds = "",
            currentIndex = 0,
            startedAt = now,
            deadlineAt = now + limitSec * 1000,
            state = AlarmState.CHALLENGE_STARTED.name,
            result = SessionResult.PENDING.name
        )
        db.sessions().update(next)
        return next
    }

    suspend fun finish(s: SessionEntity, success: Boolean, failureAction: String?, alarm: AlarmEntity?) {
        val now = System.currentTimeMillis()
        val done = s.copy(
            completedAt = now,
            completionMs = now - s.startedAt,
            result = if (success) SessionResult.SUCCESS.name else SessionResult.FAILED.name,
            state = if (success) AlarmState.COMPLETED.name else AlarmState.FAILED.name
        )
        db.sessions().update(done)
        db.events().insert(
            WakeEventEntity(
                alarmId = s.alarmId,
                alarmName = alarm?.name ?: "Alarm",
                firedAt = s.startedAt,
                resolvedAt = now,
                result = if (success) "SUCCESS" else "FAILED",
                challengeType = alarm?.challengeType ?: ChallengeType.STANDARD.name,
                lineCount = totalLines(s),
                completionMs = if (success) now - s.startedAt else null,
                snoozes = s.snoozesUsed,
                outsideUsed = s.outsideVerifiedAt != null,
                failureActionApplied = failureAction,
                isTest = s.isTest
            )
        )
    }
}
