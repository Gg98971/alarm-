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

public class CustomAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && "STOP_ALARM".equals(intent.getAction())) {
            context.stopService(new Intent(context, AlarmAudioService.class));
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(999);
            }
            return;
        }

        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            PowerManager.WakeLock wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AlarmApp:ReceiverWakeLock");
            wakeLock.acquire(10000);
        }

        int alarmId = intent != null ? intent.getIntExtra("alarmId", -1) : -1;

        Intent serviceIntent = new Intent(context, AlarmAudioService.class);
        serviceIntent.putExtra("alarmId", alarmId);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }

        Intent fullScreenIntent = new Intent(context, MainActivity.class);
        fullScreenIntent.putExtra("isAlarmTrigger", true);
        fullScreenIntent.putExtra("alarmId", alarmId);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            context.startActivity(fullScreenIntent);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}

