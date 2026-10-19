package com.opencode.plusplus.embedded;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;

/**
 * Hosts the nodejs-mobile runtime with the bundled opencode server
 * (assets/nodejs-project) in its OWN process (:node, see the manifest).
 * A native abort in node kills only this process; the UI process keeps
 * running and reports the failure through the state file.
 *
 * Cross-process state protocol: every transition is written atomically to
 * filesDir/embedded-server-state.json ({state,password,error,ts}); the
 * Capacitor plugin in the UI process reads that file (statics do not cross
 * process boundaries).
 *
 * Every boot step is appended to filesDir/embedded-server-boot.log (fsynced
 * per line) so the last reached step survives a native abort.
 *
 * Diagnostic variant runs (ACTION_RUN_VARIANTS): node cannot be started
 * twice in one process, so each variant runs in a fresh process: the plan
 * lives in variant-current.txt/variant-remaining.txt, the variant pops on
 * completion, and the process kills itself; the sticky restart picks up the
 * next variant. A variant that was "current" with no recorded result after
 * a restart died mid-attempt (native crash) and is recorded as such.
 */
public class NodeServerService extends Service {
    public static final String ACTION_START = "com.opencode.plusplus.embedded.START";
    public static final String ACTION_STOP = "com.opencode.plusplus.embedded.STOP";
    public static final String ACTION_RUN_VARIANTS = "com.opencode.plusplus.embedded.RUN_VARIANTS";

    private static final String CHANNEL_ID = "embedded_server";
    private static final int NOTIFICATION_ID = 4096;
    static final String STATE_FILE = "embedded-server-state.json";
    private static final String GUARD_FILE = "embedded-crash-guard.json";
    private static final String PLAN_ID_FILE = "variant-plan-id.txt";
    private static final String PLAN_CUR_FILE = "variant-current.txt";
    private static final String PLAN_REM_FILE = "variant-remaining.txt";
    private static final String RESULTS_FILE = "variant-results.jsonl";
    private static final String VERSION_FILE = "embedded-version.txt";
    /** A plan older than this is considered orphaned (v13.9 got stuck in one) — auto-reset. */
    private static final long PLAN_STALE_MS = 10 * 60 * 1000;
    /** Hard cap per variant attempt. */
    private static final long VARIANT_TIMEOUT_MS = 60000;

    private static final List<String> ALL_VARIANTS =
            Arrays.asList("icu-probe", "eval-hello", "eval-listen", "require-bootstrap", "fresh-normal");

    private static volatile boolean nodeThreadRunning = false;
    private static volatile boolean nativeBusy = false;
    private static int nativeStarts = 0;
    private static volatile boolean stdoutRedirected = false;
    private static FileOutputStream stdoutHolder; // keep the fd owned so GC never closes it

    @Override
    public void onCreate() {
        super.onCreate();
        resetOnVersionChange();
        BootLog.log(getFilesDir(), "=== service onCreate, process=" + processName() + " ===");
        // A leftover "current" variant with no result means the process died
        // mid-attempt (native crash). Record it before anything else.
        String cur = readSmall(new File(getFilesDir(), PLAN_CUR_FILE));
        if (cur != null) {
            appendResult(cur, "crash", "process died during this attempt (likely native abort) — see boot log");
            new File(getFilesDir(), PLAN_CUR_FILE).delete();
        }
    }

