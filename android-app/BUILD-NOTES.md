# Standalone shim research (v12) — captured contracts 2026-10-16

## Injection point
- SDK client: packages/client/src/promise/generated/client.ts — ClientOptions has `fetch` and `baseUrl`; SSE (event.subscribe) also goes through the same fetch (async-iterable SSE parser over response.body). A custom fetch for the local-server URL covers EVERYTHING, no EventSource needed.
- Client created in packages/app/src/runtime/server/api.ts (createApiForServer) + client.tsx; health checks in runtime/server/health.ts (own fetch to /api/info etc., 10s poll, shape {healthy,version,incompatible,checking,unauthorized}).
- Registry seed (v10): registry.tsx seeds {type:'http',http:{url:'http://127.0.0.1:4096',password:'opencode-plus-plus'}} when list empty. Point the shim at this URL.

## Boot GET surface (all prefixed /api, query location[directory]=<dir>)
info, location, project, provider, model, integration, config, agent, command, mcp, mcp/resource, reference, skill, shell, form, websearch/provider, vcs, vcs/branch, session/active, worktree, event (SSE)
POSTs seen at boot: /api/worktree/refresh {"projectID":...}
Response dumps: ~/apk-opencodepp/shim-notes/api-dump/*.json (all wrapped {location:{directory},data:...} except info/project/session-active)
- provider.json: {location,data:[{id,integrationID,name,activation,package,settings?}]}
- model.json (197KB): {location,data:[{id,modelID,providerID,name,compatibility?,package,settings{apiKey,baseURL,provider},capabilities{tools,input,output},variants[{id,settings{reasoningEffort}}]}]} — variants = the "Default"/effort selector
- agent.json: {location,data:[{id:'build',name,request,description,mode:'primary',hidden,permissions:[...]}]}
- integration.json (34KB, 234 items): [{id,name,methods:[{type:'key'}|{type:'env',names:[...]}],connections:[]}] — used by provider connect dialog (useIntegrations, src/providers/catalog/integrations.ts)
- models.dev snapshot bundled: packages/core/src/models-dev/snapshot.txt (5.1MB JSON, models.dev schema)
- messages: GET /api/session/:id/message -> {data:[{id,metadata{...},time:{created},text,files,agents,type:'user'}],cursor:{previous,next}}

## Session/prompt POSTs (captured from app via CDP)
POST /api/session {"id":"ses_...","agent":"build","model":{"id":"claude-haiku-5-5","providerID":"anthropic"},"location":{"directory":<dir>}}
POST /api/session/:id/model {"model":{"id":...,"providerID":...}}
POST /api/session/:id/prompt {"id":"msg_...","text":"hi","files":[],"agents":[],"skills":[],"metadata":{"displayText":"hi","comments":[],"attachments":[],"agent":"build","model":{"modelID":...,"providerID":...}},"delivery":"steer"} -> 200 {data:{id,sessionID,time:{created},type:'user',payload:{text,files,agents,resumeOnStart:true,metadata}}}

## Event flow (SSE /api/event; frames 'data: {json}\n\n' + ': heartbeat' every ~15s; first frame {"type":"server.connected","data":{}})
Failure path observed: session.created -> project.updated -> session.inbox.enqueued -> session.execution.started -> session.instructions.updated -> session.inbox.delivered -> session.step.started -> session.step.failed -> session.execution.failed (+session.renamed, session.usage.updated, provider.updated, model.updated seen)
Event json: {id:'evt_...',created:ms,type,location?{directory},data,durable?{aggregateID,seq,version},metadata?}
session.step.started data: {sessionID,agent,model:{id,providerID,variant:'default'},assistantMessageID:'msg_...',snapshot:'<sha>'}
session.step.failed data: {sessionID,assistantMessageID,error:{type:'provider.auth',message,status,response{body}}}
MISSING (not yet captured): successful-stream events (assistant message + part deltas) and assistant message shape in GET message. Legacy event names exist in schema/src/v1/session.ts (message.part.updated/delta/removed, message.updated) but fork's current flow unconfirmed. Get from schema: @opencode/schema/session-message (SessionMessage), packages/schema/src.
## Mock provider for testing
/tmp/mock-provider.mjs (node, :5555, /v1/models + /v1/chat/completions streaming SSE, CORS *). Fork server custom provider config attempt: ~/.config/opencode/opencode.json {"provider":{"mock":{npm:'@opencode/ai/providers/openai-compatible',options:{baseURL,apiKey},models:{...}}}} — NOT picked up by /api/model (needs debugging; maybe config key/format wrong, check core/src/config/normalize.ts:545 provider canonical + ConfigMigrateV1.migrateProvider).
## Server auth note
Fork server ALWAYS needs a password (random if unset) -> run with OPENCODE_SERVER_PASSWORD=opencode-plus-plus. Free provider: model ll-alpha-free providerID 'opencode' settings {apiKey:'public',baseURL:'https://opencode.ai/inference/openai/v1'} — title gen worked but step never started (flaky/slow).

## SUCCESS-PATH CONTRACT (from source, 2026-10-16 ~21:33) — COMPLETE, no mock capture needed
The app's event consumption is the spec: packages/client/src/solid/data.ts maps every SSE event to store mutations (grep `case "`). Tanstack queries refetch on invalidation; message content is BOTH event-edited and refetchable via GET /api/session/:id/message.

### Event schemas (packages/schema/src/session-event.ts; frame = {id,created,type,location?{directory},data,durable?{aggregateID,seq,version}})
Chat flow the shim must emit for one prompt:
1. session.created {data:{sessionID,slug,version,projectID,location:{directory},...}} (only for new sessions)
2. session.inbox.enqueued {data:{inboxID,sessionID,item:{type:'user',payload:{text,files,agents,resumeOnStart,metadata}}}}
3. session.execution.started {data:{sessionID}, durable}
4. session.inbox.delivered {data:{sessionID,inboxID}, durable}
5. session.step.started {data:{sessionID,assistantMessageID:'msg_...',agent:'build',model:{id,providerID,variant:'default'},started:ms}, durable}
6. session.text.started {data:{sessionID,assistantMessageID,ordinal:0}, durable}
7. session.text.delta (EPHEMERAL) {data:{sessionID,assistantMessageID,ordinal:0,delta}} — app appends to text part
8. session.text.ended {data:{sessionID,assistantMessageID,ordinal:0,text:<full>}, durable}
9. session.step.ended {data:{sessionID,assistantMessageID,finish:<FinishReason e.g. 'stop'>,cost:0,tokens:{...TokenUsage.Info}}, durable}
10. session.execution.succeeded {data:{sessionID}, durable}
Optional: session.renamed {data:{sessionID,title}}, session.usage.updated, session.step.failed {...,error:SessionError.Error} on error, session.execution.failed.
Also: session.reasoning.started/delta/ended (same shape as text) for reasoning models; variant in model ref = effort.

### Message shapes (packages/schema/src/session-message.ts)
Assistant message: {id('msg_'),sessionID,time:{created,streamed?,completed?},type:'assistant',agent,model:{id/modelID,providerID,variant?},content:[{type:'text',text,state?}|{type:'reasoning',...}|{type:'tool',...}],finish?,cost?,tokens?,error?}
User message: {...,type:'user',text,files,agents,skills}
GET /api/session/:id/message -> {data:[...messages],cursor:{previous,next}}

### Other event types data.ts handles (shim can emit subset)
agent/command/config/credential/integration/model/provider/project/reference/skill/websearch .updated (invalidate queries), server.connected (first SSE frame), session.deleted, session.metadata.updated, permission.asked/replied, mcp.status.changed, worktree.resolved, vcs.branch.updated, session.tool.* (skip: no tools standalone).

### Shim implementation plan (v12)
- New module packages/app/src/standalone/: router(req)->Response; SSE hub (ReadableStream, 15s ': heartbeat'); device storage via localStorage (keys: standalone.providers, standalone.sessions, standalone.projects).
- Inject: createApiForServer (runtime/server/api.ts) — when server url === 'http://127.0.0.1:4096' use shim fetch; health.ts — special-case same URL to return {healthy:true,version:'standalone'}.
- Providers: catalog from models.dev snapshot (packages/core/src/models-dev/snapshot.txt, 5.1MB — trim to popular ~15 providers for APK size) + custom openai-compatible entries; keys stored on device; models = provider.models from snapshot, filtered to connected; /v1/models live-fetch optional.
- Provider connect endpoint: capture exact POST the connect dialog makes (useIntegrations in src/providers/catalog/integrations.ts — CHECK the mutation; likely POST /api/integration/:id or credential endpoint; credential.* events exist).
- Prompt execution: read model.providerID+modelID from request metadata; build provider request:
  - openai-compatible: POST {baseURL}/chat/completions {model,messages:[...history],stream:true} Authorization Bearer key
  - anthropic: POST https://api.anthropic.com/v1/messages {model,max_tokens,system?,messages,stream:true} x-api-key + anthropic-version + anthropic-dangerous-direct-browser-access:true (CORS-supported)
  - google: POST https://generativelanguage.googleapis.com/v1beta/models/{m}:streamGenerateContent?alt=sse&key=KEY
  - openrouter: openai-compatible at https://openrouter.ai/api/v1 (+HTTP-Referer header)
  - baseURL defaults: from models.dev snapshot provider.api field.
  - Map stream chunks -> session.text.delta events; persist final assistant message; emit step/execution end. Error -> session.step.failed + execution.failed with SessionError shape.
- CORS risk (WebView origin http://localhost): OpenAI/OpenRouter/Google allow CORS; Anthropic needs the dangerous-direct-browser-access header. Fallback: CapacitorHttp non-streaming (check @capacitor/core availability in android-app) — TEST with mock :5555 (CORS-on) + optionally verify real endpoints' OPTIONS from the dev origin.
- New project: virtual local project {id:'local',canonical:'/local',vcs:null,time,sandboxes:[]} (+ user-created /local/<n>); /api/location returns it; no file tools.
- Strip remaining server UI: Settings 'Server' section tab (settings/pages.ts servers entry + inventory), server rows in Home (servers dropdown), 'Local ●' status pills, session footer server bits — enumerate visually after shim boots.
- i18n keys exist for provider connect flow already (verified v7).

### Open questions for next run
1. Exact provider-connect POST (read src/providers/catalog/integrations.ts mutation) + credential storage events.
2. Does session store require session.instructions.updated? (observed optional metadata; likely skippable)
3. POST /api/session response shape = {data:{...session}} — grab from messages-mock.json? No — session create response dump needed (quick curl next run).
4. Draft/new-session flow: which endpoints does tapping send in composer hit BEFORE session create (POST /api/session then prompt — confirmed order).

## Captured 21:33-21:34 (final gaps closed)
- POST /api/session response: {"data":{"id":"ses_...","projectID":"...","agent":"build","model":{"id":"...","providerID":"...","variant":"default"},"cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"time":{"created":ms,"updated":ms},"location":{"directory":"..."}}} (dump: api-dump/session-create.json)
- Provider key connect: POST /api/integration/:id/connect/key body {integrationID,location:{directory},key,answer:{}} -> 200 EMPTY body. Server does NOT validate the key at connect (fails later at chat time). After connect, /api/model immediately includes that provider's catalog models (e.g. anthropic: 20).
- Anthropic variant shape: {"id":"none","settings":{"thinking":{"type":"disabled"}}},{"id":"low","settings":{"thinking":{...}}}... — variants overlay provider request settings = effort selector.
- data.ts case list = full event spec (packages/client/src/solid/data.ts, ~1954 lines).
## NEXT RUN: start here
1. Write packages/app/src/standalone/ (router+SSE hub+storage) per plan above; wire into createApiForServer + health.ts for url http://127.0.0.1:4096.
2. Trim models.dev snapshot to popular providers (openai,anthropic,google,openrouter,deepseek,groq,mistral,xai,together,fireworks,cerebras,github-copilot?,opencode) — keep APK small.
3. Test rig: mock :5555 (mock-provider.mjs backed up at ~/apk-opencodepp/shim-notes/mock-provider.mjs? NO - it's /tmp/mock-provider.mjs, recreate from CONTRACT if gone: simple node http server, /v1/models + /v1/chat/completions SSE stream, CORS *).
4. Then strip server-mention UI; build v12 (versionCode 10).

## V12 SHIPPED (Oct 16, 2026, 23:17)
- APK: /downloads/OpenCodepp-v12-standalone.apk (vc10 / 1.2), Drive id 14lMRSClOJjiIri5GCTtachQ6N4O1nm6y
- Chat works E2E (mock-verified): session create, prompt (client-minted msg id honored), inbox.enqueued+delivered events, streamed reply, auto-rename PATCH (204), model-switch message persisted (msg id = evt id with evt_->msg_) for the refetch, single-message GET route
- opencode free tier REMOVED from standalone catalog (FreeTierError gate unpassable from app; curl-verified). Catalog = keyed providers only; defaultModel() undefined without keys; composer blocks send with "Select model"
- Settings Server section hidden via shell.tsx gate on VITE_OPENCODE_SERVER_MODE==="none" + route redirect
- Model entries normalized in catalog.ts (cost/limit/status/enabled/time defaults) — normalizeProviderList requires model.cost array
- Native transport: CapacitorHttp.request in chat.ts when Capacitor.isNativePlatform() — buffered responses (no streaming on Android, by design)
- SessionPromptOutput = SessionInboxUser {id, sessionID, time:{created}, type:'user', payload:{text,resumeOnStart,...}, delivery:'steer'}
- Prompt POST body carries client-minted `id` — MUST echo it as the message id or pending never clears
- OPEN ITEM: new-session draft nav untested on device; real-key provider calls untested; free-tier models could return via embedded server later

## V12.1 SHIPPED (Oct 17, 2026, 00:12)
- APK: /downloads/OpenCodepp-v12.1-standalone.apk (vc11 / 1.2.1), Drive id 1hkvnWTKPhNullzqDoVzG8RCIhA7ZFLwF
- ROOT CAUSE of Shadow's "no main screen": tracked projects (client-local store) start empty -> Home empty + "+" no-op (openNewTab requires a project)
- FIX (home/model.ts, standalone-gated): seed tracked project /projects/default on first run (respects recentlyClosed); auto-open draft (launch screen) once per launch when tabs.store is empty
- FIX (shim): /api/worktree GET = bare array (was location-wrapped -> crashed draft screen, worktreeItems(...).filter); /api/worktree/refresh = 204
- FIX (shim): virtual FS for the project picker — /api/fs/list + /api/fs/find over /projects/*; picker flow verified: type path -> ENTER (required; resolve() uses validated root) -> Select folder -> project created
- Theme seeding for dark screenshots: localStorage 'opencode-color-scheme' = 'dark'
- In-app nav in tests: history.pushState + dispatchEvent(popstate); PwaRoutePersistence restores /new-session otherwise

## FUTURE: embedded-server build — free opencode models (from server agent, via parent, Oct 17 00:36)
- Free models work ONLY against the embedded real server after the user logs into his own opencode account (official device flow)
- When on embedded server: re-add free models (they appear in /api/model once the credential exists)
- Add "Connect OpenCode account" screen: POST /api/integration/opencode/connect/oauth {"methodID":"device"} -> {attemptID, url, code}; poll GET /api/integration/opencode/connect/oauth/{attemptID} until done
- Not for v12.x standalone

## EMBEDDED-SERVER ANSWERS SENT (Oct 17, 00:48, via parent)
- Build: Capacitor 8.5.3, AGP 8.13.0, Gradle 8.14.3, JDK 21, com.opencode.plusplus
- minSdk 24 / targetSdk 36 / compileSdk 36; API 34+ foregroundServiceType (specialUse) + FOREGROUND_SERVICE_* permission needed
- Connection UI: keep "On-device" invisible (plugin hands password to WebView in-memory, app updates seeded profile); visible addition = Connect OpenCode account device-flow screen in Settings > Providers (opencode row)
- Startup switch: Capacitor.isPluginAvailable -> embedded; else shim (one codebase)
- APK size estimate ~70-90 MB with node runtime — Shadow should hear it
- Sequence after Shadow confirms v12.1: server bundle verify -> plugin+service -> startup switch -> connect screen -> v13 arm64

## 2026-10-17 01:06 — Push destination (Shadow, via parent)
Embedded-server work goes to the Lumus-ai org, branch "Mobile". Server agent pushes the server port; plugin skeleton goes there too ONCE STABLE. Nothing to NeiP4n/opencode-plus-plus, nothing to main. Until then: still nothing pushed anywhere.
SUPERSEDED 01:18: repo = Lumus-ai/mobile (new private repo, created + pushed by the server agent). Plugin skeleton goes there later once stable. (Was: lumus-code-private branch "Mobile".) Auth order: token if available > cloud browser with Shadow's GitHub session > parent asks Shadow for a vault token link. Still: no push until stable.

## 2026-10-17 01:15 — Stage v2 boot test: PASS
Clean dir, only staged node_modules, node 22 (server agent verified node 18.20.4). All v1 findings fixed. Password order env > embedded-config.json > generated; json carries password only, OPENCODE_CONFIG_DIR stays env (bootstrap.js compatible). Credential route POST /api/credential verified with openrouter key. Watch out: pkill -f 'stage/server/main.js' does NOT match (cmdline is "node main.js") - use pkill -f 'node main.js' and mind port 4096 collisions (EADDRINUSE).

## 2026-10-17 01:39 — v13.0 embedded build SHIPPED to parent (delivery pending)
OpenCodepp-v13-embedded.apk (73.7MB, vc 12, vn 1.3.0, arm64-v8a). nodejs-mobile v18.20.4 + JNI nodebridge + foreground service + EmbeddedServer plugin; client switch in entry.tsx/registry.tsx/home/model.ts (VITE_OPENCODE_EMBEDDED=1); stage v2 server in assets/nodejs-project. E2E-verified vs real stage2 server (mocked plugin): 198 models, live /api/* traffic. NOT on-device tested; 16KB-page risk on Android 15+; no PTY. Delivery blocked: 73.7MB > 25MB Drive tool cap, > 20MB attachment cap — asked parent for a route. v12.1 snapshots: git branch v12.1-snapshot (local commit) + ~/apk-opencodepp/android-app-v12.1.
Build gotcha: vite build silently dies under memory pressure (2GB box) — kill node/vite leftovers first, heap 1400, verify dist/index.html mtime before cap sync.

## 2026-10-17 01:43 — v13 DELIVERY: tmpfiles link sent (verified byte-identical)
https://tmpfiles.org/weAqZMxAOauK/opencodepp-v13-embedded.apk (page) / dl/ token URL verified: md5 b883107a24a2580adacb604d84b30fd7, 39,972,923 bytes. Retention ~1h — re-upload on demand from /downloads/OpenCodepp-v13-embedded.apk. Shrunk 73.7→40.0MB via packagingOptions.jniLibs.useLegacyPackaging=true (libnode.so compressed in APK). 25MB caps: google-drive tool AND cloud_browser upload-file. Browser guidance recorded: Drive owner account (magicofdarknes1) lives on DEFAULT config (config-c); config-h = different Google account (ryo…).

## v13.1 (2026-10-17 ~02:10 PKT)
- versionCode 13 / 1.3.1. APK 40,058,866 B, md5 1911adff31cfebcd3c5ce3ef0b7ec4e2.
- FIXES: NodeServerService mkdirs(configDir) before writeConfig (root cause of v13 silent standalone fallback: ENOENT opencode-android.db); mini-skills panel 46vh+scroll+sticky opaque header+X close; openExternal -> Capacitor Browser plugin (@capacitor/browser@7.0.5) for system-browser device login; client key validation pre-save for openrouter/openai/anthropic/google/groq/mistral (401/403/400 blocks save, network errors pass through); i18n en+ru.
- Delivery: tmpfiles landing https://tmpfiles.org/wXAPZt8OHzeP/opencodepp-v13.1-embedded.apk (NOTE: plain /dl/ now 302->landing; tokenized direct link verified byte-identical).
- KNOWN GAP: stage2 lists 0 opencode free models pre-login (fresh server /api/model = 177 amazon-bedrock only); server agent claimed 12 free pre-login - DOES NOT HOLD on shipped bundle. Pre-login free-model listing + FreeTierError hint need server change.

## v13.2 (2026-10-17 ~02:19 PKT)
- versionCode 14 / 1.3.2. md5 3049c7373427aeab15c31e919fff3d3f. Link: https://tmpfiles.org/wPAHZE88yxJi/opencodepp-v13.2-embedded.apk
- v13.1 FAILED on Shadow's phone (confirmed 1.3.1 installed): still standalone fallback. Root cause unproven; candidates: 16KB page device vs 30s waitReady vs OEM FGS restriction.
- v13.2: startEmbeddedServer 4x retry over ~36s + __OPENCODE_EMBEDDED_ERROR__ capture; Debug self-test in Settings>About (device/page-size/ABI/version line + 12 checks + per-provider prompt test + copyable report); MainActivity clears WebView cache on versionCode change (stale chunk errors); shim openrouter env fabrication REMOVED (was demo catalog, NO key leak — no sk- material in APK); shim opencode catalog methods key-only (why Free dialog showed key in fallback).
- EmbeddedServerPlugin.deviceInfo added (versionName/versionCode/sdk/abis/pageSizeBytes via Os.sysconf _SC_PAGESIZE).
- If Shadow's report shows pageSizeBytes=16384 -> need 16KB-aligned nodejs-mobile rebuild (server agent).

## v13.3 (2026-10-17 ~02:27 PKT)
- versionCode 15 / 1.3.3, 41.4MB, md5 3a5d7862835e11fa419070b70766e723. Link: https://tmpfiles.org/w3AjZo8L1Bg3/opencodepp-v13.3-embedded.apk
- ROOT CAUSE (Shadow's realme RMX5062, Android 15 SDK35, arm64, page 4096): UnsatisfiedLinkError libc++_shared.so needed by libnode.so. Fixed: bundled NDK30 libc++_shared.so + System.loadLibrary("c++_shared") first. 16KB NOT the issue (page=4096).
- Stage v3 synced (client identity opencode/2.0.24; FreeTierError hint). Desktop-verified: 198 models, 12 opencode free, oauth device method.
- Self-test results on his v13.2: browser plugin, key validation, localStorage all PASS.
- My earlier "no opencode models pre-login" claim was a cold-boot race on the sandbox (~40s to catalog refresh); retracted.

## v13.4 (2026-10-17 ~02:33 PKT)
- versionCode 16 / 1.3.4, 41.4MB, md5 9b83d3e26910c9898d3325c0a1d3771a. Link: https://tmpfiles.org/wuATZp8mIo1M/opencodepp-v13.4-embedded.apk
- v13.3 instant-crash on realme: first build where libnode.so actually LOADED -> node init aborts natively -> whole-process death + START_STICKY loop in the same process.
- Fix: NodeServerService moved to :node process; file-based cross-process state (embedded-server-state.json atomic tmp+rename); service self-detects ready (probe /api/info 200 with real pw); crash guard (3 starts/5min -> give up); extraction marker .extracted-v2 (stage v3 actually replaces v2 on device); plugin waits on state file (45s).
- Emulator NOT possible in sandbox (no KVM, no system images, 2GB RAM) — told parent.

## v13.5 (versionCode 17, 1.3.5) — shipped 2026-10-17 ~02:39 PKT
Fix: v13.4 blank dark screen 2+ min (entry.tsx awaited startEmbeddedServer() up to ~3 min before render).
Changes:
1. index.html: boot splash (#boot-splash, dark #121212, progress text) + helpers __setBootStatus/__removeBootSplash; live server status badge helper __setServerStatus (fixed top pill: starting=yellow, running=green auto-hide 3s, error=red sticky tap-to-copy).
2. entry.tsx: boot restructured — Promise.race([startEmbeddedServer(), 20s timeout]); embedded ready → badge running + sessionStorage flag cleared; timeout → standalone fallback + splash note; late-ready → ONE guarded location.reload(); late-reject → badge error + bottom banner (reason + copy error + path to Self-test + dismiss).
3. bootstrap.js: tees stdout/stderr to <configDir>/server.log (128KB cap, keep last 64KB).
4. EmbeddedServerPlugin.java: debugInfo() → {stateFile raw, logTail 4000 chars}.
5. settings/about/debug-self-test.tsx: state-file check row, captured __OPENCODE_EMBEDDED_ERROR__ in mode check, stateFile+logTail in copyable report.
APK: 41,792,699 bytes, md5 bdd2f9410b2c1b46d74d03102c4117e0. Verified: build OK, index.html in APK has splash+badge helpers (4 hits), jniLibs present, tmpfiles re-download md5 matches. NOT tested on device/emulator (no KVM/images/RAM in sandbox).

## v13.6 (versionCode 18, 1.3.6) — shipped 2026-10-17 ~02:52 PKT
Diagnosis build for v13.5 self-test finding: state=starting frozen (stale ts), no server.log at all, port 4096 silent on Shadow's realme.
ROOT-CAUSE LEADS FIXED/INSTRUMENTED:
- BUG: v13.5 changed bootstrap.js but extraction marker stayed .extracted-v2 → devices never re-extracted, ran v13.4 bootstrap (no log tee). Bumped to .extracted-v3 + logged.
- ANALYSIS: stale "starting" ts + no 120s watchReady "failed" write ⇒ :node process DIES (native abort), not hangs.
CHANGES:
1. BootLog.java (new): filesDir/embedded-server-boot.log, fsync per line, 256KB cap, usable from both processes. Service logs every step: onCreate/process, onStartCommand action, guard, loadLibrary before/after, extraction marker/files/ms, config write, NodeRuntime class load before/after, native args (path/exists/size), before/after startNodeWithArguments (rc), exceptions with stack, watchReady probes/timeout, onDestroy.
2. dup2 stdout/stderr → opencode-config/server.log BEFORE native start (android.system.Os) → node errors captured even if bootstrap.js never runs. JS tee kept (dupes = dup2-worked signal). 256KB→64KB trim at start.
3. Variant runner ("Все способы запуска Node" button in self-test): ACTION_RUN_VARIANTS + planId (redelivery-safe). Plan in variant-{id,current,remaining}.* files; results variant-results.jsonl; each variant in a FRESH process (killProcess + sticky restart; node can't start twice in-process). Leftover "current" on restart = recorded as CRASH. Variants: eval-hello (runtime boots?), eval-listen (can bind 4096?), require-bootstrap (10s window, sync-throw stack captured, port probe), fresh-normal (wipe extraction + normal start). Plan end → clean normal start.
4. Plugin: runNodeVariants(); debugInfo adds bootLog tail, variantResults, variantState; BootLog line on ACTION_START.
5. Self-test: variants button + live result lines; extraReport now includes boot log tail + variant results.
APK 41,802,135 B, md5 cdae952eafff2bb4d1f3f691ee920d2e. Verified: build OK, DEX contains variant/bootlog strings, 275 nodejs-project assets, tmpfiles re-download md5 matches. NOT device-tested (no emulator in sandbox).

## CI emulator track (approved by Shadow 02:45, option 3)
Local scaffold at ~/apk-opencodepp/ci-mobile (committed locally, NOT pushed): workflow android-emulator.yml (workflow_dispatch apk_url input; KVM; reactivecircus/android-emulator-runner api-34 google_apis x86_64 pixel_6), scripts/run-emulator-test.sh (install, launch, 200s wait, pull state/bootlog/variants/server.log + logcat via run-as, upload artifacts), README (incl. ARM-translation fidelity caveat). PENDING: repo creation in Lumus-ai (proposed: mobile-ci) + one-time PAT via vault (never in chat), then push + first run with v13.6 APK link. Token revoked by Shadow after.

## v13.7 (versionCode 19, 1.3.7) — shipped 2026-10-17 ~03:01 PKT
Fix: v13.6 showed Node actually starts, dies "POC-FATAL EACCES mkdir '/tmp/opencode'" (no /tmp on Android).
ROOT: stage does tmp: path.join(os.tmpdir(), app) (chunk-8hx56thk.js, app="opencode"); os.tmpdir() returned "/tmp" even with TMPDIR set by bootstrap (env-blind/cached in this runtime).
CHANGES (assets only + marker):
1. bootstrap.js rewritten: before importing main.js — mkdir + env TMPDIR/TMP/TEMP→configDir/tmp, HOME→configDir/home, XDG_DATA/CONFIG/CACHE/STATE_HOME→configDir/xdg/*, OPENCODE_TMPDIR; PLUS monkey-patch os.tmpdir()/os.homedir() on the module object.
2. Source patches for named-ESM-import snapshot sites: mkdtemp "opencode-desktop-"/"opencode-browser-" in 5 duplicate chunks (1qs5634c/4eeckmkr/bhmnsbzj/s28twg9d/yjreamez) → OPENCODE_TMPDIR-first; chunk-8hx56thk tmp+home env-first; chunk-bmnfjwe9 tmpdir env-first.
3. NOT patched: "/tmp" literals in bwrap sandbox args (desktop-only code, no bwrap on Android); sql.js /tmp = Emscripten in-memory VFS; bundle.js "/tmp/opp-poc/config" fallback (OPENCODE_CONFIG_DIR always set).
4. Marker .extracted-v3→v4 (assets changed). Web app unchanged (no vite rebuild).
APK 41.8MB, md5 beb476a114f1950b531a9a61af2c0164. Verified: build OK, patches present in APK bootstrap.js/chunks, re-download md5 matches. NOT device-tested. NOTE for server agent: apply tmp/home/xdg redirection upstream in stage build.

## PTY wrapper (received 2026-10-17 05:17 PKT, NOT yet integrated)
From server agent: /downloads/ptywrap-jnilibs.tar-e0abedef.gz → stashed ~/apk-opencodepp/ptywrap/{arm64-v8a,armeabi-v7a,x86_64}/libptywrap.so. ELF PIE executables (NDK r27c, not stripped) — the standard "lib*.so in jniLibs that is actually an exec" trick; PM extracts them (useLegacyPackaging=true), server execs via OPP_PTY_WRAPPER for terminals. bash tool uses OPP_NATIVE_BIN_DIR.
INTEGRATE ONLY AFTER v13.7 confirmed on Shadow's phone (don't mix with diagnostics). Integration steps when green: copy into android-app/android/app/src/main/jniLibs/<abi>/, set env OPP_NATIVE_BIN_DIR + OPP_PTY_WRAPPER (native lib dir path) in bootstrap.js/service before server start, bump marker, new versionCode. Note: arm64-only APK ships only arm64 .so in practice via abiFilters — check splits/abi config before assuming x86_64 lands.

## Redaction requirement (received 05:48 PKT) — IMPLEMENTED, not yet built
All diagnostics scrub password/token/key/cookie → [redacted]; state/ts/errors/paths kept; real handshake untouched (redact-on-read, never on write).
- Redact.java (new, pure Java): 2 layers — registered concrete secrets verbatim + patterns (json fields, key=value, Basic/Bearer). Local unit test PASS.
- BootLog.log applies Redact at the choke point; service registerSecret(password) on every generation (normal + variant); appendResult redacts detail.
- Plugin debugInfo scrubs stateFile/logTail/bootLog/variantResults; new redactSelfTest() fixture method.
- Self-test new "Secret redaction in report" check row (fail on leak OR over-redaction).
- CI: scripts/redact.sh (learns password from state file, scrubs all artifacts) wired into run-emulator-test.sh + fixture artifact test (redact-test.txt PASS/FAIL). Local shell test PASS. Committed in ci-mobile scaffold (still unpushed).
Ships together with ptywrap integration AFTER v13.7 device result.

## v13.8 (versionCode 20, 1.3.8) — shipped 2026-10-17 ~13:21 PKT
Bundles: ptywrap + redact + ICU fixes for v13.7 findings.
1. PTYWRAP: libptywrap.so in jniLibs (3 ABIs in tree; APK keeps arm64 via abiFilters). Service writes nativeLibraryDir into embedded-config.json (nativeBinDir); bootstrap sets OPP_NATIVE_BIN_DIR + OPP_PTY_WRAPPER=<nativeLibDir>/libptywrap.so before server load.
2. REDACT: as documented above (Redact.java + wiring + self-test row + CI script), NOW BUILT IN.
3. ICU (root cause of v13.7 "POC-FATAL SyntaxError \p{L}"): nodejs-mobile node18 = no ICU property escapes. Source-patched ALL fatal literals: freeID/outcomeOf/UNSAFE_NAME in 5 dupe chunks (ranges A-Za-z0-9+C0-24F+0400-04FF+4E00-9FFF; Cc/Cf → explicit ranges), 18x \p{L}\p{Nl} in chunk-kt5hd0ey (shell parsing), \p{Script=Latin} remove_accents in 4 chunks (+normalize guarded), lazy emoji RegExp strings in 6 chunks → explicit emoji ranges (verified: 😀/👍🏽/™ true, abc false). normalize("NFC") guarded in 5 dupes. NOT patched: minimatch POSIX-class tables (chunk-gjf01svj/m3ha2vd6, lazy construction, m3ha2vd6 already guards parseClass=undefined) — a glob with [[:alpha:]] could still throw at call time.
4. bootstrap.js: ICU probe (logs "icu \p support: NO" to server.log), String.prototype.normalize passthrough shim if it throws, minimal Intl shim only if Intl missing entirely.
5. Double-start hardening: per-process NATIVE START #n logging (flags DOUBLE START), nodeThreadRunning reset when native returns (was stuck true), skip-logs for duplicate start requests.
Verified: all 17 edited JS files parse (node --input-type=module --check); rewritten regexes behavior-tested on desktop node22 (Cyrillic/CJK/Latin letters kept by slugify, control chars detected, shell-word rules ok, emoji ok). Desktop node is v22 — v18 runtime NOT simulated (no v18 in sandbox; nodejs-mobile's no-ICU env can't be reproduced here, but patched regexes use zero ICU features). APK md5 dd8486ccffab6fd3fcdfc4a4a68fb03f, re-download verified. libptywrap.so present (arm64). NOT device-tested.

## v13.9 (versionCode 21, 2026-10-17)
- Fix: ERR_NO_ICU `fatal` TextDecoder crash. Full ICU audit of bundle: 5 dupe chunks had top-level `new TextDecoder("utf-8",{fatal:true})` (killer), chunk-w46yhtyn global URL.domainToASCII, Intl lazy, no Buffer.transcode.
- minimatch POSIX tables (chunk-gjf01svj.js, chunk-m3ha2vd6.js) rewritten to explicit ranges — zero `\p{` left in bundle (bootstrap's 1 = intentional probe string).
- bootstrap.js shims (before main.js import): TextDecoder wrapper (strips fatal/ignoreBOM, unknown labels→utf-8, only when native probe fails); full Intl shim set (DateTimeFormat, NumberFormat, Collator, PluralRules, ListFormat, RelativeTimeFormat, DisplayNames, Segmenter, Locale, getCanonicalLocales); normalize passthrough; global URL.domainToASCII/domainToUnicode try/catch identity fallback.
- Self-test: new FIRST variant "icu-probe" — raw node probe of TextDecoder(fatal/1251)/TextEncoder/Intl.*/normalize/localeCompare/toLocaleString/\p/domainToASCII(ascii+unicode)/buffer.transcode → JSON → variant result. Marker log text now prints real marker name.
- Marker .extracted-v5 → .extracted-v6; versionCode 21 / 1.3.9.
- Desktop no-ICU simulation harness (broken globals + import bootstrap): PASS — TextDecoder wrapped, server boots, migrates, LISTENS on 4096, 401-gated UI responds, zero ERR_NO_ICU.
- APK: 41.8MB, md5 9324e5a465f2284a5d477ff48e1a9bf6, tmpfiles wJA4ckZD62zU (dl/1792226185.750094d628ca9421), re-download md5 verified.
- Open risk: eval-listen native FORTIFY crash on realme (listen-on-4096) — watch next device run.

