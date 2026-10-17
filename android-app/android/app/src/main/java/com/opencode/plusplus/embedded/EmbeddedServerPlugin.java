package com.opencode.plusplus.embedded;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;

/**
 * UI-process side of the embedded server. The server itself runs in the
 * :node process (see NodeServerService) so a native crash there can never
 * take the app UI down; all state crosses via filesDir/embedded-server-state.json.
 */
@CapacitorPlugin(name = "EmbeddedServer")
public class EmbeddedServerPlugin extends Plugin {
    private static final String BASE = "http://127.0.0.1:4096";

    @PluginMethod
    public void start(PluginCall call) {
        BootLog.log(getContext().getFilesDir(), "plugin: ACTION_START issued");
        Intent i = new Intent(getContext(), NodeServerService.class);
        i.setAction(NodeServerService.ACTION_START);
        getContext().startForegroundService(i);
        waitReady(call);
    }

    /**
     * Self-test "try all Node start ways": hands the :node service a variant
     * plan (see NodeServerService). Resolves immediately; poll debugInfo for
     * variantResults/variantState while the plan runs (each variant runs in a
     * fresh process — the service kills and restarts itself between them).
     */
    @PluginMethod
    public void runNodeVariants(PluginCall call) {
        BootLog.log(getContext().getFilesDir(), "plugin: RUN_VARIANTS issued");
        Intent i = new Intent(getContext(), NodeServerService.class);
        i.setAction(NodeServerService.ACTION_RUN_VARIANTS);
        i.putExtra("planId", String.valueOf(System.currentTimeMillis()));
        getContext().startForegroundService(i);
        JSObject r = new JSObject();
        r.put("started", true);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent i = new Intent(getContext(), NodeServerService.class);
        i.setAction(NodeServerService.ACTION_STOP);
        getContext().startService(i);
        JSObject r = new JSObject();
        r.put("state", "stopped");
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(info());
    }

    /**
     * Redaction fixture test for the self-test: a fake state string carrying a
     * secret must come back with the secret scrubbed. leaks=false = pass.
     */
    @PluginMethod
    public void redactSelfTest(PluginCall call) {
        String secret = "FXSECRET-aa11bb22cc33";
        String fixture = "{\"state\":\"ready\",\"ts\":1729000000000,\"password\":\"" + secret + "\"}"
                + " token=" + secret + " Authorization: Basic YWFhYWFhYmJiYg=="
                + " path=/data/data/com.opencode.plusplus/files";
        Redact.registerSecret(secret);
        String out = Redact.apply(fixture);
        JSObject r = new JSObject();
        r.put("leaks", out.contains(secret) || out.contains("YWFhYWFhYmJiYg=="));
        r.put("keepsContext", out.contains("\"state\":\"ready\"") && out.contains("1729000000000") && out.contains("/data/data/com.opencode.plusplus/files"));
        r.put("sample", out);
        call.resolve(r);
    }

    /** Raw diagnostics for the self-test: the cross-process state file + node log tail. */
    @PluginMethod
    public void debugInfo(PluginCall call) {
        JSObject r = new JSObject();
        try {
            File sf = new File(getContext().getFilesDir(), NodeServerService.STATE_FILE);
            r.put("stateFile", Redact.apply(sf.exists() ? new String(Files.readAllBytes(sf.toPath()), StandardCharsets.UTF_8) : "(missing)"));
        } catch (Exception e) {
            r.put("stateFile", "read error: " + e);
        }
        try {
            File log = new File(new File(getContext().getFilesDir(), "opencode-config"), "server.log");
            if (log.exists()) {
                String body = new String(Files.readAllBytes(log.toPath()), StandardCharsets.UTF_8);
                r.put("logTail", Redact.apply(body.length() > 4000 ? body.substring(body.length() - 4000) : body));
            } else {
                r.put("logTail", "(no server.log yet)");
            }
        } catch (Exception e) {
            r.put("logTail", "read error: " + e);
        }
        r.put("bootLog", Redact.apply(tail(new File(getContext().getFilesDir(), "embedded-server-boot.log"), 4000, "(no boot log yet)")));
        r.put("fetchProbe", Redact.apply(tail(new File(getContext().getFilesDir(), "fetch-probe.json"), 4000, "(none)")));
        r.put("variantResults", Redact.apply(tail(new File(getContext().getFilesDir(), "variant-results.jsonl"), 8000, "(none)")));
        try {
            File cur = new File(getContext().getFilesDir(), "variant-current.txt");
            File rem = new File(getContext().getFilesDir(), "variant-remaining.txt");
            if (cur.exists() || rem.exists()) {
                r.put("variantState", "current=" + (cur.exists() ? new String(Files.readAllBytes(cur.toPath()), StandardCharsets.UTF_8) : "-")
                        + " remaining=" + (rem.exists() ? new String(Files.readAllBytes(rem.toPath()), StandardCharsets.UTF_8) : "-"));
            } else {
                r.put("variantState", "(none)");
            }
        } catch (Exception e) {
            r.put("variantState", "read error: " + e);
        }
        call.resolve(r);
    }

