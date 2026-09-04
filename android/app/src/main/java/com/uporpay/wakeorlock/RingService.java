package com.uporpay.wakeorlock;

import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.ServiceCompat;

/**
 * The 5 minutes of noise, and the reason it can be loud at 07:00:00.
 *
 * Audio is played through USAGE_ALARM, which is the only stream that ignores
 * ringermode/DND for the purpose of waking someone up, at max out of
 * respect for the alarm stream volume. A partial wake lock keeps the CPU alive
 * so Doze cannot pause the loop, and the notification is the ongoing one that
 * lets the service exist under Android 12+ background rules.
 *
 * startForeground is wrapped by every caller: from a background receiver on
 * Android 12+ it throws, and the full-screen intent is the fallback.
 */
public class RingService extends Service {

    public static final String ACTION_START = "wol.RING_START";
    public static final String ACTION_STOP = "wol.RING_STOP";
    public static final String EXTRA_LABEL = "label";
    public static final int NOTIF_ID = 4712;

    private MediaPlayer player;
    private PowerManager.WakeLock wakeLock;
    private Thread vibeThread;
    private volatile boolean ringing;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Channels.ensure(this);
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopEverything();
            stopSelf();
            return START_NOT_STICKY;
        }
        String label = intent == null ? "" : intent.getStringExtra(EXTRA_LABEL);
        startForegroundNice(label == null || label.isEmpty() ? "Wake up" : label);
        beginRing();
        return START_STICKY;
    }

    private void startForegroundNice(String label) {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent show = PendingIntent.getActivity(this, 99, open, AlarmScheduler.flagsUpdate());

        android.app.Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new android.app.Notification.Builder(this, Channels.RING)
                : new android.app.Notification.Builder(this);
        b.setContentTitle("Alarm ringing")
                .setContentText(label)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setOngoing(true)
                .setContentIntent(show);
        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            type = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        }
        try {
            ServiceCompat.startForeground(this, NOTIF_ID, b.build(), type);
        } catch (Exception ignored) {
            // Android 14 will not let some starts through; the notification from
            // AlarmReceiver still carries the full-screen intent.
        }
    }

    private void beginRing() {
        if (ringing) return;
        ringing = true;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wake-or-lock:ring");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(10L * 60L * 1000L); // 10 min ceiling, well past the 5 min buzz
            }
        } catch (Exception ignored) {}

        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(this, Channels.alarmSoundUri(this));
            player.setLooping(true);
            player.setVolume(1.0f, 1.0f);
            player.prepare();
            player.start();
        } catch (Exception e) {
            // no alarm tone on the device: beeps on the alarm stream are the floor
            try {
                ToneLoop();
            } catch (Exception ignored) {}
        }

        vibeThread = new Thread(new Runnable() {
            @Override public void run() {
                long[] pattern = {0, 500, 150, 500, 150, 900, 300};
                while (ringing) {
                    vibrateOnce(pattern);
                    try { Thread.sleep(2100); } catch (InterruptedException e) { return; }
                }
            }
        }, "wol-vibe");
        vibeThread.start();
    }

    private void ToneLoop() {
        // Deliberately primitive: a ToneGenerator needs no media file and no
        // permission, so it is the fallback when a ROM has no default alarm tone.
        final android.media.ToneGenerator tg =
                new android.media.ToneGenerator(AudioManager.STREAM_ALARM, android.media.ToneGenerator.MAX_VOLUME);
        new Thread(new Runnable() {
            @Override public void run() {
                while (ringing) {
                    tg.startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 600, 150);
                    try { Thread.sleep(900); } catch (InterruptedException e) { break; }
                }
                tg.release();
            }
        }, "wol-tone").start();
    }

    @SuppressWarnings("deprecation")
    private void vibrateOnce(long[] pattern) {
        try {
            Vibrator v;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                v = vm == null ? null : vm.getDefaultVibrator();
            } else {
                v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(pattern, -1));
            } else {
                v.vibrate(pattern, -1);
            }
        } catch (Exception ignored) {}
    }

    private void stopEverything() {
        ringing = false;
        if (vibeThread != null) {
            vibeThread.interrupt();
            vibeThread = null;
        }
        if (player != null) {
            try {
                player.stop();
                player.release();
            } catch (Exception ignored) {}
            player = null;
        }
        try {
            Vibrator v;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                v = vm == null ? null : vm.getDefaultVibrator();
            } else {
                v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (v != null) v.cancel();
        } catch (Exception ignored) {}
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
        }
        wakeLock = null;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
    }

    @Override
    public void onDestroy() {
        stopEverything();
        super.onDestroy();
    }
}
