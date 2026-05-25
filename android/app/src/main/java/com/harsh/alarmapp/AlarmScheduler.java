package com.harsh.alarmapp;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.HashSet;
import java.util.Set;


public final class AlarmScheduler {

    private static final String PREFS_NAME          = "alarm_scheduler_prefs";
    private static final String KEY_ALARM_LIST      = "alarm_list";
    private static final String KEY_ALARM_PREFIX_ID = "alarm_data_";

    private AlarmScheduler() { }

    public static void scheduleAlarm(Context context, int alarmId, long triggerAtMs) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        Intent triggerIntent = new Intent(context, AlarmReceiver.class);
        triggerIntent.putExtra("alarmId", alarmId);
        triggerIntent.setAction("ALARM_TRIGGER_" + alarmId);

        PendingIntent operation = PendingIntent.getBroadcast(
                context,
                alarmId,
                triggerIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent showIntent = new Intent(context, MainActivity.class);
        showIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent showOperation = PendingIntent.getActivity(
                context,
                alarmId,
                showIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        AlarmManager.AlarmClockInfo alarmClockInfo =
                new AlarmManager.AlarmClockInfo(triggerAtMs, showOperation);

        alarmManager.setAlarmClock(alarmClockInfo, operation);
        persistAlarm(context, alarmId, triggerAtMs);
    }

    public static void cancelAlarm(Context context, int alarmId) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction("ALARM_TRIGGER_" + alarmId);

        PendingIntent operation = PendingIntent.getBroadcast(
                context,
                alarmId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        alarmManager.cancel(operation);
        operation.cancel();
        removePersistedAlarm(context, alarmId);
    }

    /**
     * Shared helper: recalculate the next valid trigger time for every
     * active repeating alarm, persist it, and schedule it if it is
     * still in the future.  Used by boot restore, pending-schedule
     * processing, and permission-return handling.
     */
    public static void rescheduleActiveRepeatingAlarms(Context context) {
        java.util.List<AlarmData> allAlarms = AlarmData.loadAll(context);
        int scheduledCount = 0;
        int skippedCount = 0;
        for (AlarmData alarm : allAlarms) {
            if (!alarm.active) {
                android.util.Log.d("AlarmScheduler", "rescheduleActiveRepeatingAlarms: skipping inactive alarm " + alarm.id);
                skippedCount++;
                continue;
            }

            long nextMs = AlarmData.computeNextTriggerMs(alarm);

            if (nextMs == Long.MAX_VALUE) {
                android.util.Log.w("AlarmScheduler", "rescheduleActiveRepeatingAlarms: skipping alarm " + alarm.id
                        + " -- computeNextTriggerMs returned MAX_VALUE (invalid time or no active days)");
                skippedCount++;
                continue;
            }

            // Persist the recalculated next trigger time
            AlarmData updated = new AlarmData(
                alarm.id, alarm.time, alarm.label, alarm.active,
                alarm.days, alarm.sound, nextMs
            );
            AlarmData.save(context, updated);

            if (nextMs > System.currentTimeMillis()) {
                scheduleAlarm(context, alarm.id, nextMs);
                scheduledCount++;
            } else {
                android.util.Log.d("AlarmScheduler", "rescheduleActiveRepeatingAlarms: alarm " + alarm.id
                        + " next trigger " + nextMs + " is in the past, not scheduling");
                skippedCount++;
            }
        }
        android.util.Log.d("AlarmScheduler", "rescheduleActiveRepeatingAlarms: scheduled=" + scheduledCount
                + " skipped=" + skippedCount + " total=" + allAlarms.size());
    }

    /**
     * Boot-time restore -- delegates to the shared helper so there is
     * only one code path for recalculating and rescheduling repeating alarms.
     */
    public static void rescheduleAllOnBoot(Context context) {
        android.util.Log.i("AlarmScheduler", "rescheduleAllOnBoot: delegating to rescheduleActiveRepeatingAlarms");
        rescheduleActiveRepeatingAlarms(context);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static void persistAlarm(Context context, int alarmId, long triggerAtMs) {
        SharedPreferences sp = prefs(context);
        Set<String> ids = sp.getStringSet(KEY_ALARM_LIST, new HashSet<>());
        Set<String> mutable = new HashSet<>(ids);
        mutable.add(String.valueOf(alarmId));
        sp.edit()
                .putStringSet(KEY_ALARM_LIST, mutable)
                .putLong(KEY_ALARM_PREFIX_ID + alarmId, triggerAtMs)
                .apply();
    }

    private static void removePersistedAlarm(Context context, int alarmId) {
        SharedPreferences sp = prefs(context);
        Set<String> ids = sp.getStringSet(KEY_ALARM_LIST, new HashSet<>());
        Set<String> mutable = new HashSet<>(ids);
        mutable.remove(String.valueOf(alarmId));
        sp.edit()
                .putStringSet(KEY_ALARM_LIST, mutable)
                .remove(KEY_ALARM_PREFIX_ID + alarmId)
                .apply();
    }

    public static boolean canScheduleExactAlarms(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            return am != null && am.canScheduleExactAlarms();
        }
        return true;
    }
}