    private static String tail(File f, int max, String empty) {
        try {
            if (!f.exists()) return empty;
            String body = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
            return body.length() > max ? body.substring(body.length() - max) : body;
        } catch (Exception e) {
            return "read error: " + e;
        }
    }

    /** Device/App facts for the on-device debug self-test report. */
    /** The WebView fetch probe (see embedded.ts) lands here for the self-test and CI. */
    @PluginMethod
    public void writeFetchProbe(PluginCall call) {
        try {
            String json = call.getString("json", "{}");
            File f = new File(getContext().getFilesDir(), "fetch-probe.json");
            Files.write(f.toPath(), json.getBytes(StandardCharsets.UTF_8));
            JSObject r = new JSObject();
            r.put("written", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("writeFetchProbe failed: " + e);
        }
    }

    @PluginMethod
    public void deviceInfo(PluginCall call) {
        JSObject r = new JSObject();
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            r.put("versionName", pi.versionName);
            r.put("versionCode", pi.getLongVersionCode());
        } catch (Exception e) {
            r.put("versionName", "unknown");
            r.put("versionCode", -1);
        }
        r.put("sdkInt", Build.VERSION.SDK_INT);
        r.put("release", Build.VERSION.RELEASE);
        r.put("abis", String.join(",", Build.SUPPORTED_ABIS));
        r.put("device", Build.MANUFACTURER + " " + Build.MODEL);
        long pages = -1;
        try {
            pages = android.system.Os.sysconf(android.system.OsConstants._SC_PAGESIZE);
        } catch (Throwable ignored) {
        }
        r.put("pageSizeBytes", pages);
        call.resolve(r);
    }

    /** Waits for the :node service to publish a fresh "ready" state, then confirms over HTTP. */
    private void waitReady(PluginCall call) {
        new Thread(() -> {
            long t0 = System.currentTimeMillis();
            long deadline = t0 + 45000;
            String lastSeen = "no state from service yet";
            while (System.currentTimeMillis() < deadline) {
                StateFile sf = readState();
                if (sf != null) {
                    lastSeen = "state=" + sf.state + (sf.error != null ? " error=" + sf.error : "");
                    if ("failed".equals(sf.state) && sf.ts >= t0 - 5000) {
                        call.reject("embedded server failed: " + sf.error);
                        return;
                    }
                    if ("ready".equals(sf.state) && sf.password != null && probe(sf.password)) {
                        call.resolve(info());
                        return;
                    }
                }
                try { Thread.sleep(400); } catch (InterruptedException ignored) {}
            }
            call.reject("embedded server did not become ready in 45s (" + lastSeen + ")");
        }, "embedded-ready").start();
    }

    private boolean probe(String password) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(BASE + "/api/info").openConnection();
            String b64 = Base64.getEncoder()
                    .encodeToString(("opencode:" + password).getBytes(StandardCharsets.UTF_8));
            c.setRequestProperty("Authorization", "Basic " + b64);
            c.setConnectTimeout(1000);
            c.setReadTimeout(1000);
            return c.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static class StateFile {
        String state;
        String password;
        String error;
        long ts;
    }

    private StateFile readState() {
        try {
            File f = new File(getContext().getFilesDir(), NodeServerService.STATE_FILE);
            if (!f.exists()) return null;
            String body = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
            StateFile sf = new StateFile();
            sf.state = extractString(body, "state");
            sf.password = extractString(body, "password");
            sf.error = extractString(body, "error");
            sf.ts = extractLong(body, "ts");
            return sf.state == null ? null : sf;
        } catch (Exception e) {
            return null;
        }
    }

    private static String extractString(String json, String key) {
        int i = json.indexOf("\"" + key + "\":\"");
        if (i < 0) return null;
        int j = i + key.length() + 4;
        StringBuilder b = new StringBuilder();
        while (j < json.length()) {
            char c = json.charAt(j++);
            if (c == '\\' && j < json.length()) {
                char n = json.charAt(j++);
                b.append(n == 'n' ? '\n' : n == 'r' ? '\r' : n);
            } else if (c == '"') {
                return b.toString();
            } else {
                b.append(c);
            }
        }
        return null;
    }

    private static long extractLong(String json, String key) {
        int i = json.indexOf("\"" + key + "\":");
        if (i < 0) return 0;
        int j = i + key.length() + 3;
        int k = j;
        while (k < json.length() && (Character.isDigit(json.charAt(k)) || json.charAt(k) == '-')) k++;
        try {
            return Long.parseLong(json.substring(j, k));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private JSObject info() {
        StateFile sf = readState();
        JSObject r = new JSObject();
        r.put("url", BASE);
        r.put("projectsDir", projectsDir());
        r.put("username", "opencode");
        r.put("password", sf != null ? sf.password : null);
        r.put("state", sf != null ? sf.state : "unknown");
        if (sf != null && sf.error != null) r.put("error", sf.error);
        return r;
    }

    private String projectsDir() {
        File d = new File(getContext().getFilesDir(), "projects");
        d.mkdirs();
        return d.getAbsolutePath();
    }
}