## v13.10 (versionCode 22, 2026-10-17)
- Fix: stuck diagnostic mode after upgrade (v13.9 device kept a half-finished v13.8 variant plan; state=diagnostic forever, new bootstrap never ran).
- resetOnVersionChange(): on versionCode change wipe variant plan/results/state file/crash guard/server.log/boot log/probe files before anything else.
- Plan staleness auto-reset: plan files idle >10min => plan wiped, normal server start (covers orphaned plans from crashes/hangs).
- Per-variant hard cap unified to 60s (VARIANT_TIMEOUT_MS).
- Every variant now writes a "running" result BEFORE the native call (v13.9: eval-listen died natively, results showed only eval-hello).
- eval-listen instrumented with disk step markers (js-entered>http-required>server-created>listen-called>listening-callback>exiting) — native abort leaves the last marker as crime scene; result detail includes steps.
- icu-probe runs once per version (probe-icu-done.txt); later plans replay the cached result.
- Marker .extracted-v6 -> .extracted-v7; versionCode 22 / 1.3.10.
- CI run 39017918892 (v13.9 APK): GREEN 6m4s on API34 x86_64 emulator (arm64 translation) — extraction 275 files, NATIVE START #1 only, watchReady ready after 63.9s, state ready, REDACTION TEST PASS. First full end-to-end green.
- v13.10 dispatched as run 39018454188 via browser UI.
- APK: md5 1887d2bf8a058003b18c6ea1c95cae87, tmpfiles wZAqcxZnjoz2 (dl/1792226902.53ae6da2083bb4f7), re-download md5 verified.

