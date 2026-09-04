package com.uporpay.wakeorlock;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * setAlarmClock, not setExact, and not a JS timer.
 *
 * setAlarmClock is the one AlarmManager mode that survives Doze, shows the
 * next-alarm icon in the status bar, and is exempt from the battery-optimisation
 * deferrals that silently turn a 07:00 alarm into a 07:40 one. On Android 12+
 * it also requires SCHEDULE_EXACT_ALARM (or USE_EXACT_ALARM for alarm-clock
 * apps); if the user revoked it we degrade to setExactAndAllowWhileIdle rather
 * than throwing, and say so in status().
 */
public final class AlarmScheduler {

    static final String ACTION_FIRE = "com.uporpay.wakeorlock.ALARM_FIRE";
    static final String EXTRA_ID = "id";
    static final String EXTRA_LABEL = "label";
    static final String EXTRA_MODE = "mode";
    static final String EXTRA_AT = "at";

    private AlarmScheduler() {}

    static int flagsUpdate() {
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
        return f;
    }

    private static PendingIntent intent(Context c, String id, long at, String label, String mode) {
        Intent i = new Intent(c, AlarmReceiver.class);
        i.setAction(ACTION_FIRE);
        i.putExtra(EXTRA_ID, id);
        i.putExtra(EXTRA_LABEL, label);
        i.putExtra(EXTRA_MODE, mode);
        i.putExtra(EXTRA_AT, at);
        return PendingIntent.getBroadcast(c, id.hashCode(), i, flagsUpdate());
    }

    public static boolean canScheduleExact(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am == null || am.canScheduleExactAlarms();
    }

    /** @return true when the exact clock path was used. */
    public static boolean schedule(Context c, String id, long at, String label, String mode) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;
        PendingIntent pi = intent(c, id, at, label, mode);
        AlarmStore.put(c, id, at, label, mode);
        if (canScheduleExact(c) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, pi), pi);
                return true;
            } catch (SecurityException ignored) {
                // permission revoked between the check and the call
            }
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (SecurityException e) {
            am.set(AlarmManager.RTC_WAKEUP, at, pi); // last resort: inexact, still fires
        }
        return false;
    }

    public static void cancel(Context c, String id) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            am.cancel(PendingIntent.getBroadcast(c, id.hashCode(),
                    new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE), flagsUpdate()));
        }
        AlarmStore.remove(c, id);
    }
}
