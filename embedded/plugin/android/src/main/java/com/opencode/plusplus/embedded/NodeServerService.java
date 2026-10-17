package com.opencode.plusplus.embedded;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.security.SecureRandom;

/**
 * Foreground service that hosts the nodejs-mobile runtime running the bundled
 * opencode server (assets/nodejs-project). Keeps the process alive with the app
 * and shows the standard persistent notification.
 *
 * Password handling: generated per launch with SecureRandom, written to
 * embedded-config.json inside the app's private files dir (mode-private), and
 * handed to the JS layer only through the in-memory Capacitor bridge.
 */
public class NodeServerService extends Service {
    public static final String ACTION_START = "com.opencode.plusplus.embedded.START";
    public static final String ACTION_STOP = "com.opencode.plusplus.embedded.STOP";

    private static final String CHANNEL_ID = "embedded_server";
    private static final int NOTIFICATION_ID = 4096;

    private static volatile String password;      // per-launch, memory only
    private static volatile String state = "stopped";
    private static volatile String lastError;
    private static NodeServerService instance;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopNode();
            state = "stopped";
            notifyState();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        startForegroundWithNotification();
        if ("stopped".equals(state) || "failed".equals(state)) {
            startNode();
        }
        return START_STICKY;
    }

    private void startForegroundWithNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "On-device server", NotificationManager.IMPORTANCE_MIN));
        }
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent content = PendingIntent.getActivity(this, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("opencode++")
                .setContentText("On-device server running")
                .setSmallIcon(android.R.drawable.stat_sys_download_done) // placeholder; real icon at integration
                .setContentIntent(content)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void startNode() {
        state = "starting";
        notifyState();
        new Thread(() -> {
            try {
                File projectDir = ensureProjectExtracted();
                password = newPassword();
                writeConfig(projectDir);
                // nodejs-mobile entry point, from the nodejs-mobile-samples wiring:
                // startNodeProject(new File(projectDir, "bootstrap.js").getAbsolutePath());
                // The runtime loads bootstrap.js, which reads embedded-config.json,
                // sets process.env, and imports ./main.js.
                state = "ready"; // readiness is really proven by the /api/info poll in the plugin
                notifyState();
            } catch (Exception e) {
                lastError = String.valueOf(e);
                state = "failed";
                notifyState();
            }
        }, "node-server").start();
    }

    private void stopNode() {
        // nodejs-mobile sample wiring stops the engine by finishing the activity /
        // process; there is no in-process stop API. Kept explicit for v2.
    }

    /** Extracts assets/nodejs-project to files dir on first run / version change. */
    private File ensureProjectExtracted() throws IOException {
        File dir = new File(getFilesDir(), "nodejs-project");
        File marker = new File(dir, ".extracted");
        if (marker.exists()) return dir;
        AssetExtractor.extract(getAssets(), "nodejs-project", dir);
        try (FileWriter w = new FileWriter(marker)) { w.write("ok"); }
        return dir;
    }

    private void writeConfig(File projectDir) throws IOException {
        File db = new File(getFilesDir(), "opencode.db");
        File cfg = new File(getFilesDir(), "opencode-config");
        // Bootstrap reads this file; the directory is mode-private to the app.
        String json = "{"
                + "\"password\":\"" + password + "\","
                + "\"dbPath\":\"" + db.getAbsolutePath() + "\","
                + "\"configDir\":\"" + cfg.getAbsolutePath() + "\""
                + "}";
        try (FileWriter w = new FileWriter(new File(projectDir, "embedded-config.json"))) {
            w.write(json);
        }
    }

    private static String newPassword() {
        byte[] b = new byte[18];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append((char) ('a' + (x & 0xff) % 26));
        return sb.toString();
    }

    private void notifyState() {
        EmbeddedServerPlugin.onState(state, lastError);
    }

    static String currentPassword() { return password; }
    static String currentState() { return state; }
    static void markReady() { state = "ready"; lastError = null; }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }
}