    /**
     * New APK (versionCode bump) must not inherit the old diagnostic state:
     * v13.9 shipped while a half-finished v13.8 variant plan sat on disk and
     * the upgraded app woke up stuck in "diagnostic" forever, never running
     * the new bootstrap. On any versionCode change wipe the variant plan,
     * results, state file, crash guard, server.log and boot log.
     */
    private void resetOnVersionChange() {
        File vf = new File(getFilesDir(), VERSION_FILE);
        String seen = readSmall(vf);
        String now;
        try {
            now = String.valueOf(getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode());
        } catch (Exception e) {
            now = "unknown";
        }
        if (now.equals(seen)) return;
        File fd = getFilesDir();
        new File(fd, PLAN_ID_FILE).delete();
        new File(fd, PLAN_CUR_FILE).delete();
        new File(fd, PLAN_REM_FILE).delete();
        new File(fd, RESULTS_FILE).delete();
        new File(fd, STATE_FILE).delete();
        new File(fd, GUARD_FILE).delete();
        new File(fd, "embedded-server-boot.log").delete();
        new File(fd, "probe-icu.json").delete();
        new File(fd, "probe-icu-done.txt").delete();
        new File(fd, "probe-hello.txt").delete();
        new File(fd, "probe-listen.txt").delete();
        new File(fd, "probe-listen-err.txt").delete();
        new File(fd, "probe-listen-steps.txt").delete();
        new File(fd, "probe-bootstrap-err.txt").delete();
        File log = new File(fd, "opencode-config/server.log");
        //noinspection ResultOfMethodCallIgnored
        log.delete();
        writeSmall(vf, now);
        BootLog.log(fd, "version change " + seen + " -> " + now + ": variant plan, state, logs and probes wiped");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        BootLog.log(getFilesDir(), "onStartCommand action=" + action);
        if (ACTION_STOP.equals(action)) {
            writeState("stopped", null, null);
            stopForeground(true);
            stopSelf();
            // node has no in-process stop API; it exits with this process.
            return START_NOT_STICKY;
        }
        startForegroundWithNotification();
        if (ACTION_RUN_VARIANTS.equals(action)) {
            String planId = intent.getStringExtra("planId");
            String existing = readSmall(new File(getFilesDir(), PLAN_ID_FILE));
            if (planId != null && planId.equals(existing)) {
                BootLog.log(getFilesDir(), "redelivered RUN_VARIANTS " + planId + " — keeping current plan");
            } else {
                BootLog.log(getFilesDir(), "new variant plan " + planId);
                writeSmall(new File(getFilesDir(), PLAN_ID_FILE), planId != null ? planId : "manual");
                writeSmall(new File(getFilesDir(), PLAN_REM_FILE), String.join(",", ALL_VARIANTS));
                new File(getFilesDir(), PLAN_CUR_FILE).delete();
                new File(getFilesDir(), RESULTS_FILE).delete();
                resetGuard();
                writeState("diagnostic", null, "running node start variants");
            }
            if (nodeThreadRunning || nativeBusy) {
                BootLog.log(getFilesDir(), "node attempt active; killing process for a clean diagnostic cycle");
                killProcess();
                return START_STICKY;
            }
            runNextVariant();
            return START_STICKY;
        }
        // Normal start (or sticky restart). A pending variant plan takes
        // priority over the normal server start.
        if (planActive()) {
            if (!nodeThreadRunning) runNextVariant();
            else BootLog.log(getFilesDir(), "start requested but a variant is already running — skipped");
            return START_STICKY;
        }
        if (!nodeThreadRunning) {
            startNode();
        } else {
            BootLog.log(getFilesDir(), "start requested but node thread already running — skipped (no double start)");
        }
        // Sticky, but the crash guard below breaks a native-crash restart loop.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        BootLog.log(getFilesDir(), "service onDestroy");
        super.onDestroy();
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
                .setContentTitle("OpenCode++")
                .setContentText("On-device server running")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentIntent(content)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    // ------------------------------------------------------------------
    // Normal server start
    // ------------------------------------------------------------------

    private void startNode() {
        nodeThreadRunning = true;
        // Crash-loop guard: a native abort kills this whole process and the
        // system restarts a sticky service; give up after 3 starts in 5
        // minutes without reaching ready, so we never spin forever.
        if (guardTripped()) {
            BootLog.log(getFilesDir(), "crash guard tripped — giving up");
            writeState("failed", null, "node crashed repeatedly (3+ starts in 5 min without becoming ready); force-stop the app or reinstall to retry");
            stopForeground(true);
            stopSelf();
            nodeThreadRunning = false;
            return;
        }
        final String password;
        try {
            password = ensurePassword();
        } catch (IOException ioe) {
            writeState("failed", null, "cannot persist password: " + ioe);
            stopSelf();
            nodeThreadRunning = false;
            return;
        }
        Redact.registerSecret(password);
        writeState("starting", password, null);
        BootLog.log(getFilesDir(), "state -> starting (normal mode)");
        Thread t = new Thread(() -> {
            try {
                BootLog.log(getFilesDir(), "before System.loadLibrary(c++_shared)");
                System.loadLibrary("c++_shared");
                BootLog.log(getFilesDir(), "after System.loadLibrary(c++_shared)");
                File projectDir = ensureProjectExtracted();
                writeConfig(projectDir, password);
                BootLog.log(getFilesDir(), "embedded-config.json written");
                watchReady(password);
                File boot = new File(projectDir, "bootstrap.js");
                BootLog.log(getFilesDir(), "before NodeRuntime class load (System.loadLibrary node + nodebridge)");
                Class.forName("com.opencode.plusplus.embedded.NodeRuntime");
                BootLog.log(getFilesDir(), "after NodeRuntime class load");
                BootLog.log(getFilesDir(), "before startNodeWithArguments: [node, " + boot.getAbsolutePath()
                        + "] exists=" + boot.exists() + " size=" + boot.length());
                nativeBusy = true;
                nativeStarts++;
                BootLog.log(getFilesDir(), "NATIVE START #" + nativeStarts + " in pid " + android.os.Process.myPid()
                        + (nativeStarts > 1 ? " — DOUBLE START IN ONE PROCESS!" : ""));
                int rc = NodeRuntime.startNodeWithArguments(new String[]{"node", boot.getAbsolutePath()});
                nativeBusy = false;
                nodeThreadRunning = false; // native returned: a later intent may restart cleanly
                BootLog.log(getFilesDir(), "startNodeWithArguments RETURNED rc=" + rc + " (node exited)");
                writeState("failed", password, "node exited rc=" + rc);
            } catch (Throwable e) {
                nativeBusy = false;
                BootLog.log(getFilesDir(), "EXCEPTION in node thread: " + stack(e));
                writeState("failed", password, String.valueOf(e));
            }
        }, "opencode-node");
        t.start();
    }

    /** Flips the state to ready once the HTTP server actually answers with our password. */
    private void watchReady(String password) {
        Thread w = new Thread(() -> {
            long t0 = System.currentTimeMillis();
            long deadline = t0 + 120000;
            long lastLog = 0;
            while (System.currentTimeMillis() < deadline) {
                if (probe(password)) {
                    BootLog.log(getFilesDir(), "watchReady: server answered after " + (System.currentTimeMillis() - t0) + "ms — state -> ready");
                    resetGuard();
                    writeState("ready", password, null);
                    return;
                }
                if (System.currentTimeMillis() - lastLog > 15000) {
                    lastLog = System.currentTimeMillis();
                    BootLog.log(getFilesDir(), "watchReady: still no answer on 127.0.0.1:4096 (" + (System.currentTimeMillis() - t0) / 1000 + "s)");
                }
                try { Thread.sleep(500); } catch (InterruptedException ignored) {}
            }
            BootLog.log(getFilesDir(), "watchReady: TIMEOUT 120s — state -> failed");
            writeState("failed", password, "server did not answer on 127.0.0.1:4096 within 120s");
        }, "opencode-ready-watch");
        w.setDaemon(true);
        w.start();
    }

    private boolean probe(String password) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://127.0.0.1:4096/api/info").openConnection();
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

    // ------------------------------------------------------------------
    // Diagnostic variant runs (self-test "try all Node start ways")
    // ------------------------------------------------------------------

    private boolean planActive() {
        File rem = new File(getFilesDir(), PLAN_REM_FILE);
        File cur = new File(getFilesDir(), PLAN_CUR_FILE);
        if (!rem.exists() && !cur.exists()) return false;
        long newest = Math.max(rem.exists() ? rem.lastModified() : 0, cur.exists() ? cur.lastModified() : 0);
        if (System.currentTimeMillis() - newest > PLAN_STALE_MS) {
            appendResult("plan", "auto-reset", "variant plan idle >" + PLAN_STALE_MS / 60000 + "min (orphaned by crash/hang) — wiping it; normal server start follows");
            BootLog.log(getFilesDir(), "stale variant plan detected — auto-reset to normal mode");
            new File(getFilesDir(), PLAN_ID_FILE).delete();
            cur.delete();
            rem.delete();
            resetGuard();
            return false;
        }
        return true;
    }

    private void runNextVariant() {
        File remFile = new File(getFilesDir(), PLAN_REM_FILE);
        String rem = readSmall(remFile);
        List<String> remaining = new ArrayList<>();
        if (rem != null && !rem.isEmpty()) remaining.addAll(Arrays.asList(rem.split(",")));
        if (remaining.isEmpty()) {
            appendResult("plan", "done", "all variants attempted; restarting into normal server mode");
            new File(getFilesDir(), PLAN_ID_FILE).delete();
            new File(getFilesDir(), PLAN_CUR_FILE).delete();
            remFile.delete();
            resetGuard();
            BootLog.log(getFilesDir(), "variant plan complete; killing process for a clean normal start");
            killProcess();
            return;
        }
        final String variant = remaining.remove(0);
        writeSmall(remFile, String.join(",", remaining));
        writeSmall(new File(getFilesDir(), PLAN_CUR_FILE), variant);
        resetGuard();
        nodeThreadRunning = true;
        BootLog.log(getFilesDir(), "--- variant start: " + variant + " (remaining: " + remaining + ")");
        // Written BEFORE the native call: if the process dies natively, the
        // results file still shows this attempt existed (v13.9: eval-listen
        // died and the results only showed eval-hello).
        appendResult(variant, "running", "native attempt issued");
        Thread t = new Thread(() -> {
            try {
                switch (variant) {
                    case "icu-probe": variantIcuProbe(); break;
                    case "eval-hello": variantEvalHello(); break;
                    case "eval-listen": variantEvalListen(); break;
                    case "require-bootstrap": variantRequireBootstrap(); break;
                    case "fresh-normal": variantFreshNormal(); break;
                    default: appendResult(variant, "error", "unknown variant");
                }
            } catch (Throwable e) {
                appendResult(variant, "error", stack(e));
            }
            if (!"fresh-normal".equals(variant)) {
                new File(getFilesDir(), PLAN_CUR_FILE).delete();
                BootLog.log(getFilesDir(), "variant " + variant + " finished; restarting process for next variant");
                killProcess();
            }
        }, "variant-" + variant);
        t.start();
    }

    /** Raw-runtime ICU capability scan: which APIs this nodejs-mobile build really has. */
    private void variantIcuProbe() throws Exception {
        File out = new File(getFilesDir(), "probe-icu.json");
        File done = new File(getFilesDir(), "probe-icu-done.txt");
        String cached = done.exists() ? readSmall(out) : null;
        if (cached != null) {
            appendResult("icu-probe", "pass", "cached (probe runs once per app version); " + cached.replace("\n", " "));
            return;
        }
        out.delete();
        String js = "const fs=require('fs');const r={};"
                + "const t=(k,f)=>{try{f();r[k]='yes'}catch(e){r[k]='no: '+String(e&&e.message||e).slice(0,90)}};"
                + "t('regexp-pL',()=>new RegExp('\\\\p{L}','u'));"
                + "t('textdecoder-utf8-fatal',()=>new TextDecoder('utf-8',{fatal:true}));"
                + "t('textdecoder-1251',()=>new TextDecoder('windows-1251'));"
                + "t('textencoder',()=>new TextEncoder().encode('a'));"
                + "t('intl-present',()=>{if(typeof Intl==='undefined')throw new Error('undefined')});"
                + "t('intl-datetimeformat',()=>new Intl.DateTimeFormat('ru-RU').format(new Date(0)));"
                + "t('intl-numberformat',()=>new Intl.NumberFormat('ru-RU').format(1234.5));"
                + "t('intl-collator',()=>new Intl.Collator('ru').compare('а','б'));"
                + "t('intl-segmenter',()=>new Intl.Segmenter('ru').segment('a b'));"
                + "t('intl-pluralrules',()=>new Intl.PluralRules('ru').select(2));"
                + "t('normalize',()=>'\\u00e4'.normalize('NFC'));"
                + "t('localecompare-opts',()=>'a'.localeCompare('b','ru',{sensitivity:'base'}));"
                + "t('tolocalestring',()=>new Date(0).toLocaleString('ru-RU'));"
                + "t('domainToASCII-ascii',()=>{const u=require('url');if(u.domainToASCII('example.com')!=='example.com')throw new Error('bad')});"
                + "t('domainToASCII-unicode',()=>require('url').domainToASCII('\\u043f\\u0440\\u0438\\u043c\\u0435\\u0440.\\u0440\\u0444'));"
                + "t('buffer-transcode',()=>require('buffer').transcode(Buffer.from('a'),'utf8','utf16le'));"
                + "r.nodeVersion=process.version;"
                + "fs.writeFileSync(" + jsq(out.getAbsolutePath()) + ",JSON.stringify(r,null,1));"
                + "process.exit(0);";
        int rc = startNodeNative("icu-probe", new String[]{"node", "-e", js}, VARIANT_TIMEOUT_MS);
        String body = readSmall(out);
        if (rc == 0 && body != null) writeSmall(done, "ok");
        appendResult("icu-probe", rc == 0 && body != null ? "pass" : "fail",
                "rc=" + rc + (body != null ? "; " + body.replace("\n", " ") : "; probe file missing"));
    }

    /** Does the node runtime boot at all in the :node process? */
    private void variantEvalHello() throws Exception {
        File probe = new File(getFilesDir(), "probe-hello.txt");
        probe.delete();
        String js = "require('fs').writeFileSync(" + jsq(probe.getAbsolutePath())
                + ",'node alive: '+process.version+' arch='+process.arch+' platform='+process.platform);";
        int rc = startNodeNative("eval-hello", new String[]{"node", "-e", js}, VARIANT_TIMEOUT_MS);
        String content = readSmall(probe);
        appendResult("eval-hello", rc == 0 && content != null ? "pass" : "fail",
                "rc=" + rc + "; " + (content != null ? content : "probe file missing — node ran nothing"));
    }

    /** Can node bind a TCP port on 127.0.0.1:4096 here? */
    private void variantEvalListen() throws Exception {
        File ok = new File(getFilesDir(), "probe-listen.txt");
        File err = new File(getFilesDir(), "probe-listen-err.txt");
        File steps = new File(getFilesDir(), "probe-listen-steps.txt");
        ok.delete();
        err.delete();
        steps.delete();
        // Step markers go to disk BEFORE each risky call: when the native
        // runtime aborts (FORTIFY), the last marker on disk is the crime
        // scene. v13.9 died here with zero evidence.
        String sq = jsq(steps.getAbsolutePath());
        String js = "const fs=require('fs');const step=(m)=>fs.appendFileSync(" + sq + ",m+'\\n');"
                + "step('js-entered');"
                + "const http=require('http');step('http-required');"
                + "const s=http.createServer((q,r)=>{r.end('ok')});step('server-created');"
                + "s.on('error',e=>{step('listen-error');fs.writeFileSync(" + jsq(err.getAbsolutePath()) + ",String(e&&e.stack||e));process.exit(3)});"
                + "step('listen-called');"
                + "s.listen(4096,'127.0.0.1',()=>{step('listening-callback');fs.writeFileSync(" + jsq(ok.getAbsolutePath()) + ",'listening');setTimeout(()=>{step('exiting');process.exit(0)},500);});";
        int rc = startNodeNative("eval-listen", new String[]{"node", "-e", js}, VARIANT_TIMEOUT_MS);
        String errBody = readSmall(err);
        String stepBody = readSmall(steps);
        String detail = "rc=" + rc + "; steps=[" + (stepBody != null ? stepBody.replace("\n", ">") : "none")
                + "]" + (ok.exists() ? "; port 4096 bound OK" : errBody != null ? "; listen error: " + errBody : "; no listen result");
        appendResult("eval-listen", rc == 0 && ok.exists() ? "pass" : "fail", detail);
    }

    /**
     * require() the real bootstrap.js with a 10s hard exit: a synchronous
     * throw (bad path/parse/module error) lands in probe-bootstrap-err.txt
     * with a stack; a clean 10s run means bootstrap at least starts.
     */
    private void variantRequireBootstrap() throws Exception {
        System.loadLibrary("c++_shared");
        File projectDir = ensureProjectExtracted();
        String variantPassword = ensurePassword();
        Redact.registerSecret(variantPassword);
        writeConfig(projectDir, variantPassword);
        File bootErr = new File(getFilesDir(), "probe-bootstrap-err.txt");
        bootErr.delete();
        File boot = new File(projectDir, "bootstrap.js");
        final boolean[] answered = {false};
        Thread pp = new Thread(() -> {
            long end = System.currentTimeMillis() + 9000;
            while (System.currentTimeMillis() < end && !answered[0]) {
                try (Socket s = new Socket()) {
                    s.connect(new InetSocketAddress("127.0.0.1", 4096), 500);
                    answered[0] = true;
                } catch (Exception ignored) {
                }
                try { Thread.sleep(400); } catch (InterruptedException e) { return; }
            }
        }, "variant-port-probe");
        pp.setDaemon(true);
        pp.start();
        String js = "setTimeout(()=>process.exit(2),10000);try{require(" + jsq(boot.getAbsolutePath())
                + ")}catch(e){require('fs').writeFileSync(" + jsq(bootErr.getAbsolutePath())
                + ",String(e&&e.stack||e));process.exit(4)}";
        int rc = startNodeNative("require-bootstrap", new String[]{"node", "-e", js}, VARIANT_TIMEOUT_MS);
        pp.interrupt();
        String errBody = readSmall(bootErr);
        String detail = "rc=" + rc + " (2=ran 10s without sync throw, 4=bootstrap threw)";
        detail += "; port 4096 answered during window: " + (answered[0] ? "YES" : "no");
        if (errBody != null) detail += "; bootstrap stack: " + errBody;
        appendResult("require-bootstrap", rc == 2 && answered[0] ? "pass" : "fail", detail);
    }

    /** Stale-assets hypothesis: wipe the extraction, re-extract, run the normal flow. */
    private void variantFreshNormal() {
        appendResult("fresh-normal", "run", "wiped nodejs-project + extraction marker; normal server start follows with fresh assets — outcome = server state (see state file / boot log)");
        new File(getFilesDir(), PLAN_ID_FILE).delete();
        new File(getFilesDir(), PLAN_CUR_FILE).delete();
        new File(getFilesDir(), PLAN_REM_FILE).delete();
        File dir = new File(getFilesDir(), "nodejs-project");
        deleteRecursive(dir);
        resetGuard();
        nodeThreadRunning = false; // startNode flips it back; keep the guard honest
        BootLog.log(getFilesDir(), "fresh-normal: handing over to normal startNode()");
        startNode();
    }

    /**
     * Runs one blocking native node call with a watchdog. On timeout the
     * watchdog records the result and kills the process (the native call can
     * never be unblocked otherwise). A native crash kills the process with
     * the variant still "current" — onCreate records that as a crash.
     */
    private int startNodeNative(final String variant, String[] args, long timeoutMs) throws Exception {
        redirectStdoutToServerLog();
        BootLog.log(getFilesDir(), "variant " + variant + ": before native start, args=" + Arrays.toString(args));
        nativeBusy = true;
        nativeStarts++;
        BootLog.log(getFilesDir(), "NATIVE START #" + nativeStarts + " in pid " + android.os.Process.myPid()
                + (nativeStarts > 1 ? " — DOUBLE START IN ONE PROCESS!" : ""));
        Thread wd = new Thread(() -> {
            try { Thread.sleep(timeoutMs); } catch (InterruptedException e) { return; }
            if (nativeBusy) {
                appendResult(variant, "timeout", "native call still blocked after " + timeoutMs / 1000 + "s — node hung before finishing");
                BootLog.log(getFilesDir(), "variant " + variant + ": TIMEOUT — killing process");
                killProcess();
            }
        }, "variant-watchdog");
        wd.setDaemon(true);
        wd.start();
        int rc;
        try {
            rc = NodeRuntime.startNodeWithArguments(args);
        } finally {
            nativeBusy = false;
            wd.interrupt();
        }
        BootLog.log(getFilesDir(), "variant " + variant + ": native returned rc=" + rc);
        return rc;
    }

    // ------------------------------------------------------------------
    // stdout/stderr -> server.log (captures node errors before bootstrap runs)
    // ------------------------------------------------------------------

    private void redirectStdoutToServerLog() {
        if (stdoutRedirected) return;
        try {
            File configDir = new File(getFilesDir(), "opencode-config");
            //noinspection ResultOfMethodCallIgnored
            configDir.mkdirs();
            File log = new File(configDir, "server.log");
            if (log.length() > 256 * 1024) {
                byte[] all = Files.readAllBytes(log.toPath());
                try (FileOutputStream out = new FileOutputStream(log, false)) {
                    out.write(all, all.length - 65536, 65536);
                }
            }
            FileOutputStream fos = new FileOutputStream(log, true);
            stdoutHolder = fos;
            android.system.Os.dup2(fos.getFD(), android.system.OsConstants.STDOUT_FILENO);
            android.system.Os.dup2(fos.getFD(), android.system.OsConstants.STDERR_FILENO);
            stdoutRedirected = true;
            BootLog.log(getFilesDir(), "stdout/stderr dup2 -> " + log.getAbsolutePath() + " OK");
        } catch (Throwable e) {
            BootLog.log(getFilesDir(), "stdout/stderr dup2 FAILED: " + e);
        }
    }

    // ------------------------------------------------------------------
    // Assets / config
    // ------------------------------------------------------------------

    private File ensureProjectExtracted() throws IOException {
        File dir = new File(getFilesDir(), "nodejs-project");
        // Bump the marker when the shipped project changes, or stale assets
        // from a previous APK keep running forever (v13.5 shipped a new
        // bootstrap.js without a bump — devices kept running v13.4 code).
        File marker = new File(dir, ".extracted-v10");
        if (marker.exists()) {
            BootLog.log(getFilesDir(), "extraction: marker .extracted-v10 present, reusing project");
            return dir;
        }
        BootLog.log(getFilesDir(), "extraction: no current marker (.extracted-v10) — re-extracting assets/nodejs-project");
        long t0 = System.currentTimeMillis();
        deleteRecursive(dir);
        AssetExtractor.extract(getAssets(), "nodejs-project", dir);
        int n = countFiles(dir);
        try (FileWriter w = new FileWriter(marker)) { w.write("ok"); }
        BootLog.log(getFilesDir(), "extraction done: " + n + " files in " + (System.currentTimeMillis() - t0) + "ms");
        return dir;
    }

    private static int countFiles(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return 1;
        int n = 0;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) n += countFiles(k);
        return n;
    }

