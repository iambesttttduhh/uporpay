package com.uporpay.wakeorlock;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.app.ActivityManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.UserManager;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;

import java.util.ArrayList;
import java.util.List;

/**
 * Single source of truth for "the phone is confiscated right now", and the
 * counter for how hard you tried to get out of it.
 *
 * Three escalating modes:
 *
 *  - Browser/PWA: nothing here runs; the overlay in JS is the whole lock.
 *  - Side-loaded APK: FLAG_KEEP_SCREEN_ON + startLockTask() (screen pinning) +
 *    a guard loop that re-pins and counts escapes. Android still keeps a system
 *    "Unpin" affordance, so we do the next best thing: unpinning is not an exit,
 *    it is a penalty. Every escape attempt found by the guard adds time, and the
 *    time is added here, in prefs, so it survives the app being killed.
 *  - Device Owner (docs/DEVICE_OWNER.md): the system confines the device to this
 *    app plus whatever answers ACTION_DIAL, and while the lockout runs we add the
 *    user restrictions that make "reboot and try again" fail: no uninstall, no
 *    safe boot, no factory reset, no clock edits, no adb. A hard reboot then comes
 *    into the same lockout via BootReceiver — which is as close to "you cannot get
 *    out" as the platform allows a non-system app.
 *
 * The deadline lives in SharedPreferences rather than the WebView because
 * force-stopping the app must not be a way out.
 */
public final class LockGuard {

    static final String PREFS = "wake-or-lock";
    private static final String KEY_UNTIL = "lock.until";
    private static final String KEY_REASON = "lock.reason";
    private static final String KEY_ESCAPES = "lock.escapes";
    private static final String KEY_ADDED = "lock.added";
    private static final String KEY_CAP = "lock.penaltyCapMs";
    private static final String KEY_LAST = "lock.lastEscapeAt";

    private static boolean noticeShown = false;
    private static final Handler main = new Handler(Looper.getMainLooper());

    private LockGuard() {}

    public static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** @param escapePenaltyMs extra time charged per escape attempt, 0 disables it */
    public static void engage(Context c, long untilEpochMs, String reason, long escapePenaltyMs) {
        prefs(c)
                .edit()
                .putLong(KEY_UNTIL, untilEpochMs)
                .putString(KEY_REASON, reason == null ? "" : reason)
                .putLong(KEY_CAP, Math.max(0L, escapePenaltyMs) * 16L) // total extra ≤ 16 attempts
                .putLong(KEY_LAST, 0L)
                .apply();
    }

    public static void release(Context c) {
        prefs(c)
                .edit()
                .remove(KEY_UNTIL)
                .remove(KEY_REASON)
                .remove(KEY_ESCAPES)
                .remove(KEY_ADDED)
                .remove(KEY_CAP)
                .remove(KEY_LAST)
                .apply();
        applyRestrictions(c, false);
    }

    /** Milliseconds left; also self-clears an expired lockout. */
    public static long remainingMs(Context c) {
        long until = prefs(c).getLong(KEY_UNTIL, 0L);
        if (until <= 0L) return 0L;
        long left = until - System.currentTimeMillis();
        if (left <= 0L) {
            release(c);
            return 0L;
        }
        return left;
    }

    public static String reason(Context c) {
        return prefs(c).getString(KEY_REASON, "");
    }

    public static int escapeCount(Context c) {
        return prefs(c).getInt(KEY_ESCAPES, 0);
    }