## v13.11 (versionCode 23, 2026-10-17)
- Root cause of v13.10 "Failed to fetch": CORS. WebView origin http://localhost -> 127.0.0.1:4096; Authorization header forces preflight the server never answered; 401 responses carried no CORS headers either (server.log showed the 401s). Fixed in bootstrap.js BEFORE main.js import: http.Server.prototype.emit patch answers OPTIONS 204 + reflects Origin + Allow-Credentials/Headers/Methods on every response. Desktop-sim verified: preflight 204 with headers, GET 401 carries ACAO.
- Harness fix: my no-ICU sim over-simulated (threw on ignoreBOM too; real no-ICU node only rejects fatal + non-utf8 labels). Also node:http must be required lazily (createRequire) — static ESM import breaks boot under broken TextDecoder on node22.
- WebView fetch probe (embedded.ts runFetchProbe): runs once after server ready (no-auth expect readable 401, basic-auth expect 200), records origin/URL/status/error, persists via new plugin writeFetchProbe -> files/fetch-probe.json; debugInfo includes fetchProbe; self-test row "WebView fetch probe" + "VPN / proxy state" (ConnectivityManager TRANSPORT_VPN + default proxy in deviceInfo).
- CI: run-emulator-test.sh grabs fetch-probe.json + screencap artifacts/screen.png, FAILS the job unless the basic-auth probe is ok.
- Safe-area: .settings-mobile-nav padding-top calc(8px + env(safe-area-inset-top)) — Android 15 edge-to-edge put the back button under the status bar.
- System back: MainActivity.onBackPressed dispatches "app-back-button" into the page; settings surface closes itself and sets __APP_BACK_HANDLED__; otherwise default behavior. (No @capacitor/app dependency needed.)
- Marker .extracted-v7 -> .extracted-v8; versionCode 23 / 1.3.11.
- Build gotcha SOLVED: vite build OOM was sourcemaps (rolldown native RSS balloon ~1.2GB) — vite.config sourcemap:false makes the build fast and small-memory. RAYON_NUM_THREADS irrelevant.
- Runs: 39018454188 (v13.10) SUCCESS; 39017918892 (v13.9) SUCCESS; 39019949461 (v13.11) dispatched with new fetch-probe assert.
- PAT #2 (instinct-ci-onetime-2, 1d, repo+workflow) minted for push 7ab0c37, used, deleted in GitHub settings, local copy shredded.
- APK: md5 9d887a0b9f6794614d476d8471045b75, tmpfiles wYAqcXcYwuP9 (dl/1792228319.64c524814c95e991), re-download md5 verified.

