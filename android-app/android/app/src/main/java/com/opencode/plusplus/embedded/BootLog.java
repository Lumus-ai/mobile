package com.opencode.plusplus.embedded;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Crash-surviving boot log shared by the UI and :node processes. Every line
 * is appended and fsynced immediately, so the last line before a native abort
 * is always on disk. Read back by the debug self-test via the plugin.
 */
final class BootLog {
    private static final String FILE = "embedded-server-boot.log";
    private static final long MAX = 256 * 1024;
    private static final Object LOCK = new Object();

    private BootLog() {}

    static void log(File filesDir, String step) {
        synchronized (LOCK) {
            try {
                File f = new File(filesDir, FILE);
                if (f.length() > MAX) truncate(f);
                String line = new SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US).format(new Date())
                        + " [" + android.os.Process.myPid() + "] " + Redact.apply(step) + "\n";
                try (FileOutputStream out = new FileOutputStream(f, true)) {
                    out.write(line.getBytes(StandardCharsets.UTF_8));
                    out.getFD().sync();
                }
            } catch (Throwable ignored) {
            }
        }
    }

    private static void truncate(File f) {
        try {
            byte[] all = java.nio.file.Files.readAllBytes(f.toPath());
            int keep = all.length / 2;
            try (FileOutputStream out = new FileOutputStream(f, false)) {
                out.write("...(older boot log truncated)...\n".getBytes(StandardCharsets.UTF_8));
                out.write(all, all.length - keep, keep);
            }
        } catch (IOException ignored) {
        }
    }
}