    /**
     * Called by the guard loop (and by Activity callbacks) when the user has got
     * out of the pinned task while the lockout is still running. Debounced, because
     * Home → Recents → back is one escape, not four.
     */
    public static void noteEscape(Context c) {
        SharedPreferences p = prefs(c);
        long now = System.currentTimeMillis();
        if (p.getLong(KEY_UNTIL, 0L) <= now) return;
        if (now - p.getLong(KEY_LAST, 0L) < 10_000L) return;

        long penalty = p.getLong(KEY_CAP, 0L) / 16L;
        if (penalty <= 0L) {
            p.edit().putInt(KEY_ESCAPES, p.getInt(KEY_ESCAPES, 0) + 1).putLong(KEY_LAST, now).apply();
            return;
        }
        long added = p.getLong(KEY_ADDED, 0L);
        long cap = p.getLong(KEY_CAP, penalty * 16L);
        long add = Math.min(penalty, Math.max(0L, cap - added));
        p.edit()
                .putInt(KEY_ESCAPES, p.getInt(KEY_ESCAPES, 0) + 1)
                .putLong(KEY_LAST, now)
                .putLong(KEY_ADDED, added + add)
                .putLong(KEY_UNTIL, p.getLong(KEY_UNTIL, now) + add)
                .apply();
    }

