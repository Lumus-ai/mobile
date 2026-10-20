package com.opencode.plusplus.embedded;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Update channel for the alpha app only. Reads a small public version.json, downloads the APK from
 * the public releases repo, checks size/hash/package/version, then shows a notification that opens
 * the system installer. Android itself verifies the signature, so only a build signed with the same
 * alpha key can replace the installed app. Nothing is installed without the user tapping it.
 */
final class AlphaUpdater {
    private static final String VERSION_URL =
            "https://raw.githubusercontent.com/Lumus-ai/mobile-alpha-releases/main/version.json";
    private static final String APK_PREFIX =
            "https://github.com/Lumus-ai/mobile-alpha-releases/releases/download/";
    private static final long EVERY_MS = 6L * 60 * 60 * 1000;
    private static final String CHANNEL = "alpha_update";
    private static final int NOTIFICATION = 4197;
    private static boolean started;

    private AlphaUpdater() {}

    static synchronized void start(final Context app) {
        if (started || !app.getPackageName().endsWith(".alpha")) return;
        started = true;
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                try { Thread.sleep(45_000); } catch (InterruptedException e) { return; }
                while (true) {
                    try {
                        check(app);
                    } catch (Throwable e) {
                        BootLog.log(app.getFilesDir(), "alpha-update: check failed: " + e);
                    }
                    try { Thread.sleep(EVERY_MS); } catch (InterruptedException e) { return; }
                }
            }
        }, "alpha-updater");
        t.setDaemon(true);
        t.start();
    }

    private static long installedBuild(Context c) throws Exception {
        PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
    }

    private static String readText(String url) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(10_000);
        h.setReadTimeout(15_000);
        try (InputStream in = h.getInputStream()) {
            java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0 && o.size() < 64 * 1024) o.write(b, 0, n);
            return o.toString("UTF-8");
        } finally {
            h.disconnect();
        }
    }

    static void check(Context c) throws Exception {
        File dir = c.getFilesDir();
        JSONObject v = new JSONObject(readText(VERSION_URL));
        long build = v.getLong("build");
        long have = installedBuild(c);
        if (build <= have) {
            BootLog.log(dir, "alpha-update: up to date (installed " + have + ", channel " + build + ")");
            return;
        }
        String apk = v.getString("apk");
        String sha = v.getString("sha256").toLowerCase();
        if (!apk.startsWith(APK_PREFIX)) throw new IllegalStateException("unexpected apk url");
        File out = new File(c.getCacheDir(), "alpha-update-" + build + ".apk");
        if (!out.exists() || !sha.equals(sha256(out))) {
            File tmp = new File(c.getCacheDir(), "alpha-update.part");
            HttpURLConnection h = (HttpURLConnection) new URL(apk).openConnection();
            h.setConnectTimeout(15_000);
            h.setReadTimeout(30_000);
            try (InputStream in = h.getInputStream(); FileOutputStream fo = new FileOutputStream(tmp)) {
                byte[] b = new byte[65536];
                int n;
                while ((n = in.read(b)) > 0) fo.write(b, 0, n);
            } finally {
                h.disconnect();
            }
            if (!sha.equals(sha256(tmp))) {
                tmp.delete();
                throw new IllegalStateException("sha256 mismatch");
            }
            if (!tmp.renameTo(out)) throw new IllegalStateException("cannot move update");
        }
        PackageInfo info = c.getPackageManager().getPackageArchiveInfo(out.getAbsolutePath(), 0);
        if (info == null || !c.getPackageName().equals(info.packageName)) {
            out.delete();
            throw new IllegalStateException("update is not this app");
        }
        long got = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        if (got != build) {
            out.delete();
            throw new IllegalStateException("update version mismatch " + got + " != " + build);
        }
        BootLog.log(dir, "alpha-update: downloaded build " + build + ", notifying");
        notifyReady(c, out, build);
        // Old downloads are useless once a newer one is ready.
        File[] old = c.getCacheDir().listFiles();
        if (old != null) for (File f : old)
            if (f.getName().startsWith("alpha-update-") && f.getName().endsWith(".apk") && !f.equals(out)) f.delete();
    }

    private static String sha256(File f) throws Exception {
        MessageDigest d = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[65536];
            int n;
            while ((n = in.read(b)) > 0) d.update(b, 0, n);
        }
        StringBuilder s = new StringBuilder();
        for (byte x : d.digest()) s.append(String.format("%02x", x));
        return s.toString();
    }

    private static void notifyReady(Context c, File apk, long build) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Alpha updates", NotificationManager.IMPORTANCE_DEFAULT));
        Uri uri = FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent pi = PendingIntent.getActivity(c, 0, i, flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(c.getApplicationInfo().icon)
                .setContentTitle("OpenCode++ alpha update ready")
                .setContentText("Build " + build + ". Tap to install.")
                .setContentIntent(pi)
                .setAutoCancel(true);
        nm.notify(NOTIFICATION, b.build());
    }
}
