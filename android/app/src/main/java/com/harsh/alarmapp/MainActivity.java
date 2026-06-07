package com.harsh.alarmapp;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

import java.util.List;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Modern approach: Activity methods instead of deprecated Window flags
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }

        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );

        registerPlugin(CustomAlarmPlugin.class);

        // Check for pending schedules (user may have just granted permission)
        processPendingSchedules();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getBooleanExtra("isAlarmTrigger", false)) {
            int alarmId = intent.getIntExtra("alarmId", -1);
            if (CustomAlarmPlugin.instance != null) {
                JSObject data = new JSObject();
                data.put("alarmId", alarmId);
                CustomAlarmPlugin.instance.emitAlarmEvent("alarmTriggered", data);
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();

        // Process any pending schedules (e.g. after returning from permission settings)
        processPendingSchedules();

        Intent intent = getIntent();
        if (intent != null && intent.getBooleanExtra("isAlarmTrigger", false)) {
            int alarmId = intent.getIntExtra("alarmId", -1);
            if (CustomAlarmPlugin.instance != null) {
                JSObject data = new JSObject();
                data.put("alarmId", alarmId);
                CustomAlarmPlugin.instance.emitAlarmEvent("alarmTriggered", data);
            }
            intent.removeExtra("isAlarmTrigger");
        }
    }

    /**
     * Process any alarms that were deferred because exact-alarm permission
     * was missing at schedule time.  Delegates to the shared recalculation
     * helper so that every deferred alarm gets a fresh next-trigger-time
     * computed from its day-of-week schedule rather than using a possibly
     * stale nextTriggerMs.
     */
    private void processPendingSchedules() {
        if (!AlarmScheduler.canScheduleExactAlarms(this)) return;

        android.util.Log.i("MainActivity", "processPendingSchedules: delegating to rescheduleActiveRepeatingAlarms");
        AlarmScheduler.rescheduleActiveRepeatingAlarms(this);
    }
}