## v13.11 respin (same versionCode 23, 2026-10-17 ~14:21)
- CI run 39019949461 FAILED on my new fetch-probe assert: fetch-probe.json missing on device. Root cause: assets/public held the STALE v13.8 web bundle — `npx cap copy android` was never run after the dist rebuild, so v13.9/v13.10/v13.11(first) all shipped v13.8 web code. Fixed: cap copy, APK rebuilt.
- Gotcha logged: after every vite build, run `npx cap copy android` before gradle (gradle does NOT sync webDir).
- New APK md5 08ed244370035d842a83b1c23c96da4b, tmpfiles wVAJcPc4XG1l (dl/1792229213.011123252ddfca76), verified. Old link (9d887a0b...) SUPERSEDED — tell Shadow not to use it.
- Run 39020857327 dispatched via browser UI.

v13.12 (versionCode 24, 2026-10-17 ~14:43):
- Fixes v13.11 realme leftovers: (1) fs/list path=. 500: bootstrap chdirs to cfg.projectsDir (filesDir/projects, created by NodeServerService.writeConfig, new embedded-config.json field projectsDir); (2) free opencode models invisible: TWO bugs — embedded /api/provider lists only integrations so normalizeProviderList never had an opencode provider (app now synthesizes the entry from the model catalog when missing, global-sync/utils.ts) AND cost is an ARRAY of tiers server-side so isFree/self-test free-count (cost.input object check) always read 0 free (self-test now array-safe); (3) /api/event 401 loop: NodeServerService regenerated the password EVERY node start while the WebView persists it -> all SDK calls 401 after any restart; password now stable per install (filesDir/embedded-password.txt via ensurePassword()); createApiForServer also prefers live window.__OPENCODE_EMBEDDED__ password for the local URL.
- Marker .extracted-v8 -> v9 (bootstrap/service changed).
- APK 58,832,238 B, md5 73da1adf95c6b0af9a9866e5a7813f2a. Verified: build OK, versionCode 24, patches in APK (bootstrap chdir 4 hits, DEX has embedded-password + extracted-v9), tmpfiles re-download md5 matches. NOT device-tested.
- tmpfiles: https://tmpfiles.org/wTAwcQnVKUrh/opencodepp-v13.12-embedded.apk (direct .../dl/1792230533.71e18c3666141737/wTAwcQnVKUrh/...)

