package com.opencode.plusplus.embedded;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

@CapacitorPlugin(name = "EmbeddedServer")
public class EmbeddedServerPlugin extends Plugin {
    private static final String BASE = "http://127.0.0.1:4096";
    private static EmbeddedServerPlugin plugin;

    @Override
    public void load() {
        plugin = this;
    }

    @PluginMethod
    public void start(PluginCall call) {
        Intent i = new Intent(getContext(), NodeServerService.class);
        i.setAction(NodeServerService.ACTION_START);
        getContext().startForegroundService(i);
        waitReady(call);
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

    /** Polls /api/info with the generated credentials until 200 (401 = up too, per spec). */
    private void waitReady(PluginCall call) {
        new Thread(() -> {
            long deadline = System.currentTimeMillis() + 30000;
            while (System.currentTimeMillis() < deadline) {
                String err = probe();
                if (err == null) {
                    NodeServerService.markReady();
                    onState("ready", null);
                    call.resolve(info());
                    return;
                }
                if ("failed".equals(NodeServerService.currentState())) {
                    call.reject("embedded server failed: " + err);
                    return;
                }
                try { Thread.sleep(400); } catch (InterruptedException ignored) {}
            }
            call.reject("embedded server did not become ready in 30s: " + probe());
        }, "embedded-ready").start();
    }

    /** @return null when the server answered 200 or 401, otherwise the error. */
    private String probe() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(BASE + "/api/info").openConnection();
            String pw = NodeServerService.currentPassword();
            if (pw != null) {
                String cred = "opencode:" + pw;
                String b64 = Base64.getEncoder().encodeToString(cred.getBytes(StandardCharsets.UTF_8));
                c.setRequestProperty("Authorization", "Basic " + b64);
            }
            c.setConnectTimeout(1000);
            c.setReadTimeout(1000);
            int code = c.getResponseCode();
            return (code == 200 || code == 401) ? null : "http " + code;
        } catch (Exception e) {
            return String.valueOf(e);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private JSObject info() {
        JSObject r = new JSObject();
        r.put("url", BASE);
        r.put("username", "opencode");
        r.put("password", NodeServerService.currentPassword());
        r.put("state", NodeServerService.currentState());
        return r;
    }

    static void onState(String state, String error) {
        EmbeddedServerPlugin p = plugin;
        if (p == null) return;
        JSObject r = new JSObject();
        r.put("url", BASE);
        r.put("username", "opencode");
        r.put("state", state);
        if (error != null) r.put("error", error);
        p.notifyListeners("state", r);
    }
}
