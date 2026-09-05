package com.uporpay.wakeorlock;

import android.content.BroadcastReceiver;
import android.content.Intent;
import android.os.Build;
import android.content.Context;

import org.json.JSONObject;

import java.util.Iterator;

/**
 * Re-arms every stored alarm after a reboot, an app update, or the user messing
 * with the clock or timezone.
 *
 * AlarmManager registrations do not survive a reboot, and an alarm app whose
 * schedule silently evaporates on restart is worse than none: you sleep through
 * it and blame yourself. Alarms whose time already passed while the device was
 * off are recorded as due instead, so the missed wake-up still counts.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent intent) {
        Channels.ensure(c);
        JSONObject all = AlarmStore.all(c);
        long now = System.currentTimeMillis();
        Iterator<String> it = all.keys();
        while (it.hasNext()) {
            String id = it.next();
            try {
                JSONObject rec = all.getJSONObject(id);
                long at = rec.optLong("at", 0L);
                String label = rec.optString("label", "");
                String mode = rec.optString("mode", "choose");
                if (at > now) {
                    AlarmScheduler.schedule(c, id, at, label, mode);
                } else if (AlarmStore.due(c).opt(id) == null) {
                    AlarmStore.markDue(c, id, at, label, mode);
                }
            } catch (Exception ignored) {}
        }

        // A lockout that was running across a reboot must still be running, and
        // with the same deadline — the remaining time is read from SharedPreferences,
        // which survives a restart, so a reboot buys nothing.
        //
        // The leash (a foreground service) is what actually enforces that: it is
        // the only piece allowed to run immediately after boot, it re-pins the
        // task, keeps device-owner restrictions applied, and drags the lock screen
        // back to the front whenever the task is left. Starting the activity
        // directly is a bonus that Android 10+ usually refuses until the user
        // touches something, hence the try/catch.
        long left = LockGuard.remainingMs(c);
        if (left > 0) {
            Intent leash = new Intent(c, RingService.class);
            leash.setAction(RingService.ACTION_LEASH);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    c.startForegroundService(leash);
                } else {
                    c.startService(leash);
                }
            } catch (Exception ignored) {
                // Foreground-service starts are rate-limited on Android 12+; the
                // alarm notification still carries the full-screen intent.
            }

            Intent open = new Intent(c, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                c.startActivity(open);
            } catch (Exception ignored) {
                // Re-applied from MainActivity.onCreate as soon as it is opened.
            }
        }
    }
}
