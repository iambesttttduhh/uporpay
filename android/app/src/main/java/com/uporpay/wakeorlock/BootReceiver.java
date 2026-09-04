package com.uporpay.wakeorlock;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

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

        // A lockout that was running across a reboot must still be running.
        if (LockGuard.remainingMs(c) > 0) {
            Intent open = new Intent(c, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                c.startActivity(open);
            } catch (Exception ignored) {
                // Android 10+ blocks background activity starts; LockGuard is
                // re-applied in MainActivity.onCreate the moment it is opened.
            }
        }
    }
}
