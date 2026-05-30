package com.harsh.alarmapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

public class AlarmReceiver extends BroadcastReceiver {

    private static final String ACTION_STOP_ALARM = "STOP_ALARM";
    private static final String ACTION_PERMISSION_CHANGED =
            "android.intent.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED";

    private static PowerManager.WakeLock sStaticWakeLock;

    public static synchronized void acquireStaticWakeLock(Context context) {
        if (sStaticWakeLock == null) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                sStaticWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AlarmApp:StaticReceiverWakelock");
                sStaticWakeLock.setReferenceCounted(false);
            }
        }
        if (sStaticWakeLock != null) {
            sStaticWakeLock.acquire(60_000L);
        }
    }

    public static synchronized void releaseStaticWakeLock() {
        if (sStaticWakeLock != null && sStaticWakeLock.isHeld()) {
            try {
                sStaticWakeLock.release();
            } catch (Exception ignored) { }
            sStaticWakeLock = null;
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;

        // -- Stop alarm ----------------------------------------
        if (ACTION_STOP_ALARM.equals(action)) {
            Intent stopService = new Intent(context, AlarmService.class);
            context.stopService(stopService);
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(AlarmService.NOTIFICATION_ID);
            return;
        }

        // -- Exact-alarm permission changed (user toggled in Settings) --
        // Do NOT treat this as an alarm trigger -- just reschedule any
        // pending alarms that were deferred for lack of permission.
        if (ACTION_PERMISSION_CHANGED.equals(action)) {
            if (AlarmScheduler.canScheduleExactAlarms(context)) {
                android.util.Log.i("AlarmReceiver", "Permission changed -- rescheduling active repeating alarms");
                AlarmScheduler.rescheduleActiveRepeatingAlarms(context);
            } else {
                android.util.Log.w("AlarmReceiver", "Permission changed broadcast received but permission is still denied");
            }
            return;
        }

        // -- Validate that this is a real alarm trigger ---------
        // Only ALARM_TRIGGER_* intents from AlarmScheduler with a valid
        // alarmId should proceed to acquire resources and start the service.
        if (!action.startsWith("ALARM_TRIGGER_")) {
            android.util.Log.w("AlarmReceiver", "Ignoring unknown action: " + action);
            return;
        }
        int alarmId = intent.getIntExtra("alarmId", -1);
        if (alarmId == -1) {
            android.util.Log.w("AlarmReceiver", "Ignoring trigger with missing alarmId for action: " + action);
            return;
        }

        // -- Acquire wake lock -----------------------------------
        acquireStaticWakeLock(context);

        // -- Schedule next occurrence for repeating alarms --------
        // Do this BEFORE starting the service so it's scheduled even
        // if the foreground service has issues on some OEMs.
        AlarmData.rescheduleNext(context, alarmId);

        // -- Heads-up notification ---------------------------------
        postHeadsUpNotification(context, alarmId);

        // -- Start foreground service ------------------------------
        Intent serviceIntent = new Intent(context, AlarmService.class);
        serviceIntent.putExtra("alarmId", alarmId);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } catch (Exception e) {
            e.printStackTrace();
            releaseStaticWakeLock();
        }
    }

    private static final String CHANNEL_ID = "alarm_immediate_channel";

    private static void postHeadsUpNotification(Context context, int alarmId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Alarm Alerts", NotificationManager.IMPORTANCE_HIGH
            );
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setSound(null, null);
            channel.enableVibration(true);
            nm.createNotificationChannel(channel);

            Intent fullScreenIntent = new Intent(context, MainActivity.class);
            fullScreenIntent.putExtra("isAlarmTrigger", true);
            fullScreenIntent.putExtra("alarmId", alarmId);
            fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

            PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                    context, alarmId != -1 ? alarmId : 0, fullScreenIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("Alarm")
                    .setContentText("Tap to open")
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setFullScreenIntent(fullScreenPendingIntent, true)
                    .setAutoCancel(false)
                    .setOngoing(true)
                    .build();

            nm.notify(AlarmService.NOTIFICATION_ID, notification);
        }
    }
}
