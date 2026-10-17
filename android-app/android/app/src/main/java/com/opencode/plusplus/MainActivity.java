package com.opencode.plusplus;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.opencode.plusplus.embedded.EmbeddedServerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EmbeddedServerPlugin.class);
        clearWebCacheOnUpgrade();
        super.onCreate(savedInstanceState);
    }

    /**
     * The WebView HTTP cache survives upgrades and can serve a stale index.html
     * referencing hashed chunks that no longer exist in the new APK
     * ("Failed to fetch dynamically imported module"). Clear it once per
     * version change.
     */
    private void clearWebCacheOnUpgrade() {
        try {
            android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            long vc = pi.getLongVersionCode();
            android.content.SharedPreferences sp = getSharedPreferences("opencodepp", MODE_PRIVATE);
            if (sp.getLong("versionCode", -1) == vc) return;
            java.io.File webviewCache = new java.io.File(getCacheDir(), "org.chromium.android_webview");
            deleteRecursive(webviewCache);
            sp.edit().putLong("versionCode", vc).apply();
        } catch (Throwable ignored) {
        }
    }

    /**
     * System back button: give the page first shot (close the settings
     * surface etc.) before falling back to the default activity behavior.
     * The page sets window.__APP_BACK_HANDLED__ in its "app-back-button"
     * listener when it consumed the event.
     */
    @Override
    public void onBackPressed() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(
                        "window.__APP_BACK_HANDLED__=false;window.dispatchEvent(new Event('app-back-button'));window.__APP_BACK_HANDLED__?1:0",
                        value -> {
                            if (!"1".equals(value)) {
                                runOnUiThread(() -> MainActivity.super.onBackPressed());
                            }
                        });
                return;
            }
        } catch (Throwable ignored) {
        }
        super.onBackPressed();
    }

    private static void deleteRecursive(java.io.File f) {
        if (f == null || !f.exists()) return;
        java.io.File[] kids = f.listFiles();
        if (kids != null) for (java.io.File k : kids) deleteRecursive(k);
        f.delete();
    }
}
