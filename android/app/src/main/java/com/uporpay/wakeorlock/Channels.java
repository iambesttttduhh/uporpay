package com.uporpay.wakeorlock;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

/** Notification channels, created once and from whichever process needs them first. */
public final class Channels {

    public static final String ALARM = "wol-alarm";
    public static final String RING = "wol-ring";

    private Channels() {}

    public static void ensure(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            Uri alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alarmSound == null) alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

            AudioAttributes aa = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();

            NotificationChannel ring = new NotificationChannel(ALARM, "Alarm", NotificationManager.IMPORTANCE_HIGH);
            ring.setSound(alarmSound, aa);
            ring.enableVibration(true);
            ring.setBypassDnd(true);
            ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            if (nm.getNotificationChannel(ALARM) == null) nm.createNotificationChannel(ring);

            NotificationChannel svc = new NotificationChannel(RING, "Ringing", NotificationManager.IMPORTANCE_LOW);
            svc.setSound(null, null);
            if (nm.getNotificationChannel(RING) == null) nm.createNotificationChannel(svc);
        } catch (Exception ignored) {
            // channels are best-effort; a missing one downgrades loudness, not correctness
        }
    }

    public static Uri alarmSoundUri(Context c) {
        Uri uri = RingtoneManager.getActualDefaultRingtoneUri(c, RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getActualDefaultRingtoneUri(c, RingtoneManager.TYPE_RINGTONE);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        return uri;
    }
}
