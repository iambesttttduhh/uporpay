package com.uporpay.wakeorlock;

import android.content.Intent;
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
        LockGuard.applyTo(this);
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
    }
}
