package com.uporpay.wakeorlock;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.util.Iterator;

/**
 * The JS<->Android seam. Deliberately narrow: the state machine, the mission
 * rules and the punishment ladder all stay in JavaScript (src/logic.js, still
 * unit-tested in the browser), and the native side only supplies the four
 * things a WebView cannot:
 *
 *   1. exact wake-ups that fire with the app dead        (AlarmScheduler)
 *   2. audio/vibration that outlives a backgrounded tab  (RingService)
 *   3. an OS-level confinement while locked out           (LockGuard)
 *   4. a record of what fired, so the app can't deny it   (AlarmStore)
 *
 * Everything is safe to call from a browser too: the JS bridge degrades to
 * no-ops, so one codebase runs in both places.
 */
@CapacitorPlugin(
        name = "WakeOrLock",
        permissions = {
                // The only runtime permission this app needs that the bridge cannot
                // grant for you. Camera and location are requested by their own
                // Capacitor plugins, so declaring them twice would fight.
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
        }
)
public class WakeOrLockPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject o = new JSObject();
        o.put("native", true);
        o.put("deviceOwner", LockGuard.isDeviceOwner(getActivity()));
        long left = LockGuard.remainingMs(getContext());
        o.put("locked", left > 0);
        o.put("remainingMs", left);
        o.put("reason", LockGuard.reason(getContext()));
        o.put("exactAlarmsAllowed", AlarmScheduler.canScheduleExact(getContext()));
        o.put("notificationsGranted", notificationGranted());
        o.put("dueAlarms", AlarmStore.due(getContext()).length());
        o.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(o);
    }

    /**
     * Resolves with the answer the user actually gave — not the answer before the
     * dialog appeared. Pre-13 there is no such permission, so it reports granted.
     */
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || notificationGranted()) {
            call.resolve(granted());
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        if (call == null) return;
        call.resolve(granted());
    }

    private JSObject granted() {
        JSObject o = new JSObject();
        o.put("granted", notificationGranted());
        return o;
    }

    private boolean notificationGranted() {
        if (Build.VERSION.SDK_INT < 33) return true;
        Context c = getContext();
        return c == null || ContextCompat.checkSelfPermission(c, "android.permission.POST_NOTIFICATIONS")
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    /** { id, at, label, mode } → re-armed on boot, survives a force-stop. */
    @PluginMethod
    public void setAlarm(PluginCall call) {
        String id = call.getString("id");
        Long at = call.getLong("at");
        if (id == null || at == null) {
            call.reject("id and at are required");
            return;
        }
        boolean exact = AlarmScheduler.schedule(getContext(), id, at,
                call.getString("label", "Wake up"), call.getString("mode", "choose"));
        JSObject o = new JSObject();
        o.put("exact", exact);
        call.resolve(o);
    }

    @PluginMethod
    public void cancelAlarm(PluginCall call) {
        String id = call.getString("id");
        if (id != null) AlarmScheduler.cancel(getContext(), id);
        call.resolve();
    }

    /**
     * Re-arm every stored alarm whose time is still ahead. Called on launch, so
     * an app update or a crash never leaves you with a schedule that only lives
     * in memory. Past-due entries are left alone: they are already in `due`.
     */
    @PluginMethod
    public void rescheduleAll(PluginCall call) {
        JSONObject all = AlarmStore.all(getContext());
        int rearmed = 0;
        long now = System.currentTimeMillis();
        Iterator<String> it = all.keys();
        while (it.hasNext()) {
            String id = it.next();
            try {
                JSONObject rec = all.getJSONObject(id);
                long at = rec.optLong("at", 0L);
                if (at > now) {
                    AlarmScheduler.schedule(getContext(), id, at, rec.optString("label", ""), rec.optString("mode", "choose"));
                    rearmed++;
                }
            } catch (Exception ignored) {}
        }
        JSObject o = new JSObject();
        o.put("rearmed", rearmed);
        call.resolve(o);
    }

    /** Alarms that fired while the WebView was gone. This is what makes "the app was closed" a non-excuse. */
    @PluginMethod
    public void dueAlarms(PluginCall call) {
        JSONObject due = AlarmStore.due(getContext());
        JSArray items = new JSArray();
        Iterator<String> it = due.keys();
        while (it.hasNext()) {
            String id = it.next();
            try {
                JSONObject rec = due.getJSONObject(id);
                JSObject o = new JSObject();
                o.put("id", id);
                o.put("firedAt", rec.optLong("firedAt"));
                o.put("label", rec.optString("label"));
                o.put("mode", rec.optString("mode"));
                items.put(o);
            } catch (Exception ignored) {}
        }
        JSObject ret = new JSObject();
        ret.put("items", items);
        call.resolve(ret);
    }

    @PluginMethod
    public void acknowledgeAlarm(PluginCall call) {
        String id = call.getString("id");
        if (id != null) AlarmStore.acknowledge(getContext(), id);
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                    getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(AlarmReceiver.NOTIF_ID);
                nm.cancel(RingService.NOTIF_ID);
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    /**
     * checkPermissions for the JS side: { notifications: 'granted' | 'denied' }.
     * Mirrors Capacitor's own plugin shape so the settings screen can treat it the
     * same way it treats camera and location.
     */
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject o = new JSObject();
        o.put("notifications", notificationGranted() ? "granted" : "denied");
        call.resolve(o);
    }

    @PluginMethod
    public void startRing(PluginCall call) {
        Context c = getContext();
        Intent i = new Intent(c, RingService.class);
        i.setAction(RingService.ACTION_START);
        i.putExtra(RingService.EXTRA_LABEL, call.getString("label", "Wake up"));
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i);
            else c.startService(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("ring service refused: " + e.getClass().getSimpleName());
        }
    }

    @PluginMethod
    public void stopRing(PluginCall call) {
        Context c = getContext();
        Intent i = new Intent(c, RingService.class);
        i.setAction(RingService.ACTION_STOP);
        try {
            c.startService(i);
        } catch (Exception ignored) {
            try { c.stopService(new Intent(c, RingService.class)); } catch (Exception ignored2) {}
        }
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                    c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(AlarmReceiver.NOTIF_ID);
        } catch (Exception ignored2) {}
        call.resolve();
    }

    /** { until } epoch ms — pins the app via LockGuard, device-owner aware. */
    @PluginMethod
    public void engageLock(PluginCall call) {
        Long until = call.getLong("until");
        if (until == null) {
            call.reject("until is required");
            return;
        }
        LockGuard.engage(getContext(), until, call.getString("reason", ""));
        LockGuard.applyTo(getActivity());
        JSObject o = new JSObject();
        o.put("deviceOwner", LockGuard.isDeviceOwner(getActivity()));
        o.put("remainingMs", LockGuard.remainingMs(getContext()));
        call.resolve(o);
    }

    @PluginMethod
    public void releaseLock(PluginCall call) {
        LockGuard.release(getContext());
        LockGuard.applyTo(getActivity());
        call.resolve();
    }

    @PluginMethod
    public void lockState(PluginCall call) {
        long left = LockGuard.remainingMs(getContext());
        JSObject o = new JSObject();
        o.put("locked", left > 0);
        o.put("remainingMs", left);
        o.put("reason", LockGuard.reason(getContext()));
        o.put("deviceOwner", LockGuard.isDeviceOwner(getActivity()));
        call.resolve(o);
    }

    /** Three doors the user has to open by hand; the app can only point at them. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void openAlarmSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            i.setData(Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            i.putExtra(Settings.EXTRA_CHANNEL_ID, Channels.ALARM);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** Read-once handoff of "the alarm launched this activity" — see MainActivity. */
    @PluginMethod
    public void consumeLaunch(PluginCall call) {
        String id = MainActivity.takeAlarmLaunchId();
        JSObject o = new JSObject();
        o.put("alarmId", id == null ? JSONObject.NULL : id);
        call.resolve(o);
    }
}
