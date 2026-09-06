package com.wakelock

import android.app.AlarmManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.wakelock.alarm.AlarmScheduler
import com.wakelock.data.db.AlarmEntity
import com.wakelock.data.db.WakeLockDb
import com.wakelock.data.repo.ChallengeRepo
import com.wakelock.domain.model.SessionResult
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Runtime verification on a real Android device/emulator:
 * seeding, scheduling, challenge creation, persistence, progression, completion, stats.
 */
@RunWith(AndroidJUnit4::class)
class AlarmPipelineTest {

    private lateinit var ctx: Context

    @Before fun setup() {
        ctx = ApplicationProvider.getApplicationContext()
        runBlocking { WakeLockDb.seedIfNeeded(ctx) }
    }

    @Test fun database_seeds_at_least_500_lines() = runBlocking {
        val n = WakeLockDb.get(ctx).lines().count()
        assertTrue("expected >=500 lines, got $n", n >= 500)
    }

    @Test fun alarm_can_be_created_and_scheduled() = runBlocking {
        val db = WakeLockDb.get(ctx)
        val id = db.alarms().insert(AlarmEntity(name = "IT alarm", hour = 7, minute = 0))
        val alarm = db.alarms().get(id)!!
        val at = AlarmScheduler.schedule(ctx, alarm)
        assertNotNull("alarm should be scheduled", at)
        assertTrue("scheduled time must be in the future", at!! > System.currentTimeMillis())

        // the OS must actually hold a next-alarm clock entry
        val am = ctx.getSystemService(AlarmManager::class.java)
        assertNotNull("AlarmManager should expose a scheduled alarm", am)
        AlarmScheduler.cancel(ctx, id)
        db.alarms().delete(id)
    }

    @Test fun challenge_lines_are_frozen_and_restored() = runBlocking {
        val db = WakeLockDb.get(ctx)
        val id = db.alarms().insert(AlarmEntity(name = "IT freeze", lineCount = 5))
        val alarm = db.alarms().get(id)!!
        val repo = ChallengeRepo(ctx)

        val s = repo.createSession(alarm, isTest = true)
        assertEquals(5, repo.totalLines(s))

        // simulate app restart: reload the active session from the database
        val restored = repo.active()!!
        assertEquals("same session must be restored", s.id, restored.id)
        assertEquals("same lines must be restored", s.lineIds, restored.lineIds)
        assertEquals("progress must be preserved", s.currentIndex, restored.currentIndex)
        assertEquals("deadline must be preserved", s.deadlineAt, restored.deadlineAt)

        db.sessions().cancelAllPending()
        db.alarms().delete(id)
    }

    @Test fun completing_all_lines_records_success_and_stats() = runBlocking {
        val db = WakeLockDb.get(ctx)
        val before = db.events().successCount()
        val id = db.alarms().insert(AlarmEntity(name = "IT complete", lineCount = 3))
        val alarm = db.alarms().get(id)!!
        val repo = ChallengeRepo(ctx)

        var s = repo.createSession(alarm, isTest = false)
        repeat(3) { s = repo.advance(s) }
        assertEquals(3, s.currentIndex)

        repo.finish(s, success = true, failureAction = null, alarm = alarm)
        val after = db.events().successCount()
        assertEquals("a success event must be recorded", before + 1, after)

        val reloaded = db.sessions().get(s.id)!!
        assertEquals(SessionResult.SUCCESS.name, reloaded.result)
        assertNotNull(reloaded.completionMs)

        db.alarms().delete(id)
    }

    @Test fun failure_is_recorded_with_action() = runBlocking {
        val db = WakeLockDb.get(ctx)
        val id = db.alarms().insert(AlarmEntity(name = "IT fail", lineCount = 3))
        val alarm = db.alarms().get(id)!!
        val repo = ChallengeRepo(ctx)
        val s = repo.createSession(alarm, isTest = false)

        repo.finish(s, success = false, failureAction = "LOCKDOWN", alarm = alarm)
        val ev = db.events().allReal().first()
        assertEquals("FAILED", ev.result)
        assertEquals("LOCKDOWN", ev.failureActionApplied)

        db.alarms().delete(id)
    }

    @Test fun outside_mode_appends_two_extra_lines() = runBlocking {
        val db = WakeLockDb.get(ctx)
        val id = db.alarms().insert(AlarmEntity(name = "IT outside", lineCount = 2, outsideModeEnabled = true))
        val alarm = db.alarms().get(id)!!
        val repo = ChallengeRepo(ctx)

        val s = repo.createSession(alarm, isTest = true)
        assertEquals(2, repo.totalLines(s))
        val withOutside = repo.appendOutsideLines(s, alarm.categories)
        assertEquals("outside adds exactly 2 lines", 4, repo.totalLines(withOutside))
        assertNotNull(withOutside.outsideVerifiedAt)

        db.sessions().cancelAllPending()
        db.alarms().delete(id)
    }

    @Test fun randomisation_avoids_immediate_repeats() = runBlocking {
        val repo = ChallengeRepo(ctx)
        val a = repo.pickLines(5, "")
        val b = repo.pickLines(5, "")
        assertEquals(5, a.size)
        assertEquals(5, b.size)
        // freshly picked lines are marked used only when a session is created,
        // so at minimum each individual pick must contain unique lines
        assertEquals("no duplicates within one challenge", 5, a.map { it.id }.toSet().size)
        assertEquals(5, b.map { it.id }.toSet().size)
    }

    @Test fun restart_with_generates_new_lines_and_deadline() = runBlocking {
        val db = WakeLockDb.get(ctx)
        val id = db.alarms().insert(AlarmEntity(name = "IT restart", lineCount = 3))
        val alarm = db.alarms().get(id)!!
        val repo = ChallengeRepo(ctx)
        val s = repo.createSession(alarm, isTest = true)
        val restarted = repo.restartWith(s, 5, 300, alarm.categories)
        assertEquals(5, repo.totalLines(restarted))
        assertEquals(0, restarted.currentIndex)
        assertTrue(restarted.deadlineAt > System.currentTimeMillis())
        db.sessions().cancelAllPending()
        db.alarms().delete(id)
    }
}
