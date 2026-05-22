package com.harsh.alarmapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;

public class AlarmAudioService extends Service {
    public static boolean isRunning = false;
    public static int activeAlarmId = -1;

    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "AlarmApp:AudioServiceWakeLock");
            wakeLock.acquire();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            activeAlarmId = intent.getIntExtra("alarmId", -1);
        }
        isRunning = true;

        if (CustomAlarmPlugin.instance != null) {
            JSObject data = new JSObject();
            data.put("alarmId", activeAlarmId);
            CustomAlarmPlugin.instance.emitAlarmEvent("alarmTriggered", data);
        }

        acquireWakeLock();
        startVibration();
        startForegroundNotification();

        return START_STICKY;
    }

    private void startVibration() {
        if (vibrator == null) {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null) {
                long[] pattern = {0, 500, 500};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        }
    }

    private void startForegroundNotification() {
        String channelId = "custom_alarm_audio_channel";
        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                channelId,
                "Alarm Audio Service",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setSound(null, null);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }

        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.putExtra("isAlarmTrigger", true);
        fullScreenIntent.putExtra("alarmId", activeAlarmId);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            (activeAlarmId != -1 ? activeAlarmId : 0),
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, CustomAlarmReceiver.class);
        stopIntent.setAction("STOP_ALARM");
        PendingIntent stopPendingIntent = PendingIntent.getBroadcast(
            this,
            0,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Alarm Ringing!")
            .setContentText("Tap to open or stop")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop Alarm", stopPendingIntent);

        Notification notification = builder.build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    startForeground(999, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                } catch (Exception e) {
                    startForeground(999, notification);
                }
            } else {
                try {
                    startForeground(999, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } catch (Exception e) {
                    startForeground(999, notification);
                }
            }
        } else {
            startForeground(999, notification);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isRunning = false;
        activeAlarmId = -1;

        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception e) {
                e.printStackTrace();
            }
            vibrator = null;
        }

        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception e) {
                e.printStackTrace();
            }
            wakeLock = null;
        }
    }
}
