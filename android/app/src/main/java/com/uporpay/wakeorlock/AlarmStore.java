package com.uporpay.wakeorlock;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Prefs-backed record of scheduled alarms and of alarms that fired while the
 * WebView was dead.
 *
 * This is the reason the APK can be an actual alarm clock: the browser build
 * can only ring while a tab is alive, so a missed 07:00 becomes "the app was
 * closed" and the whole punishment is void. Here the system fires the intent,
 * and the app reconciles on next launch by draining the due list.
 */
public final class AlarmStore {

    private static final String PREFS = "wake-or-lock";
    private static final String KEY_ALARMS = "alarms";
    private static final String KEY_DUE = "due";

    private AlarmStore() {}

    private static SharedPreferences p(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject read(Context c, String key) {
        try {
            String raw = p(c).getString(key, "{}");
            return new JSONObject(raw);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void write(Context c, String key, JSONObject o) {
        p(c).edit().putString(key, o.toString()).apply();
    }

    public static void put(Context c, String id, long at, String label, String mode) {
        JSONObject o = read(c, KEY_ALARMS);
        try {
            JSONObject rec = new JSONObject();
            rec.put("at", at);
            rec.put("label", label == null ? "" : label);
            rec.put("mode", mode == null ? "choose" : mode);
            o.put(id, rec);
        } catch (JSONException ignored) {}
        write(c, KEY_ALARMS, o);
    }

    public static void remove(Context c, String id) {
        JSONObject o = read(c, KEY_ALARMS);
        o.remove(id);
        write(c, KEY_ALARMS, o);
        JSONObject due = read(c, KEY_DUE);
        due.remove(id);
        write(c, KEY_DUE, due);
    }

    public static JSONObject all(Context c) {
        return read(c, KEY_ALARMS);
    }

    /** Called by AlarmReceiver: remember that this alarm fired, with the wall-clock time it fired. */
    public static void markDue(Context c, String id, long firedAt, String label, String mode) {
        JSONObject due = read(c, KEY_DUE);
        try {
            JSONObject rec = new JSONObject();
            rec.put("id", id);
            rec.put("firedAt", firedAt);
            rec.put("label", label == null ? "" : label);
            rec.put("mode", mode == null ? "choose" : mode);
            due.put(id, rec);
        } catch (JSONException ignored) {}
        write(c, KEY_DUE, due);
    }

    public static JSONObject due(Context c) {
        return read(c, KEY_DUE);
    }

    public static void acknowledge(Context c, String id) {
        JSONObject due = read(c, KEY_DUE);
        due.remove(id);
        write(c, KEY_DUE, due);
    }
}