    /** True when confinement has actually been broken (not merely backgrounded). */
    public static boolean pinIsLoose(Context c) {
        if (remainingMs(c) <= 0L) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null) {
                    int state = am.getLockTaskModeState();
                    // LOCK_TASK_MODE_NONE is the only state that means "you can leave".
                    // Anything else is the system holding us in the task.
                    if (state != ActivityManager.LOCK_TASK_MODE_NONE) {
                        return false;
                    }
                }
            } catch (Exception ignored) {}
        }
        // No lock-task at all: an escape only counts if the app is also not on top.
        return !appVisible(c) && canReopen(c);
    }

    private static boolean appVisible(Context c) {
        try {
            List<ActivityManager.RunningAppProcessInfo> ps =
                    ((ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE)).getRunningAppProcesses();
            if (ps == null) return true; // cannot tell → assume visible, do not punish
            String mine = c.getPackageName();
            for (ActivityManager.RunningAppProcessInfo p : ps) {
                if (p.processName != null && p.processName.startsWith(mine)
                        && p.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                    return true;
                }
            }
        } catch (Exception ignored) {}
        return true;
    }

    /** Android 10+ refuses background activity starts unless we may draw overlays. */
    public static boolean canReopen(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        try {
            return Settings.canDrawOverlays(c);
        } catch (Exception e) {
            return false;
        }
    }

    public static void reopen(Context c) {
        Intent i = new Intent(c, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            c.startActivity(i);
        } catch (Exception ignored) {
            // refused; the guard loop tries again on its next pass
        }
    }

    public static boolean isDeviceOwner(Context c) {
        if (c == null) return false;
        DevicePolicyManager dpm = (DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return dpm != null && dpm.isDeviceOwnerApp(c.getPackageName());
    }

    /**
     * The user restrictions that make a lockout survive a reboot attempt. Only a
     * device owner may set them; every call is wrapped because a ROM that refuses
     * one must not take the whole lockout down with it.
     */
    public static void applyRestrictions(Context c, boolean on) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return;
        if (!isDeviceOwner(c)) return;
        DevicePolicyManager dpm = (DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (dpm == null) return;
        ComponentName cn = new ComponentName(c, AppDeviceReceiver.class);
        String[] keys = restrictionKeys();
        for (String key : keys) {
            try {
                if (on) dpm.addUserRestriction(cn, key);
                else dpm.clearUserRestriction(cn, key);
            } catch (Exception ignored) {}
        }
    }

    private static String[] restrictionKeys() {
        List<String> k = new ArrayList<String>();
        k.add(UserManager.DISALLOW_UNINSTALL_APPS);
        k.add(UserManager.DISALLOW_SAFE_BOOT);
        k.add(UserManager.DISALLOW_FACTORY_RESET);
        // The clock is the cheapest way to end a countdown early, so while the
        // lockout runs the system clock cannot be edited either.
        k.add(UserManager.DISALLOW_CONFIG_DATE_TIME);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) k.add(UserManager.DISALLOW_DEBUGGING_FEATURES);
        // There is no public DISALLOW_SHUTDOWN: an app — even a device owner — cannot
        // block the power button. That is why a reboot is answered by resuming the
        // same deadline from BootReceiver instead of pretending it cannot happen.
        return k.toArray(new String[k.size()]);
    }

    /**
     * Confine the UI for as long as the lockout lasts.
     */
    public static void applyTo(final Activity a) {
        final long left = remainingMs(a);
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (left <= 0L) {
                    try { a.stopLockTask(); } catch (Exception ignored) {}
                    setImmersive(a, false);
                    a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    return;
                }
                a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                setImmersive(a, true);

                if (isDeviceOwner(a)) {
                    try {
                        DevicePolicyManager dpm =
                                (DevicePolicyManager) a.getSystemService(Context.DEVICE_POLICY_SERVICE);
                        ComponentName admin = new ComponentName(a, AppDeviceReceiver.class);
                        dpm.setLockTaskPackages(admin, dialerPlusSelf(a));
                    } catch (Exception ignored) {
                        // ROM refused; plain pinning below still applies
                    }
                    applyRestrictions(a, true);
                }

                try {
                    a.startLockTask();
                } catch (Exception ignored) {
                    // the WebView overlay is still the whole screen
                }

                if (!isDeviceOwner(a)) showHonestNotice(a);
            }
        });
    }

    /**
     * Hide the status bar and the navigation bar while locked, stickily, so the
     * notification shade cannot be pulled down over the lock screen. This is not
     * security — it removes the easy route, and the guard loop re-applies it.
     */
    @SuppressWarnings("deprecation")
    public static void setImmersive(Activity a, boolean on) {
        if (a == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.view.WindowInsetsController wic = a.getWindow().getInsetsController();
                if (wic != null) {
                    if (on) {
                        wic.hide(android.view.WindowInsets.Type.systemBars());
                        wic.setSystemBarsBehavior(
                                android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    } else {
                        wic.show(android.view.WindowInsets.Type.systemBars());
                    }
                }
                return;
            }
            View decor = a.getWindow().getDecorView();
            if (on) {
                decor.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            } else {
                decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            }
        } catch (Exception ignored) {}
    }

    /** This app + whatever answers ACTION_DIAL, so calls still work. */
    private static String[] dialerPlusSelf(Context c) {
        List<String> list = new ArrayList<String>();
        list.add(c.getPackageName());
        try {
            List<ResolveInfo> resolved =
                    c.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_DIAL), 0);
            if (resolved != null) {
                for (ResolveInfo r : resolved) {
                    if (r.activityInfo != null && !list.contains(r.activityInfo.packageName)) {
                        list.add(r.activityInfo.packageName);
                    }
                }
            }
        } catch (Exception ignored) {}
        return list.toArray(new String[list.size()]);
    }

    /**
     * Tell the user once per session what a side-loaded lock can and cannot do. A
     * punishment that secretly has an "Unpin" button in it is worse than no
     * punishment: it teaches you that the app's word means nothing.
     */
    private static void showHonestNotice(Activity a) {
        if (noticeShown) return;
        noticeShown = true;
        try {
            int escapes = escapeCount(a);
            new AlertDialog.Builder(a)
                    .setTitle("Locked out")
                    .setMessage(escapes > 0
                            ? "Escape attempt " + escapes + " noted — the clock went up, not down. Side-loaded builds are pinned with screen pinning, so Android still shows you an Unpin button; every time you use it this lockout gets longer (device-owner provisioning is what removes the button — docs/DEVICE_OWNER.md)."
                            : "Only a phone call is offered right now. Side-loaded builds can pin this app but Android keeps an Unpin affordance for you; true lockdown needs device-owner provisioning (docs/DEVICE_OWNER.md).")
                    .setCancelable(false)
                    .setPositiveButton("I understand", new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface d, int which) { d.dismiss(); }
                    })
                    .show();
        } catch (Exception ignored) {
            // no window token yet; the overlay already covers everything
        }
    }
}