v13.13 (versionCode 25, 2026-10-17 ~15:01):
- REGRESS FIX: v13.12 web bundle was built WITHOUT VITE_OPENCODE_EMBEDDED=1 (plain vite build) -> app fell to standalone on realme. Rebuilt with the env flag. Build-flavor marker added: embedded.ts sets globalThis.__BUILD_FLAVOR__="embedded" under a constant-folded flag check (DCE-verified: absent in no-flag build, present in embedded build). build-apk.sh guards: greps marker in dist, APK assets, and built APK (fails loudly). CI: run-emulator-test.sh now fails fast on missing marker (committed via web editor, commit on main).
- VPN/proxy self-test row REMOVED per Shadow + plugin deviceInfo vpnActive/proxy code removed (DEX verified: 0 hits).
- entry.tsx: standalone->embedded reload is now a counter (max 3 reloads per app start, reset on successful embedded boot) instead of one-shot — the ARM-translated CI emulator needs >1 round (root cause of v13.11-respin + v13.12 CI fetch-probe failures: app stayed standalone, probe never ran).
- All v13.12 fixes carried: bootstrap chdir projectsDir, opencode provider synthesis, cost-array free checks, stable per-install password.
- APK 58,610,215 B, md5 d97080b2e1589337f6a4432f8b93c967. Verified: vc 25, marker in APK, embedded-password + chdir present, vpnActive absent, tmpfiles re-download md5 matches. NOT device-tested.
- tmpfiles: https://tmpfiles.org/wkA1cHnGj0cg/opencodepp-v13.13-embedded.apk (direct .../dl/1792231621.5c3779bfa7fd90a4/wkA1cHnGj0cg/...)
- CI: run 39023374509 dispatched for v13.13.

