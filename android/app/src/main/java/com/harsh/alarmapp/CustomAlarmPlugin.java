package com.harsh.alarmapp;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

@CapacitorPlugin(name = "CustomAlarm")
public class CustomAlarmPlugin extends Plugin {

    public static CustomAlarmPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void getActiveAlarm(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("active", AlarmService.isRunning);
        ret.put("alarmId", AlarmService.activeAlarmId);
        call.resolve(ret);
    }

    public void emitAlarmEvent(String eventName, JSObject data) {
        notifyListeners(eventName, data);
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        getContext().stopService(new Intent(getContext(), AlarmService.class));
        call.resolve();
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        Context context = getContext();
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        boolean exactGranted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (alarmManager != null) {
                exactGranted = alarmManager.canScheduleExactAlarms();
            }
        }
        JSObject ret = new JSObject();
        ret.put("exactAlarmGranted", exactGranted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestExactAlarmPermission(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager != null && !alarmManager.canScheduleExactAlarms()) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                    intent.setData(Uri.parse("package:" + context.getPackageName()));
                    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        Integer id = call.getInt("id");
        Long time = call.getLong("time");

        if (id == null || time == null) {
            call.reject("Must provide an id and a time");
            return;
        }

        Context context = getContext();

        // Parse extended alarm data (label, days, sound) for native persistence
        String label = call.getString("label", "Alarm");
        boolean active = call.getBoolean("active", true);
        String sound = call.getString("sound", "classic");

        int[] days;
        try {
            JSONArray daysArr = new JSONArray(call.getArray("days"));
            days = new int[daysArr.length()];
            for (int i = 0; i < daysArr.length(); i++) days[i] = daysArr.optInt(i);
        } catch (Exception e) {
            days = new int[]{0, 1, 2, 3, 4, 5, 6};
        }

        // Persist full alarm data natively
        AlarmData alarmData = new AlarmData(id, call.getString("time", "00:00"), label,
                active, days, sound, time);
        AlarmData.save(context, alarmData);

        if (!AlarmScheduler.canScheduleExactAlarms(context)) {
            // Permission missing — save as pending; the schedule will be
            // processed once the user grants permission (see MainActivity.onResume).
            call.resolve();
            return;
        }

        AlarmScheduler.scheduleAlarm(context, id, time);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null) {
            call.reject("Must provide an id");
            return;
        }
        AlarmScheduler.cancelAlarm(getContext(), id);
        AlarmData.remove(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void getNextNativeAlarm(PluginCall call) {
        Context context = getContext();
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        JSObject ret = new JSObject();
        ret.put("exists", false);
        ret.put("triggerTime", 0L);
        ret.put("showIntentPackage", "");

        if (alarmManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            AlarmManager.AlarmClockInfo info = alarmManager.getNextAlarmClock();
            if (info != null) {
                ret.put("exists", true);
                ret.put("triggerTime", info.getTriggerTime());
                PendingIntent showIntent = info.getShowIntent();
                if (showIntent != null) {
                    ret.put("showIntentPackage", showIntent.getCreatorPackage());
                }
            }
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void checkFullScreenPermission(PluginCall call) {
        Context context = getContext();
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) granted = nm.canUseFullScreenIntent();
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestFullScreenIntentPermission(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && !nm.canUseFullScreenIntent()) {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                    intent.setData(Uri.parse("package:" + context.getPackageName()));
                    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                } catch (Exception e) { e.printStackTrace(); }
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void checkIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        boolean ignoring = pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(context.getPackageName())) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } catch (Exception e) { e.printStackTrace(); }
        }
        call.resolve();
    }

    @PluginMethod
    public void openAutoStartSettings(PluginCall call) {
        Context context = getContext();
        try {
            Intent intent = new Intent();
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            String manufacturer = Build.MANUFACTURER.toLowerCase();
            if (manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco")) {
                intent.setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
            } else if (manufacturer.contains("oppo")) {
                intent.setComponent(new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"));
            } else if (manufacturer.contains("vivo")) {
                intent.setComponent(new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"));
            } else if (manufacturer.contains("samsung")) {
                intent.setComponent(new ComponentName("com.samsung.android.sm_cn", "com.samsung.android.sm.ui.ram.AutoRunActivity"));
            } else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
                intent.setComponent(new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
            } else {
                Intent appSettingsIntent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                appSettingsIntent.setData(Uri.parse("package:" + context.getPackageName()));
                appSettingsIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(appSettingsIntent);
                call.resolve();
                return;
            }
            context.startActivity(intent);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + context.getPackageName()));
                fallback.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(fallback);
            } catch (Exception ex) { ex.printStackTrace(); }
        }
        call.resolve();
    }
}
