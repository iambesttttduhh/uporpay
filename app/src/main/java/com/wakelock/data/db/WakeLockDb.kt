package com.wakelock.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import org.json.JSONArray

@Database(
    entities = [AlarmEntity::class, LineEntity::class, SessionEntity::class,
        WakeEventEntity::class, AchievementEntity::class],
    version = 1,
    exportSchema = false
)
abstract class WakeLockDb : RoomDatabase() {
    abstract fun alarms(): AlarmDao
    abstract fun lines(): LineDao
    abstract fun sessions(): SessionDao
    abstract fun events(): EventDao
    abstract fun achievements(): AchievementDao

    companion object {
        @Volatile private var INSTANCE: WakeLockDb? = null

        fun get(ctx: Context): WakeLockDb = INSTANCE ?: synchronized(this) {
            INSTANCE ?: Room.databaseBuilder(
                ctx.applicationContext, WakeLockDb::class.java, "wakelock.db"
            ).fallbackToDestructiveMigration().build().also { INSTANCE = it }
        }

        /** Seeds the 555-line challenge database from bundled assets on first run. */
        suspend fun seedIfNeeded(ctx: Context) {
            val db = get(ctx)
            if (db.lines().count() == 0) {
                val json = ctx.assets.open("challenge_lines.json").bufferedReader().use { it.readText() }
                val arr = JSONArray(json)
                val items = ArrayList<LineEntity>(arr.length())
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    items.add(LineEntity(text = o.getString("text"), category = o.getString("category")))
                }
                db.lines().insertAll(items)
            }
            db.achievements().insertAll(com.wakelock.data.repo.Achievements.defaults())
        }
    }
}