*** BASELINE "WORKING" = v13.13 (versionCode 25, md5 d97080b2e1589337f6a4432f8b93c967) ***
Shadow realme self-test 2026-10-17 ~15:10: ALL PASS except prompt test (no provider connected — expected before login). Manual check of free opencode model + website login in progress. All future versions build on v13.13; any regress is measured against this. Local copies: /tmp/opencodepp-v13.13-embedded.apk (scratch, regenerate via build-apk.sh), sources in ~/apk-opencodepp/{repo,android-app}.
"Any phone" plan (16KB pages, remote-server fallback mode, OEM hardening) WAITS for Shadow's explicit yes — do not start.

v13.14 (versionCode 26, 2026-10-17 ~15:30):
- Shadow's 5 findings fixed (approved "Делай"): (1) builds now set VITE_OPENCODE_EMBEDDED=1 + VITE_OPENCODE_SERVER_MODE=none (build-apk.sh); marker extended to "embedded-noserver" and asserted in build script; (2) web.ts getCurrentServerUrl returns undefined on Capacitor native + embedded (kills the ghost "localhost" server = location.origin stealing scope "local"); (3) normalizeServerUrl folds http://localhost → http://127.0.0.1; (4) settings system-back closes an open menu/popover/dialog (Escape) before closing the surface; (5) single server → settings shows plain desktop tabs again.
- Root cause note: ghost server = location.origin of the WebView (http://localhost), provided by entry.tsx as canonicalLocalServer -> scope "local" bound to dead URL -> dead chat selectors + empty localhost settings tab. v13.9-v13.13 all carried it (flag dropped since v12.x).
- CI script: PK-signature check on downloaded app.apk (tmpfiles served HTML to the runner once -> misleading flavor error) + device-state/boot-log/files/logcat dump into job log (kept from diag edit).
- APK 58,610,487 B, md5 1a3a916caa7a18de3071f87dd5b09201. Verified: vc26, embedded-noserver marker in APK, guard+synthesis present, no VPN strings, re-download md5 matches. NOT device-tested (selectors/settings-exit clickability unverified - needs Shadow's realme).
- tmpfiles: https://tmpfiles.org/wAAocZnxmKh8/opencodepp-v13.14-embedded.apk (direct .../dl/1792233364.c8ade2cb73033bcf/wAAocZnxmKh8/...), expires ~16:31.
- CI: run 39025269519 dispatched (v13.14).

v13.15 (versionCode 27, 2026-10-17 ~16:05):
- Fix: settings exit ("Назад в приложение" + system back) dead. Root cause: surface.close()/root back() delegated to command "common.goBack", which only the Titlebar registers; settings also renders BARE (AppLayout fallback when no server reachable / health flap) with no Titlebar -> silent no-op. Reproduced healthy-path OK in headless Chrome; bare-branch deadness confirmed by code path.
- Change (settings/surface.tsx only): close()/root-back now navigate directly to source route (session -> /server/<key>/session/<id>, draft -> /new-session?draftId=, else "/") with replace:true. No titlebar/history dependency; same target URL as before in the normal branch.
- build-apk.sh: fixed flaky APK marker check (pipefail + grep -q SIGPIPE); APK marker verified.
- APK 58,832,238 B, md5 905516779a810781389ed1037e62c950, zipalign+apksigner OK, re-download md5 matches. tmpfiles: https://tmpfiles.org/wbARcMMayKiP/opencodepp-v13.15-embedded.apk
- NOT device-tested: actual exit on realme awaits Shadow. CI for v13.15 not run (v13.14 run 39025269519 unchecked).

CI run 39025269519 (v13.14): FAILURE, infra not app. PK PASS, FLAVOR PASS, FETCH PROBE FAIL: "run-as: package not debuggable" — release APK blocks adb run-as, so all device-state grabs empty. Fix candidates: (a) adb root + direct /data/data reads in run-emulator-test.sh; (b) debuggable build for CI. Awaiting decision via parent.
