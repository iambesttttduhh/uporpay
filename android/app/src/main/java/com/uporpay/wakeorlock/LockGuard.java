package com.uporpay.wakeorlock;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.view.WindowManager;

import java.util.ArrayList;
import java.util.List;

/**
 * Single source of truth for "the phone is confiscated right now".
 *
 * Two very different modes live here, and the difference matters:
 *
 *  - Device Owner (provisioned with adb on a freshly-wiped device, see
 *    docs/DEVICE_OWNER.md): we may call setLockTaskPackages() with an explicit
 *    allow-list, so the *system* confines the user to this app plus the dialer.
 *    That is the version where "only a phone call gets through" is literally true.
 *
 *  - Ordinary install (what you get by side-loading this APK): startLockTask()
 *    degrades to screen pinning of our own task. Android keeps an "Unpin"
 *    affordance for the user. We still hold the screen on and re-apply on every
 *    launch so a restart cannot quietly clear a punishment.
 *
 * The deadline lives in SharedPreferences, not the WebView, because force-stopping
 * the app must not be a way out.
 */
public final class LockGuard {

    private static final String PREFS = "wake-or-lock";
    private static final String KEY_UNTIL = "lock.until";
    private static final String KEY_REASON = "lock.reason";

    private static boolean noticeShown = false;

    private LockGuard() {}

    public static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void engage(Context c, long untilEpochMs, String reason) {
        prefs(c).edit()
                .putLong(KEY_UNTIL, untilEpochMs)
                .putString(KEY_REASON, reason == null ? "" : reason)
                .apply();
    }

    public static void release(Context c) {
        prefs(c).edit().remove(KEY_UNTIL).remove(KEY_REASON).apply();
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

    public static boolean isDeviceOwner(Activity a) {
        if (a == null) return false;
        DevicePolicyManager dpm = (DevicePolicyManager) a.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return dpm != null && dpm.isDeviceOwnerApp(a.getPackageName());
    }

    /**
     * Confine the UI for as long as the lockout lasts. Every privileged call is
     * wrapped: a non-device-owner app throws SecurityException on the allow-list,
     * and some OEM ROMs throw on lock task itself.
     */
    public static void applyTo(final Activity a) {
        final long left = remainingMs(a);
        a.runOnUiThread(new Runnable() {
            @Override public void run() {
                if (left <= 0L) {
                    try { a.stopLockTask(); } catch (Exception ignored) {}
                    a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    return;
                }
                a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

                if (isDeviceOwner(a)) {
                    try {
                        DevicePolicyManager dpm =
                                (DevicePolicyManager) a.getSystemService(Context.DEVICE_POLICY_SERVICE);
                        ComponentName admin = new ComponentName(a, AppDeviceReceiver.class);
                        dpm.setLockTaskPackages(admin, dialerPlusSelf(a));
                    } catch (Exception ignored) {
                        // ROM refused; plain pinning below still applies
                    }
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

    /** This app + whatever answers ACTION_DIAL, so calls still work. */
    private static String[] dialerPlusSelf(Context c) {
        List<String> list = new ArrayList<String>();
        list.add(c.getPackageName());
        List<ResolveInfo> resolved =
                c.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_DIAL), 0);
        if (resolved != null) {
            for (ResolveInfo r : resolved) {
                if (r.activityInfo != null && !list.contains(r.activityInfo.packageName)) {
                    list.add(r.activityInfo.packageName);
                }
            }
        }
        return list.toArray(new String[list.size()]);
    }

    /**
     * Tell the user what this build can and cannot do, once per session. A
     * punishment that secretly has a system "Unpin" button in it is worse than
     * no punishment: it teaches you that the app's word means nothing.
     */
    private static void showHonestNotice(Activity a) {
        if (noticeShown) return;
        noticeShown = true;
        try {
            new AlertDialog.Builder(a)
                    .setTitle("Locked out")
                    .setMessage("Only a phone call is offered right now. Side-loaded builds can pin "
                            + "this app but Android keeps an Unpin affordance for you; true lockdown "
                            + "needs device-owner provisioning (docs/DEVICE_OWNER.md).")
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
