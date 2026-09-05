package com.uporpay.wakeorlock;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Capacitor's host activity, with two additions:
 *
 *  - it registers WakeOrLockPlugin, and
 *  - it re-applies the lockout on every create(). onCreate is the one place we
 *    can guarantee runs after a relaunch, a crash, or an "App info → Force stop",
 *    which is precisely when a punishment app otherwise quietly lets you out.
 */
public class MainActivity extends BridgeActivity {

    private static volatile String alarmLaunchId;

    static String takeAlarmLaunchId() {
        String id = alarmLaunchId;
        alarmLaunchId = null;
        return id;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakeOrLockPlugin.class);
        super.onCreate(savedInstanceState);

        if (getIntent() != null) {
            String id = getIntent().getStringExtra("wolAlarm");
            if (id != null) alarmLaunchId = id;
        }

        // Stay on screen while ringing so the WebView keeps playing audio.
        if (LockGuard.remainingMs(this) > 0 || AlarmStore.due(this).length() > 0) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        // Android 8.1+ honours these from the manifest; setting them again here
        // covers 22–26 where the manifest attributes did not exist yet.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                setShowWhenLocked(true);
                setTurnScreenOn(true);
            } catch (Exception ignored) {}
        }
        LockGuard.applyTo(this);
        // If we were launched *by* the lock screen, the guard has to keep running
        // even after this activity is backgrounded, or "reboot and get away with
        // it" works.
        if (LockGuard.remainingMs(this) > 0) {
            try {
                Intent leash = new Intent(this, RingService.class);
                leash.setAction(RingService.ACTION_LEASH);
                startForegroundService(leash);
            } catch (Exception ignored) {}
        }
    }

    /**
     * launchMode=singleTask means a notification tap usually arrives here rather
     * than in onCreate. The alarm id still has to reach JS, or the app opens into
     * the idle screen while an episode is already due — which is how an alarm app
     * loses the argument.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null) {
            String id = intent.getStringExtra("wolAlarm");
            if (id != null) alarmLaunchId = id;
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        LockGuard.applyTo(this);
        // Coming back to a locked app is the moment to check whether the pin held.
        if (LockGuard.remainingMs(this) > 0 && LockGuard.pinIsLoose(this)) LockGuard.noteEscape(this);
    }

    /**
     * Home, Recents, or a long-press that summoned the launcher. If a lockout is
     * running and the task is no longer pinned, that is an escape, and it is
     * charged — see LockGuard.noteEscape.
     */
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        final boolean locked = LockGuard.remainingMs(this) > 0;
        if (!locked) return;
        // Give the system a beat: returning from a permission dialog also fires
        // this, and an honest app does not punish a dialog.
        getWindow().getDecorView().postDelayed(new Runnable() {
            @Override public void run() {
                // pinIsLoose() asks two questions: is the task still pinned, and is
                // this app still on top. Only "neither" counts as getting out.
                if (LockGuard.pinIsLoose(MainActivity.this)) LockGuard.noteEscape(MainActivity.this);
            }
        }, 2500L);
    }

    // public, not protected: Capacitor's BridgeActivity declares onPause() public,
    // and Java will not let an override narrow the access.
    @Override
    public void onPause() {
        super.onPause();
        LockGuard.setImmersive(this, LockGuard.remainingMs(this) > 0);
    }
}
