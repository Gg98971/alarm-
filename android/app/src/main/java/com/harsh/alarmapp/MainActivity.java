package com.harsh.alarmapp;

import android.content.Intent;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Force screen on and show over lock screen
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );
        
        registerPlugin(CustomAlarmPlugin.class);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getBooleanExtra("isAlarmTrigger", false)) {
            int alarmId = intent.getIntExtra("alarmId", -1);
            if (CustomAlarmPlugin.instance != null) {
                com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
                data.put("alarmId", alarmId);
                CustomAlarmPlugin.instance.notifyListeners("alarmTriggered", data);
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        Intent intent = getIntent();
        if (intent != null && intent.getBooleanExtra("isAlarmTrigger", false)) {
            int alarmId = intent.getIntExtra("alarmId", -1);
            if (CustomAlarmPlugin.instance != null) {
                com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
                data.put("alarmId", alarmId);
                CustomAlarmPlugin.instance.notifyListeners("alarmTriggered", data);
            }
            intent.removeExtra("isAlarmTrigger");
        }
    }
}

