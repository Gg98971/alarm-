package com.harsh.alarmapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;

public class AlarmService extends Service {

    public static final int NOTIFICATION_ID = 999;
    private static final String CHANNEL_ID = "alarm_service_channel";

    public static volatile boolean isRunning = false;
    public static volatile int activeAlarmId = -1;

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            activeAlarmId = intent.getIntExtra("alarmId", activeAlarmId);
        }
        isRunning = true;

        if (CustomAlarmPlugin.instance != null) {
            JSObject data = new JSObject();
            data.put("alarmId", activeAlarmId);
            CustomAlarmPlugin.instance.emitAlarmEvent("alarmTriggered", data);
        }

        startForegroundNotification();
        startAlarmSound();
        startVibration();

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isRunning = false;
        activeAlarmId = -1;
        releaseMediaPlayer();
        releaseVibrator();
        releaseWakeLock();
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "AlarmApp:AlarmServiceWakeLock"
        );
        wakeLock.acquire(10 * 60 * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) { }
            wakeLock = null;
        }
    }

    private void startAlarmSound() {
        if (mediaPlayer != null) return;
        try {
            Uri alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alarmUri == null) alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (alarmUri == null) return;

            mediaPlayer = new MediaPlayer();
            mediaPlayer.setDataSource(this, alarmUri);
            mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build());
            mediaPlayer.setLooping(true);
            mediaPlayer.prepare();
            mediaPlayer.start();
        } catch (Exception e) { e.printStackTrace(); }
    }

    private void releaseMediaPlayer() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.release();
            } catch (Exception ignored) { }
            mediaPlayer = null;
        }
    }

    private void startVibration() {
        if (vibrator != null) return;
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null) return;
        long[] pattern = {0, 500, 500};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } else {
            vibrator.vibrate(pattern, 0);
        }
    }

    private void releaseVibrator() {
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) { }
            vibrator = null;
        }
    }

    private void startForegroundNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Alarm Service", NotificationManager.IMPORTANCE_HIGH
            );
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setSound(null, null);
            channel.enableVibration(true);
            if (nm != null) nm.createNotificationChannel(channel);
        }

        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.putExtra("isAlarmTrigger", true);
        fullScreenIntent.putExtra("alarmId", activeAlarmId);
        fullScreenIntent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
        );

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                this,
                activeAlarmId != -1 ? activeAlarmId : 0,
                fullScreenIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, AlarmReceiver.class);
        stopIntent.setAction("STOP_ALARM");
        PendingIntent stopPendingIntent = PendingIntent.getBroadcast(
                this, 0, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Alarm Ringing!")
                .setContentText("Tap to open or stop")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop Alarm", stopPendingIntent)
                .build();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            e.printStackTrace();
            // Fallback: start without foreground service type
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) { }
        }
    }
}
