package com.tsogs.mtbilling;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupEdgeToEdge();
    }

    /**
     * Enable edge-to-edge rendering so the React app can draw behind the status
     * bar and navigation bar. Safe-area-inset CSS variables handle the offsets.
     */
    private void setupEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            //noinspection deprecation
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }

        // Transparent bars — the web shell draws its own chrome.
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        }
    }

    @Override
    public void onBackPressed() {
        // If the Capacitor bridge WebView can navigate back, do so.
        // Otherwise fall through to default back-press (exit / background).
        if (this.bridge != null) {
            if (this.bridge.getWebView().canGoBack()) {
                this.bridge.getWebView().goBack();
                return;
            }
        }
        super.onBackPressed();
    }
}
