package com.harsh.alarmapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
/**
 * Listens for {@link Intent#ACTION_BOOT_COMPLETED} and re-registers all
 * active alarms that were persisted by {@link AlarmScheduler}.
 *
 * Without this receiver a user would lose every alarm if the phone reboots
 * in the middle of the night (or at any time the WebView / JS layer is not
 * running).
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        android.util.Log.i("BootReceiver", "onReceive: action=" + action);

        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) ||
            Intent.ACTION_TIME_CHANGED.equals(action) ||
            "android.intent.action.TIME_SET".equals(action) ||
            Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            
            // Re-register/re-calculate all persisted alarms.
            AlarmScheduler.rescheduleActiveRepeatingAlarms(context);
        }
    }
}
