package com.harsh.alarmapp;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

public final class AlarmData {

    private static final String PREFS_NAME   = "alarm_data_store";
    private static final String KEY_LIST     = "alarm_list_json";

    public final int     id;
    public final String  time;
    public final String  label;
    public final boolean active;
    public final int[]   days;
    public final String  sound;
    public final long    nextTriggerMs;

    public AlarmData(int id, String time, String label, boolean active,
                     int[] days, String sound, long nextTriggerMs) {
        this.id = id;
        this.time = time;
        this.label = label;
        this.active = active;
        this.days = days;
        this.sound = sound;
        this.nextTriggerMs = nextTriggerMs;
    }

    public JSONObject toJson() {
        try {
            JSONArray daysArr = new JSONArray();
            for (int d : days) daysArr.put(d);
            return new JSONObject()
                    .put("id", id)
                    .put("time", time)
                    .put("label", label)
                    .put("active", active)
                    .put("days", daysArr)
                    .put("sound", sound)
                    .put("nextTriggerMs", nextTriggerMs);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public static AlarmData fromJson(JSONObject obj) {
        JSONArray daysArr = obj.optJSONArray("days");
        int[] days;
        if (daysArr != null) {
            days = new int[daysArr.length()];
            for (int i = 0; i < daysArr.length(); i++) days[i] = daysArr.optInt(i);
        } else {
            days = new int[]{0, 1, 2, 3, 4, 5, 6};
        }
        return new AlarmData(
                obj.optInt("id", 0),
                obj.optString("time", "00:00"),
                obj.optString("label", "Alarm"),
                obj.optBoolean("active", true),
                days,
                obj.optString("sound", "classic"),
                obj.optLong("nextTriggerMs", 0L)
        );
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static void saveAll(Context ctx, List<AlarmData> alarms) {
        JSONArray arr = new JSONArray();
        for (AlarmData a : alarms) arr.put(a.toJson());
        prefs(ctx).edit().putString(KEY_LIST, arr.toString()).apply();
    }

    public static List<AlarmData> loadAll(Context ctx) {
        String raw = prefs(ctx).getString(KEY_LIST, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            List<AlarmData> result = new ArrayList<>(arr.length());
            for (int i = 0; i < arr.length(); i++) {
                result.add(fromJson(arr.getJSONObject(i)));
            }
            return result;
        } catch (Exception e) {
            e.printStackTrace();
            return new ArrayList<>(0);
        }
    }

    public static void save(Context ctx, AlarmData alarm) {
        List<AlarmData> all = loadAll(ctx);
        all.removeIf(a -> a.id == alarm.id);
        all.add(alarm);
        saveAll(ctx, all);
    }

    public static void remove(Context ctx, int alarmId) {
        List<AlarmData> all = loadAll(ctx);
        all.removeIf(a -> a.id == alarmId);
        saveAll(ctx, all);
    }

    public static AlarmData findById(Context ctx, int alarmId) {
        for (AlarmData a : loadAll(ctx)) {
            if (a.id == alarmId) return a;
        }
        return null;
    }

    public static long computeNextTriggerMs(AlarmData alarm) {
        if (!alarm.active || alarm.days == null || alarm.days.length == 0) {
            return Long.MAX_VALUE;
        }

        // Validate time format -- reject invalid times instead of silently
        // parsing garbage (e.g. a timestamp string stored in the time field).
        if (alarm.time == null || !alarm.time.matches("\\d{2}:\\d{2}")) {
            android.util.Log.w("AlarmData", "computeNextTriggerMs: invalid time format for alarm "
                    + alarm.id + ": \"" + alarm.time + "\"");
            return Long.MAX_VALUE;
        }

        String[] parts = alarm.time.split(":");
        int hour;
        int minute;
        try {
            hour = Integer.parseInt(parts[0]);
            minute = Integer.parseInt(parts[1]);
        } catch (NumberFormatException e) {
            android.util.Log.w("AlarmData", "computeNextTriggerMs: non-numeric time for alarm "
                    + alarm.id + ": \"" + alarm.time + "\"");
            return Long.MAX_VALUE;
        }

        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            android.util.Log.w("AlarmData", "computeNextTriggerMs: out-of-range time for alarm "
                    + alarm.id + ": hour=" + hour + " minute=" + minute);
            return Long.MAX_VALUE;
        }

        Calendar now = Calendar.getInstance();
        Calendar target = Calendar.getInstance();
        target.set(Calendar.HOUR_OF_DAY, hour);
        target.set(Calendar.MINUTE, minute);
        target.set(Calendar.SECOND, 0);
        target.set(Calendar.MILLISECOND, 0);

        int currentDay = now.get(Calendar.DAY_OF_WEEK);
        int currentDay0 = currentDay - 1;

        boolean matchesToday = false;
        for (int d : alarm.days) {
            if (d == currentDay0) { matchesToday = true; break; }
        }
        if (matchesToday && target.after(now)) {
            return target.getTimeInMillis();
        }
        for (int offset = 1; offset <= 7; offset++) {
            int nextDay0 = (currentDay0 + offset) % 7;
            for (int d : alarm.days) {
                if (d == nextDay0) {
                    target.add(Calendar.DAY_OF_YEAR, offset);
                    return target.getTimeInMillis();
                }
            }
        }
        return Long.MAX_VALUE;
    }

    public static void rescheduleNext(Context ctx, int alarmId) {
        AlarmData alarm = findById(ctx, alarmId);
        if (alarm == null) return;
        long nextMs = computeNextTriggerMs(alarm);
        AlarmData updated = new AlarmData(
                alarm.id, alarm.time, alarm.label, alarm.active,
                alarm.days, alarm.sound, nextMs
        );
        save(ctx, updated);
        if (nextMs > System.currentTimeMillis() && nextMs < Long.MAX_VALUE) {
            AlarmScheduler.scheduleAlarm(ctx, alarmId, nextMs);
        }
    }
}