    private static void deleteRecursive(File f) {
        if (!f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        f.delete();
    }

    private void writeConfig(File projectDir, String password) throws IOException {
        // Consumed by bootstrap.js: password (server auth) + configDir
        // (OPENCODE_CONFIG_DIR; the DB lands at <configDir>/opencode-android.db).
        // The server does not create configDir itself and dies with ENOENT on
        // first boot if it is missing (this silently dropped v13 into the
        // standalone fallback on real devices).
        File configDir = new File(getFilesDir(), "opencode-config");
        if (!configDir.isDirectory() && !configDir.mkdirs()) {
            throw new IOException("cannot create configDir " + configDir);
        }
        // v13.12: default project directory. The node process starts with an
        // unusable cwd on Android, so /api/fs/list?path=. 500'd; bootstrap.js
        // chdirs here (see projectsDir below).
        File projectsDir = new File(getFilesDir(), "projects");
        if (!projectsDir.isDirectory() && !projectsDir.mkdirs()) {
            throw new IOException("cannot create projectsDir " + projectsDir);
        }
        String json = "{"
                + "\"password\":\"" + password + "\","
                + "\"configDir\":\"" + configDir.getAbsolutePath() + "\","
                + "\"projectsDir\":\"" + projectsDir.getAbsolutePath() + "\","
                + "\"tmpDir\":\"" + getCacheDir().getAbsolutePath() + "\","
                + "\"nativeBinDir\":\"" + getApplicationInfo().nativeLibraryDir + "\""
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

    // v13.12: the WebView persists the server password; regenerating it on
    // every node start left the app holding a stale password (every SDK call,
    // incl. the /api/event stream, 401'd until relog). Keep ONE password per
    // install in an app-private file and reuse it across node restarts.
    private String ensurePassword() throws IOException {
        File f = new File(getFilesDir(), "embedded-password.txt");
        if (f.isFile()) {
            String existing = readSmall(f);
            if (existing != null && existing.trim().length() >= 12) return existing.trim();
        }
        String password = newPassword();
        writeFileAtomic(f, password);
        return password;
    }

    // ------------------------------------------------------------------
    // Cross-process state + small file helpers
    // ------------------------------------------------------------------

    private void writeState(String state, String password, String error) {
        StringBuilder json = new StringBuilder("{\"state\":\"").append(state).append("\",\"ts\":").append(System.currentTimeMillis());
        if (password != null) json.append(",\"password\":\"").append(password).append("\"");
        if (error != null) json.append(",\"error\":").append(quote(error));
        json.append("}");
        writeFileAtomic(new File(getFilesDir(), STATE_FILE), json.toString());
    }

    private void appendResult(String variant, String status, String detail) {
        String line = "{\"ts\":" + System.currentTimeMillis()
                + ",\"variant\":" + quote(variant)
                + ",\"status\":" + quote(status)
                + ",\"detail\":" + quote(Redact.apply(detail)) + "}\n";
        try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), RESULTS_FILE), true)) {
            out.write(line.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Throwable ignored) {
        }
        BootLog.log(getFilesDir(), "RESULT " + variant + " = " + status + " — " + detail);
    }

    private static String readSmall(File f) {
        try {
            if (!f.exists()) return null;
            String s = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim();
            return s.length() > 3000 ? s.substring(0, 3000) : s;
        } catch (Throwable e) {
            return null;
        }
    }

    private static void writeSmall(File f, String body) {
        try (FileOutputStream out = new FileOutputStream(f, false)) {
            out.write(body.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Throwable ignored) {
        }
    }

    private static String stack(Throwable e) {
        java.io.StringWriter sw = new java.io.StringWriter();
        e.printStackTrace(new java.io.PrintWriter(sw));
        String s = sw.toString();
        return s.length() > 2000 ? s.substring(0, 2000) : s;
    }

    private static String jsq(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static String processName() {
        try {
            return android.app.Application.getProcessName();
        } catch (Throwable e) {
            return "unknown";
        }
    }

    private static void killProcess() {
        android.os.Process.killProcess(android.os.Process.myPid());
    }

    private static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') b.append("\\r");
            else if (c < 0x20) b.append(' ');
            else b.append(c);
        }
        return b.append('"').toString();
    }

    static void writeFileAtomic(File target, String content) {
        File tmp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileWriter w = new FileWriter(tmp)) {
            w.write(content);
        } catch (IOException ignored) {
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(target);
    }

    // ------------------------------------------------------------------
    // Crash-loop guard
    // ------------------------------------------------------------------

    private boolean guardTripped() {
        File f = new File(getFilesDir(), GUARD_FILE);
        long now = System.currentTimeMillis();
        long windowStart = 0;
        int count = 0;
        try {
            if (f.exists()) {
                String body = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
                windowStart = extractLong(body, "windowStart");
                count = (int) extractLong(body, "count");
            }
        } catch (Exception ignored) {
        }
        if (now - windowStart > 300000) {
            windowStart = now;
            count = 0;
        }
        count++;
        writeFileAtomic(f, "{\"windowStart\":" + windowStart + ",\"count\":" + count + "}");
        return count > 3;
    }

    private void resetGuard() {
        writeFileAtomic(new File(getFilesDir(), GUARD_FILE), "{\"windowStart\":0,\"count\":0}");
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

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
