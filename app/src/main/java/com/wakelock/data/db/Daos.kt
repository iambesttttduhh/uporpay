package com.wakelock.data.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface AlarmDao {
    @Query("SELECT * FROM alarms ORDER BY hour, minute")
    fun observeAll(): Flow<List<AlarmEntity>>

    @Query("SELECT * FROM alarms ORDER BY hour, minute")
    suspend fun getAll(): List<AlarmEntity>

    @Query("SELECT * FROM alarms WHERE enabled = 1")
    suspend fun getEnabled(): List<AlarmEntity>

    @Query("SELECT * FROM alarms WHERE id = :id")
    suspend fun get(id: Long): AlarmEntity?

    @Insert suspend fun insert(a: AlarmEntity): Long
    @Update suspend fun update(a: AlarmEntity)
    @Query("DELETE FROM alarms WHERE id = :id") suspend fun delete(id: Long)
}

@Dao
interface LineDao {
    @Query("SELECT COUNT(*) FROM `lines`") suspend fun count(): Int
    @Insert suspend fun insertAll(items: List<LineEntity>)

    @Query("SELECT * FROM `lines` WHERE (:noFilter = 1 OR category IN (:cats)) AND (lastUsedAt IS NULL OR lastUsedAt < :cutoff) ORDER BY RANDOM() LIMIT :n")
    suspend fun pickFresh(cats: List<String>, noFilter: Int, cutoff: Long, n: Int): List<LineEntity>

    @Query("SELECT * FROM `lines` WHERE (:noFilter = 1 OR category IN (:cats)) ORDER BY (lastUsedAt IS NULL) DESC, lastUsedAt ASC LIMIT :n")
    suspend fun pickLeastRecent(cats: List<String>, noFilter: Int, n: Int): List<LineEntity>

    @Query("SELECT * FROM `lines` WHERE id IN (:ids)")
    suspend fun byIds(ids: List<Long>): List<LineEntity>

    @Query("UPDATE `lines` SET lastUsedAt = :now, useCount = useCount + 1 WHERE id IN (:ids)")
    suspend fun markUsed(ids: List<Long>, now: Long)
}

@Dao
interface SessionDao {
    @Insert suspend fun insert(s: SessionEntity): Long
    @Update suspend fun update(s: SessionEntity)
    @Query("SELECT * FROM sessions WHERE id = :id") suspend fun get(id: Long): SessionEntity?
    @Query("SELECT * FROM sessions WHERE result = 'PENDING' ORDER BY id DESC LIMIT 1")
    suspend fun activeSession(): SessionEntity?
    @Query("SELECT * FROM sessions WHERE result = 'PENDING' ORDER BY id DESC LIMIT 1")
    fun observeActive(): Flow<SessionEntity?>
    @Query("UPDATE sessions SET result = 'CANCELLED' WHERE result = 'PENDING'")
    suspend fun cancelAllPending()
}

@Dao
interface EventDao {
    @Insert suspend fun insert(e: WakeEventEntity): Long

    @Query("SELECT * FROM events ORDER BY firedAt DESC LIMIT :n")
    fun observeRecent(n: Int = 200): Flow<List<WakeEventEntity>>

    @Query("SELECT * FROM events WHERE isTest = 0 ORDER BY firedAt DESC")
    suspend fun allReal(): List<WakeEventEntity>

    @Query("SELECT completionMs FROM events WHERE result = 'SUCCESS' AND completionMs IS NOT NULL ORDER BY firedAt DESC LIMIT :n")
    suspend fun recentCompletions(n: Int = 14): List<Long>

    @Query("SELECT COUNT(*) FROM events WHERE result = 'SUCCESS'") suspend fun successCount(): Int
    @Query("SELECT COUNT(*) FROM events WHERE result = 'FAILED'") suspend fun failCount(): Int
}

@Dao
interface AchievementDao {
    @Query("SELECT * FROM achievements") fun observeAll(): Flow<List<AchievementEntity>>
    @Query("SELECT * FROM achievements") suspend fun getAll(): List<AchievementEntity>
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertAll(items: List<AchievementEntity>)
    @Update suspend fun update(a: AchievementEntity)
}
