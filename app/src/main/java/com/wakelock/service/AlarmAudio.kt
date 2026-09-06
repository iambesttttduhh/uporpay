package com.wakelock.service

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.CombinedVibration
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import com.wakelock.domain.model.VibrationPattern

/** Real alarm sound + vibration. Every call is defensive: audio failure must not kill the alarm. */
class AlarmAudio(private val ctx: Context) {

    private var player: MediaPlayer? = null

    private fun vibrator(): Vibrator? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION") ctx.getSystemService(Vibrator::class.java)
        }
    } catch (e: Exception) { Log.e("WL/Audio", "vibrator unavailable", e); null }

    fun start(soundUri: String?, vibrate: Boolean, pattern: String) {
        try {
            val uri: Uri = soundUri?.let { Uri.parse(it) }
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(ctx, uri)
                isLooping = true
                prepare()
                start()
            }
            Log.i("WL/Audio", "alarm sound started")
        } catch (e: Exception) {
            Log.e("WL/Audio", "sound failed, continuing without audio", e)
        }

        if (vibrate) {
            try {
                val timings = when (VibrationPattern.valueOf(pattern)) {
                    VibrationPattern.GENTLE -> longArrayOf(0, 300, 1700)
                    VibrationPattern.STRONG -> longArrayOf(0, 800, 500)
                    VibrationPattern.PULSING -> longArrayOf(0, 200, 150, 200, 150, 200, 900)
                }
                val effect = VibrationEffect.createWaveform(timings, 0)
                vibrator()?.vibrate(effect)
            } catch (e: Exception) { Log.e("WL/Audio", "vibration failed", e) }
        }
    }

    fun tick(ms: Long = 40) {
        try { vibrator()?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)) }
        catch (_: Exception) {}
    }

    fun stop() {
        try { player?.stop(); player?.release() } catch (_: Exception) {}
        player = null
        try { vibrator()?.cancel() } catch (_: Exception) {}
        Log.i("WL/Audio", "alarm sound stopped")
    }
}
