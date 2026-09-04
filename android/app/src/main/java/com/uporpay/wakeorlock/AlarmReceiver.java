package com.uporpay.wakeorlock;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * The only component that runs when the app does not.
 *
 * It cannot do much: on Android 12+ a background receiver may not start a
 * foreground service, so the loud ringing has to be carried by a
 * full-screen-intent notification, and RingService is started opportunistically
 * (it succeeds once the activity is up). What always happens is that the firing
 * is recorded as due, so the app cannot deny that the alarm went off — which is
 * exactly the property a punishment-based alarm clock needs.
 */
public class AlarmReceiver extends BroadcastReceiver {

    public static final int NOTIF_ID = 4711;

    @Override
    public void onReceive(Context c, Intent intent) {
        String id = intent == null ? "unknown" : intent.getStringExtra(AlarmScheduler.EXTRA_ID);
        if (id == null) id = "unknown";
        String label = intent == null ? "" : intent.getStringExtra(AlarmScheduler.EXTRA_LABEL);
        String mode = intent == null ? "choose" : intent.getStringExtra(AlarmScheduler.EXTRA_MODE);
        long at = intent == null ? System.currentTimeMillis() : intent.getLongExtra(AlarmScheduler.EXTRA_AT, System.currentTimeMillis());
        long firedAt = System.currentTimeMillis();

        AlarmStore.markDue(c, id, firedAt, label, mode);

        Channels.ensure(c);
        Intent open = new Intent(c, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("wolAlarm", id);
        PendingIntent show = PendingIntent.getActivity(c, id.hashCode() + 1, open, AlarmScheduler.flagsUpdate());

        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(c, Channels.ALARM)
                : new Notification.Builder(c);
        b.setContentTitle("Wake up — " + (label == null || label.isEmpty() ? "alarm" : label))
                .setContentText("Mission is live. Do it or lose the phone.")
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentIntent(show)
                .setOngoing(true)
                .setAutoCancel(false)
                .setCategory(Notification.CATEGORY_ALARM)
                .setFullScreenIntent(show, true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            b.setVisibility(Notification.VISIBILITY_PUBLIC);
            b.setPriority(Notification.PRIORITY_MAX);
        }
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, b.build());
        } catch (Exception ignored) {
            // notification permission revoked; the due record still stands
        }

        try {
            Intent svc = new Intent(c, RingService.class);
            svc.setAction(RingService.ACTION_START);
            svc.putExtra(RingService.EXTRA_LABEL, label);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                c.startForegroundService(svc);
            } else {
                c.startService(svc);
            }
        } catch (Exception ignored) {
            // ForegroundServiceStartNotAllowedException from a background receiver:
            // the full-screen intent launches the activity, which starts the ring itself.
        }
    }
}
