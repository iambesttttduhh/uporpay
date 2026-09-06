package com.wakelock.outside

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.sqrt

data class SignalResult(val name: String, val available: Boolean, val passed: Boolean, val detail: String)

data class OutsideResult(
    val verified: Boolean,
    val confidence: Double,
    val signals: List<SignalResult>,
    val reason: String
)

/**
 * Multi-signal outside verification. GPS alone is explicitly NOT treated as proof.
 * Requires at least two AVAILABLE signals to agree; degrades honestly when hardware is missing.
 */
class OutsideVerifier(private val ctx: Context) {

    companion object {
        const val LIGHT_OUTDOOR_LUX = 1000f
        const val MIN_DISPLACEMENT_M = 25f
        const val MOTION_THRESHOLD = 1.6
    }

    private fun has(p: String) =
        ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

    private fun sensors() = ctx.getSystemService(SensorManager::class.java)

    suspend fun readLight(timeoutMs: Long = 3000): Float? {
        val sm = sensors() ?: return null
        val sensor = sm.getDefaultSensor(Sensor.TYPE_LIGHT) ?: return null
        return suspendCancellableCoroutine { cont ->
            var done = false
            val l = object : SensorEventListener {
                override fun onSensorChanged(e: SensorEvent) {
                    if (!done) { done = true; sm.unregisterListener(this); cont.resume(e.values.firstOrNull()) }
                }
                override fun onAccuracyChanged(s: Sensor?, a: Int) {}
            }
            sm.registerListener(l, sensor, SensorManager.SENSOR_DELAY_NORMAL)
            cont.invokeOnCancellation { runCatching { sm.unregisterListener(l) } }
        }
    }

    /** Peak linear acceleration magnitude over a short window -> walking detection. */
    suspend fun readMotion(windowMs: Long = 2500): Double? {
        val sm = sensors() ?: return null
        val sensor = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return null
        return suspendCancellableCoroutine { cont ->
            var peak = 0.0
            var count = 0
            val l = object : SensorEventListener {
                override fun onSensorChanged(e: SensorEvent) {
                    val (x, y, z) = Triple(e.values[0], e.values[1], e.values[2])
                    val mag = sqrt((x * x + y * y + z * z).toDouble())
                    val dev = kotlin.math.abs(mag - SensorManager.GRAVITY_EARTH)
                    if (dev > peak) peak = dev
                    count++
                    if (count > 250) finish()
                }
                override fun onAccuracyChanged(s: Sensor?, a: Int) {}
                fun finish() {
                    runCatching { sm.unregisterListener(this) }
                    if (cont.isActive) cont.resume(peak)
                }
            }
            sm.registerListener(l, sensor, SensorManager.SENSOR_DELAY_GAME)
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                runCatching { sm.unregisterListener(l) }
                if (cont.isActive) cont.resume(peak)
            }, windowMs)
            cont.invokeOnCancellation { runCatching { sm.unregisterListener(l) } }
        }
    }

    fun lastLocation(): Location? {
        if (!has(Manifest.permission.ACCESS_COARSE_LOCATION) &&
            !has(Manifest.permission.ACCESS_FINE_LOCATION)) return null
        return try {
            val lm = ctx.getSystemService(LocationManager::class.java)
            val providers = lm.getProviders(true)
            providers.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
                .maxByOrNull { it.time }
        } catch (e: Exception) { Log.e("WL/Outside", "location failed", e); null }
    }

    /**
     * @param anchor location recorded when the challenge started (the "bed" position)
     */
    suspend fun verify(anchor: Location?): OutsideResult {
        val signals = mutableListOf<SignalResult>()

        // 1. Light
        val lux = runCatching { readLight() }.getOrNull()
        if (lux == null) {
            signals += SignalResult("Ambient light", false, false, "No light sensor on this device")
        } else {
            val pass = lux >= LIGHT_OUTDOOR_LUX
            signals += SignalResult("Ambient light", true, pass, "${lux.toInt()} lux")
        }

        // 2. Motion
        val motion = runCatching { readMotion() }.getOrNull()
        if (motion == null) {
            signals += SignalResult("Movement", false, false, "No accelerometer")
        } else {
            val pass = motion >= MOTION_THRESHOLD
            signals += SignalResult("Movement", true, pass, "peak %.1f m/s²".format(motion))
        }

        // 3. Displacement
        val here = lastLocation()
        if (here == null) {
            signals += SignalResult("Location", false, false, "Location unavailable or not permitted")
        } else if (anchor == null) {
            signals += SignalResult("Location", true, false, "No starting point recorded")
        } else {
            val d = anchor.distanceTo(here)
            signals += SignalResult("Location", true, d >= MIN_DISPLACEMENT_M, "moved ${d.toInt()} m")
        }

        val availableCount = signals.count { it.available }
        val passedCount = signals.count { it.available && it.passed }
        val confidence = if (availableCount == 0) 0.0 else passedCount.toDouble() / availableCount

        // require 2 agreeing signals; if only one sensor exists at all, that one must pass
        val verified = when {
            availableCount == 0 -> false
            availableCount == 1 -> passedCount == 1
            else -> passedCount >= 2
        }
        val reason = when {
            verified -> "Outside verified"
            availableCount == 0 -> "No usable sensors on this device"
            else -> "Not enough signals agreed ($passedCount of $availableCount)"
        }
        return OutsideResult(verified, confidence, signals, reason)
    }
}
