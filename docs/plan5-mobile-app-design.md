# Plan 5: Mobile App — Technical Design

## 1. Overview

The AnyClaw mobile app is a thin Expo (React Native) shell that wraps the agent-built web UI in a WebView and provides the four native capabilities that must work even when the agent-built app is broken: connection management, task dispatch (with clarification Q&A), version history with rollback, and settings.

**Four responsibilities:**

1. **WebView viewer** — A full-screen WebView loads the agent-built React frontend from the user's server at `/app/*`. The native shell and the WebView communicate via a postMessage/onMessage JS bridge. The session token is injected via the bridge after page load (never in the URL).
2. **Task dispatch** — A dedicated "Request" tab with a strict state machine (idle → input → clarifying → working → deploying → done/failed). Submits requests to the dispatch/MCP server at `/api/*` and observes progress via PocketBase Realtime SSE on `/pb/*`. Survives app close/reopen — pending clarification questions resume on next launch.
3. **Version history & rollback** — A "Versions" tab lists deployments with agent-written descriptions. Rollback calls `POST /api/rollback` and always works (the dispatch server is its own supervised process outside the agent's writable path), even when the logic service is crash-looping.
4. **Settings** — Clarification timeout mode, API key management, connection/server management, device re-pair flow, and an opt-in debug mode for encrypted traffic.

**Server-side routing (reminder from main spec).** The user's host runs several independently supervised processes behind a single tunnel endpoint. The tunnel manager uses an in-envelope service tag to route traffic:

| Path | Process | Purpose |
|------|---------|---------|
| `/app/*` | Prod static server | Serves the agent-built React bundle into the WebView |
| `/api/*` | Dispatch/MCP server | Task dispatch, rollback, versions, restart-app, health. Always available. |
| `/pb/*` | PocketBase | Data, auth, realtime SSE for `_tasks`, `_deployments`, `_agent_messages` |

All traffic is TLS-encrypted to the broker relay; sensitive API payloads are additionally NaCl-box encrypted end-to-end so the broker cannot read them even if compromised.

---

## 2. Tech Stack

| Concern | Library | Notes |
|---------|---------|-------|
| Framework | Expo SDK 52 (managed workflow) | EAS Build + EAS Update + Expo Push; no native code until WebRTC Phase 2 |
| Routing | `expo-router` v4 | File-based routes, tabs + stack, deep links |
| WebView | `react-native-webview` 13.x | Bidirectional JS bridge, `onRenderProcessGone` |
| State | `zustand` 5.x | Stores for connection, task, versions, settings |
| PocketBase client | `pocketbase` 0.25.x | REST + Realtime SSE; handles reconnect |
| OAuth | `expo-auth-session` + `expo-web-browser` | Google, Apple, GitHub |
| Secure storage | `expo-secure-store` | iOS Keychain / Android Keystore |
| NaCl crypto | `libsodium-wrappers` | WASM, maintained by libsodium team |
| Base64 util | `tweetnacl-util` | Interop helpers for byte <-> base64 |
| Push notifications | `expo-notifications` + `expo-device` | Expo Push service |
| Haptics / safe area | `expo-haptics`, `react-native-safe-area-context` | — |
| Animations | `react-native-reanimated` 3.x | Bottom sheet, task card transitions |
| Dates | `date-fns` | Version timestamps |
| Testing | `jest-expo`, `@testing-library/react-native` | — |

```json
{
  "dependencies": {
    "expo": "~52.0.0",
    "expo-router": "~4.0.0",
    "expo-secure-store": "~14.0.0",
    "expo-notifications": "~0.29.0",
    "expo-auth-session": "~6.0.0",
    "expo-web-browser": "~14.0.0",
    "expo-haptics": "~14.0.0",
    "expo-device": "~7.0.0",
    "expo-constants": "~17.0.0",
    "react-native-webview": "13.x",
    "react-native-reanimated": "~3.16.0",
    "react-native-safe-area-context": "~5.0.0",
    "react-native-gesture-handler": "~2.20.0",
    "zustand": "^5.0.0",
    "pocketbase": "^0.25.0",
    "libsodium-wrappers": "^0.7.15",
    "tweetnacl-util": "^0.15.1",
    "date-fns": "^4.0.0"
  }
}
```

---

## 3. Platform Requirements

- **iOS 15.1+** (Expo SDK 52 default). WKWebView with modern JS engine.
- **Android API 28+** (Android 9.0+). Drops ~5% of devices. Required for reliable Chromium WebView, dark-mode APIs, and biometric auth.

```json
// app.json
{
  "expo": {
    "name": "AnyClaw",
    "scheme": "anyclaw",
    "ios": { "bundleIdentifier": "com.anyclaw.app", "deploymentTarget": "15.1" },
    "android": { "package": "com.anyclaw.app", "minSdkVersion": 28 },
    "plugins": ["expo-router", "expo-secure-store"]
  }
}
```

---

## 4. Project Structure

```
anyclaw-mobile/
├── app.json
├── package.json
├── tsconfig.json
├── app/                              # expo-router file-based routes
│   ├── _layout.tsx                   # Root: providers + auth gate
│   ├── (auth)/
│   │   ├── _layout.tsx               # Stack
│   │   ├── login.tsx                 # OAuth (Google / Apple / GitHub)
│   │   ├── server-list.tsx           # Pick an online server
│   │   └── pair.tsx                  # BIP39 verification code display
│   └── (main)/
│       ├── _layout.tsx               # Tab navigator
│       ├── index.tsx                 # Home  — WebView
│       ├── request.tsx               # Request — task dispatch
│       ├── versions.tsx              # Versions — history + rollback
│       ├── settings.tsx              # Settings
│       └── task/[id].tsx             # Deep-link target for push notifications
├── components/
│   ├── WebViewShell.tsx
│   ├── TaskCard.tsx
│   ├── TaskInput.tsx
│   ├── ClarifyingQuestion.tsx
│   ├── ActivityLog.tsx
│   ├── VersionRow.tsx
│   ├── RollbackConfirm.tsx           # Bottom sheet
│   ├── ConnectionStatus.tsx          # Header badge
│   └── Bip39VerificationCard.tsx
├── lib/
│   ├── api.ts                        # Encrypted REST client for /api/*
│   ├── bridge.ts                     # WebView <-> native JS bridge helpers
│   ├── auth.ts                       # OAuth + broker JWT management
│   ├── crypto.ts                     # libsodium init, pairing, box encrypt/decrypt
│   ├── pocketbase.ts                 # PocketBase init + SSE subscribe helpers
│   ├── broker.ts                     # Broker API (auth, servers, connect, key-exchange)
│   └── notifications.ts              # Expo Push registration + deep-link handler
├── stores/
│   ├── connection.ts
│   ├── task.ts
│   ├── versions.ts
│   └── settings.ts
└── types/
    ├── task.ts
    ├── version.ts
    └── server.ts
```

---

## 5. Navigation Structure

### Hierarchy

```
Root Layout (_layout.tsx)
├── Auth gate (reads expo-secure-store on launch)
│
├── (auth) — Stack
│   ├── login         — OAuth buttons
│   ├── server-list   — Pick server from broker registry
│   └── pair          — Show BIP39 verification code, confirm
│
└── (main) — Tabs
    ├── Home      — WebView (full-bleed, no header)
    ├── Request   — Task dispatch (state machine card)
    ├── Versions  — History list + rollback
    └── Settings  — Account, keys, server, re-pair, debug
```

The Request tab shows a `!` badge whenever `activeTask.state === "clarifying"`.

### Root layout (auth gate)

```tsx
// app/_layout.tsx
import { Slot, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { useConnectionStore } from "@/stores/connection";

export default function RootLayout() {
  const { isAuthenticated, isConnected, restoreSession } = useConnectionStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => { restoreSession(); }, []);

  useEffect(() => {
    const inAuth = segments[0] === "(auth)";
    if (!isAuthenticated && !inAuth) router.replace("/(auth)/login");
    else if (isAuthenticated && !isConnected && !inAuth) router.replace("/(auth)/server-list");
    else if (isAuthenticated && isConnected && inAuth) router.replace("/(main)");
  }, [isAuthenticated, isConnected, segments]);

  return <Slot />;
}
```

### Main tab layout

```tsx
// app/(main)/_layout.tsx
import { Tabs } from "expo-router";
import { useTaskStore } from "@/stores/task";
import { ConnectionStatus } from "@/components/ConnectionStatus";

export default function MainLayout() {
  const pending = useTaskStore(s => s.activeTask?.state === "clarifying");
  return (
    <Tabs screenOptions={{ headerRight: () => <ConnectionStatus />, tabBarActiveTintColor: "#7C3AED" }}>
      <Tabs.Screen name="index"    options={{ title: "Home",     headerShown: false }} />
      <Tabs.Screen name="request"  options={{ title: "Request",  tabBarBadge: pending ? "!" : undefined }} />
      <Tabs.Screen name="versions" options={{ title: "Versions" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
```

---

## 6. WebView Integration

### URL routing and auth

The WebView loads `${serverUrl}/app/` — never with the token in the URL. A bridge-init script fires `bridge-ready`; the native shell responds with `session-token`; the frontend then uses that token for its own PocketBase calls.

```tsx
// components/WebViewShell.tsx
import { useRef, useCallback, useState } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { useConnectionStore } from "@/stores/connection";
import { useVersionStore } from "@/stores/versions";
import { parseBridgeMessage, sendBridgeMessage } from "@/lib/bridge";
import { ErrorScreen } from "./ErrorScreen";

const BRIDGE_INIT = `
  window.AnyClaw = {
    postMessage: (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m)),
    onMessage: null,
  };
  document.addEventListener('message', (e) => {
    try { const m = JSON.parse(e.data); window.AnyClaw.onMessage && window.AnyClaw.onMessage(m); } catch {}
  });
  window.AnyClaw.postMessage({ type: 'bridge-ready' });
  true;
`;

export function WebViewShell() {
  const ref = useRef<WebView>(null);
  const { serverUrl, sessionToken, connectionState } = useConnectionStore();
  const [err, setErr] = useState<{ kind: "unreachable" | "app-broken" | "auth"; msg: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const msg = parseBridgeMessage(event.nativeEvent.data);
    if (!msg) return;
    switch (msg.type) {
      case "bridge-ready":
        sendBridgeMessage(ref, { type: "session-token", token: sessionToken! });
        break;
      case "navigate-to-versions":
        // expo-router handles navigation; emit an event or use router imperatively
        break;
    }
  }, [sessionToken]);

  if (err) return <ErrorScreen kind={err.kind} message={err.msg} onRetry={() => { setErr(null); ref.current?.reload(); }} />;

  return (
    <View style={{ flex: 1 }}>
      {loading && <ActivityIndicator style={StyleSheet.absoluteFill} size="large" />}
      <WebView
        ref={ref}
        source={{ uri: `${serverUrl}/app/` }}
        originWhitelist={[serverUrl!]}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        onLoadEnd={() => setLoading(false)}
        injectedJavaScriptBeforeContentLoaded={BRIDGE_INIT}
        onError={(e) => setErr({ kind: "unreachable", msg: e.nativeEvent.description })}
        onHttpError={(e) => {
          const s = e.nativeEvent.statusCode;
          if (s === 401) setErr({ kind: "auth", msg: "Session expired" });
          else if (s >= 500) setErr({ kind: "app-broken", msg: `Server error ${s}` });
        }}
        onRenderProcessGone={() => ref.current?.reload()}
        onContentProcessDidTerminate={() => ref.current?.reload()}
      />
    </View>
  );
}
```

### Bridge protocol

```typescript
// lib/bridge.ts
export type WebViewToNative =
  | { type: "bridge-ready" }
  | { type: "navigate-to-request" }
  | { type: "navigate-to-versions" }
  | { type: "health-check" };

export type NativeToWebView =
  | { type: "session-token"; token: string }
  | { type: "reload" }
  | { type: "theme-changed"; theme: "light" | "dark" }
  | { type: "health-check-ack" };

export type BridgeMessage = WebViewToNative | NativeToWebView;

export function parseBridgeMessage(raw: string): BridgeMessage | null {
  try { const p = JSON.parse(raw); return typeof p?.type === "string" ? p : null; } catch { return null; }
}
export function sendBridgeMessage(ref: React.RefObject<WebView>, msg: NativeToWebView) {
  const payload = JSON.stringify(msg).replace(/'/g, "\\'");
  ref.current?.injectJavaScript(
    `document.dispatchEvent(new MessageEvent('message', { data: '${payload}' })); true;`
  );
}
```

### Reload-on-deploy

The connection store subscribes to `_deployments` via PocketBase Realtime SSE. On a create event, it both reloads the WebView and refreshes the version list:

```typescript
pb.collection("_deployments").subscribe("*", (e) => {
  if (e.action === "create") {
    webViewRef.current?.reload();
    useVersionStore.getState().fetchVersions();
  }
});
```

### Error handling matrix

| Scenario | Detection | Behavior |
|----------|-----------|----------|
| Tunnel down / server unreachable | `onError` or network failure in `lib/api` | Red header badge, full-screen reconnect card, exponential backoff |
| Logic service crashed (5xx on `/app/*` API calls) | `onHttpError >= 500` | "Your app has a problem" screen with a prominent "Open Version History" button routing to Versions tab |
| Prod static server crashed | WebView load failure | Same "app broken" screen; Versions tab still functional via `/api/*` |
| Session token expired (401 on `/app/*`) | `onHttpError 401` | Silent refresh against broker; on failure, log out |
| WebView content process died | `onRenderProcessGone` / `onContentProcessDidTerminate` | Auto-reload, toast |
| Dispatch server down | `/api/health` fails | Header badge turns red; submit button disabled; Versions tab becomes read-only |
| PocketBase SSE dropped | SDK `onError` | SDK auto-reconnects; on reconnect, refetch `_tasks` for the active task |

**Emergency rollback is always available.** Because the dispatch/MCP server is a separately supervised process with `restart=always` whose source lives outside the agent's writable path, `POST /api/rollback` and `GET /api/versions` work whenever the tunnel is up — even when `/app/*` is completely broken. The Versions tab never depends on `/app/*` being healthy.

---

## 7. Task Dispatch UI

### State machine

```
                 +-------+
                 | idle  |
                 +---+---+
                     | user submits
                     v
                 +-------+    submit fails    +--------+
                 | input |------------------->| failed |
                 +---+---+                    +----+---+
           accepted  |                             ^
                     v                             |
        +---------+  |  +---------+ error          |
        |clarify  |<-+->| working |----------------+
        +----+----+     +----+----+                |
             | answer        | agent done          |
             v               v                     |
          working       +---------+    fail        |
                        |deploying|----------------+
                        +----+----+
                             | success
                             v
                         +------+
                         | done |--> user dismiss --> idle
                         +------+
```

Only one active task at a time. Transitions are driven by PocketBase SSE updates on `_tasks`, with optimistic local updates where appropriate.

### Zustand task store

```typescript
// stores/task.ts
import { create } from "zustand";
import { apiClient } from "@/lib/api";
import { subscribeToTask, getPocketBase } from "@/lib/pocketbase";

export type TaskState = "idle" | "input" | "clarifying" | "working" | "deploying" | "done" | "failed";

export interface ActivityEntry { timestamp: string; message: string; level: "info" | "warn" | "error"; }

export interface ActiveTask {
  id: string;
  request: string;
  state: TaskState;
  question?: string;
  qaHistory: { question: string; answer: string }[];
  progressSummary?: string;
  activityLog: ActivityEntry[];
  versionDescription?: string;
  error?: string;
  createdAt: string;
}

interface ServerTaskRecord {
  id: string;
  request: string;
  state: TaskState;
  question?: string;
  qaHistory?: { question: string; answer: string }[];
  progressSummary?: string;
  activityLog?: ActivityEntry[];
  versionDescription?: string;
  error?: string;
  created: string;
}

interface TaskStore {
  activeTask: ActiveTask | null;
  pastTasks: ActiveTask[];
  _unsubscribe: (() => void) | null;

  submitTask: (request: string) => Promise<void>;
  answerQuestion: (answer: string) => Promise<void>;
  cancelTask: () => Promise<void>;
  retryTask: () => Promise<void>;
  dismissTask: () => void;
  resumeActiveTask: () => Promise<void>;
  _applyServerRecord: (rec: ServerTaskRecord) => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  activeTask: null,
  pastTasks: [],
  _unsubscribe: null,

  submitTask: async (request) => {
    const idempotencyKey = crypto.randomUUID();
    set({
      activeTask: {
        id: idempotencyKey, request, state: "input",
        qaHistory: [], activityLog: [], createdAt: new Date().toISOString(),
      },
    });
    try {
      const { taskId } = await apiClient.post<{ taskId: string }>("/api/tasks", { request, idempotencyKey });
      const unsub = subscribeToTask(taskId, (rec) => get()._applyServerRecord(rec));
      set((s) => ({
        _unsubscribe: unsub,
        activeTask: s.activeTask ? { ...s.activeTask, id: taskId, state: "working" } : null,
      }));
    } catch (e: any) {
      set((s) => ({
        activeTask: s.activeTask ? { ...s.activeTask, state: "failed", error: e.message } : null,
      }));
    }
  },

  answerQuestion: async (answer) => {
    const t = get().activeTask;
    if (!t || t.state !== "clarifying" || !t.question) return;
    set((s) => ({
      activeTask: s.activeTask ? {
        ...s.activeTask,
        qaHistory: [...s.activeTask.qaHistory, { question: t.question!, answer }],
        question: undefined,
        state: "working",
      } : null,
    }));
    await apiClient.post(`/api/tasks/${t.id}/answer`, { answer });
  },

  cancelTask: async () => {
    const t = get().activeTask;
    if (!t) return;
    await apiClient.post(`/api/tasks/${t.id}/cancel`, {});
    get().dismissTask();
  },

  retryTask: async () => {
    const t = get().activeTask;
    if (!t || t.state !== "failed") return;
    const request = t.request;
    get().dismissTask();
    await get().submitTask(request);
  },

  dismissTask: () => {
    get()._unsubscribe?.();
    set((s) => ({
      _unsubscribe: null,
      activeTask: null,
      pastTasks: s.activeTask ? [s.activeTask, ...s.pastTasks].slice(0, 50) : s.pastTasks,
    }));
  },

  // Runs on app launch — resume any in-flight task so clarification questions survive close/reopen.
  resumeActiveTask: async () => {
    const pb = getPocketBase();
    const res = await pb.collection("_tasks").getList(1, 1, {
      filter: 'state != "done" && state != "failed" && state != "cancelled"',
      sort: "-created",
    });
    if (res.items.length === 0) return;
    const rec = res.items[0] as unknown as ServerTaskRecord;
    get()._applyServerRecord(rec);
    const unsub = subscribeToTask(rec.id, (r) => get()._applyServerRecord(r));
    set({ _unsubscribe: unsub });
  },

  _applyServerRecord: (rec) => set((s) => ({
    activeTask: {
      id: rec.id,
      request: rec.request,
      state: rec.state,
      question: rec.question,
      qaHistory: rec.qaHistory ?? s.activeTask?.qaHistory ?? [],
      progressSummary: rec.progressSummary,
      activityLog: rec.activityLog ?? s.activeTask?.activityLog ?? [],
      versionDescription: rec.versionDescription,
      error: rec.error,
      createdAt: rec.created,
    },
  })),
}));
```

### TaskCard component

```tsx
// components/TaskCard.tsx
import { View, Text, Pressable } from "react-native";
import { useTaskStore } from "@/stores/task";
import { TaskInput } from "./TaskInput";
import { ClarifyingQuestion } from "./ClarifyingQuestion";
import { ActivityLog } from "./ActivityLog";

export function TaskCard() {
  const { activeTask, cancelTask, retryTask, dismissTask } = useTaskStore();
  if (!activeTask) return <TaskInput />;

  const t = activeTask;
  switch (t.state) {
    case "input":
      return <Card><Text>{t.request}</Text><Text>Sending...</Text></Card>;
    case "clarifying":
      return (
        <Card>
          <Text style={styles.request}>{t.request}</Text>
          {t.qaHistory.map((qa, i) => (
            <View key={i}>
              <Text style={styles.agentQ}>{qa.question}</Text>
              <Text style={styles.userA}>{qa.answer}</Text>
            </View>
          ))}
          <ClarifyingQuestion question={t.question!} />
        </Card>
      );
    case "working":
    case "deploying":
      return (
        <Card>
          <Text style={styles.request}>{t.request}</Text>
          <Text>{t.state === "deploying" ? "Deploying..." : "Working..."}</Text>
          {t.progressSummary && <Text>{t.progressSummary}</Text>}
          <ActivityLog entries={t.activityLog} />
          <Pressable onPress={cancelTask}><Text>Cancel</Text></Pressable>
        </Card>
      );
    case "done":
      return (
        <Card style={styles.success}>
          <Text>Done</Text>
          <Text>{t.versionDescription}</Text>
          <Pressable onPress={dismissTask}><Text>Dismiss</Text></Pressable>
        </Card>
      );
    case "failed":
      return (
        <Card style={styles.error}>
          <Text>Task failed</Text>
          <Text>{t.error}</Text>
          <Pressable onPress={retryTask}><Text>Retry</Text></Pressable>
          <Pressable onPress={dismissTask}><Text>Dismiss</Text></Pressable>
        </Card>
      );
  }
}
```

### Clarification Q&A and resume-after-close

Clarification questions live in PocketBase `_agent_messages` (and are mirrored on the `_tasks` record). Because PocketBase is its own supervised process and task state is persisted server-side, the user can close the app in the middle of a Q&A round and reopen hours later — `resumeActiveTask()` runs on every app launch, finds any task not in a terminal state, restores it into the store, and re-subscribes to SSE. A push notification (see §12) ensures the user knows a question is pending even if the app is backgrounded.

### Dispatch server endpoints

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| POST | `/api/tasks` | `{ request, idempotencyKey }` | Submit task. Idempotent upsert keyed by client-generated UUID. |
| POST | `/api/tasks/:id/answer` | `{ answer }` | Reply to a clarifying question |
| POST | `/api/tasks/:id/cancel` | `{}` | Cancel a running task |
| GET  | `/api/versions` | — | List deployment history |
| POST | `/api/rollback` | `{ versionId }` | Atomic code + DB rollback (always available) |
| POST | `/api/restart-app` | `{}` | Restart the logic service (crash-loop recovery) |
| GET  | `/api/health` | — | Per-process health |

---

## 8. Version History & Rollback

### Versions tab layout

```
+------------------------------------------------+
|  Version History                  [Reconnect]  |
+------------------------------------------------+
|  v12  "Added mood tracker with charts"  [now]  |
|  Apr 5, 2026 - 2:34 PM - 3 files               |
+------------------------------------------------+
|  v11  "Fixed navigation bug on habits page"    |
|  Apr 5, 2026 - 11:12 AM - 1 file               |
+------------------------------------------------+
|  v10  "Added daily habits checklist"           |
|  Apr 4, 2026 - 4:58 PM - 7 files               |
+------------------------------------------------+
```

Tapping a row expands it inline to show the full agent-written description and a "Rollback to this version" button (hidden for the current version).

### Data model and fetch

```typescript
export interface VersionInfo {
  id: string;
  versionNumber: number;
  description: string;      // agent-written, non-technical
  gitCommitHash: string;
  hasDbSnapshot: boolean;   // distinct messaging in the rollback sheet
  filesChanged: number;
  createdAt: string;
  isCurrent: boolean;
}
```

```typescript
// stores/versions.ts
import { create } from "zustand";
import { apiClient } from "@/lib/api";

interface VersionStore {
  versions: VersionInfo[];
  isLoading: boolean;
  error: string | null;
  fetchVersions: () => Promise<void>;
  rollbackTo: (versionId: string) => Promise<void>;
}

export const useVersionStore = create<VersionStore>((set, get) => ({
  versions: [], isLoading: false, error: null,

  fetchVersions: async () => {
    set({ isLoading: true, error: null });
    try {
      const versions = await apiClient.get<VersionInfo[]>("/api/versions");
      set({ versions, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  rollbackTo: async (versionId) => {
    await apiClient.post("/api/rollback", { versionId });
    await get().fetchVersions();
    // The deploy event will fire an SSE message -> WebView auto-reloads.
  },
}));
```

### Rollback confirmation sheet

Rollback is always user-initiated. The confirmation bottom sheet uses different copy depending on whether a DB snapshot exists:

- **With snapshot:** "Database will also be restored to this version's state."
- **Without snapshot:** "Only code will be reverted. Database changes since this version will remain."

```tsx
// components/RollbackConfirm.tsx
export function RollbackConfirm({ version, visible, onConfirm, onCancel, loading }: {
  version: VersionInfo; visible: boolean; onConfirm: () => void; onCancel: () => void; loading: boolean;
}) {
  return (
    <BottomSheet visible={visible} onDismiss={onCancel}>
      <Text style={styles.title}>Rollback to v{version.versionNumber}?</Text>
      <Text style={styles.quote}>"{version.description}"</Text>
      <Text>Any changes made after this version will be undone.</Text>
      {version.hasDbSnapshot
        ? <Text>Database will also be restored to this version's state.</Text>
        : <Text>Only code will be reverted. Database changes will remain.</Text>}
      <View style={styles.row}>
        <Pressable onPress={onCancel} disabled={loading}><Text>Cancel</Text></Pressable>
        <Pressable onPress={onConfirm} disabled={loading}>
          <Text>{loading ? "Rolling back..." : "Confirm Rollback"}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
```

---

## 9. Connection Setup Flow

### Login (broker OAuth)

Login authenticates against `https://broker.anyclawapp.com` — the user's AnyClaw account, not their server. OAuth providers: **Google, Apple, GitHub**. Apple is required by the App Store; GitHub targets developer early adopters.

**Flow:**

1. User taps "Continue with Google / Apple / GitHub".
2. `expo-auth-session` opens the system browser to the broker's OAuth initiation endpoint, which redirects to the provider.
3. Provider returns to the broker's callback URL. Broker validates the code, creates/looks up the user, and stores the provider's refresh token server-side.
4. Broker redirects back to the app with a short-lived (15 min) JWT access token and a long-lived broker refresh token.
5. App stores both in `expo-secure-store`. On Apple's first-login quirk (name/email only on first call), the broker is responsible for persistence — the mobile app does nothing special.

```typescript
// lib/broker.ts
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";

const BROKER = "https://broker.anyclawapp.com";
const redirectUri = AuthSession.makeRedirectUri({ scheme: "anyclaw" });

export async function loginWithProvider(provider: "google" | "apple" | "github") {
  const discovery = { authorizationEndpoint: `${BROKER}/auth/${provider}/start` };
  const req = new AuthSession.AuthRequest({
    clientId: "anyclaw-mobile", redirectUri, scopes: ["openid", "email"],
  });
  const result = await req.promptAsync(discovery);
  if (result.type !== "success") throw new Error("OAuth cancelled");
  // The broker returned its own JWTs in the redirect params.
  const { access_token, refresh_token } = result.params;
  await SecureStore.setItemAsync("broker_jwt", access_token);
  await SecureStore.setItemAsync("broker_refresh", refresh_token);
}

export async function refreshBrokerJwt(): Promise<string> {
  const refresh = await SecureStore.getItemAsync("broker_refresh");
  if (!refresh) throw new Error("No refresh token");
  const res = await fetch(`${BROKER}/auth/refresh`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) throw new Error("Refresh failed");
  const { access_token } = await res.json();
  await SecureStore.setItemAsync("broker_jwt", access_token);
  return access_token;
}
```

### Server discovery

```
GET https://broker.anyclawapp.com/api/servers
Authorization: Bearer <jwt>

Response:
{ "servers": [{ "id":"srv_abc", "name":"Home Server", "status":"online", "lastSeen":"...", "paired": true }] }
```

- Zero servers: show "Install the AnyClaw server" onboarding with install script instructions.
- One paired online server: auto-connect.
- Multiple servers: show list; user taps one.
- Unpaired server: jump into the pairing flow (§9.3).

### Pairing with BIP39 verification code

First-time connection to a server requires pairing to defend against MITM at the broker. Both sides derive a 4-word BIP39 verification code from the shared secret and display it; the user visually confirms they match before continuing.

```
+----------------------------------------+
|  Verify your server                     |
|                                         |
|  On your server terminal you should     |
|  see the same four words:               |
|                                         |
|     apple  river  lantern  music        |
|                                         |
|  Do these match?                        |
|                                         |
|  [ No, cancel ]     [ Yes, they match ] |
+----------------------------------------+
```

```typescript
// lib/crypto.ts — pairing
import sodium from "libsodium-wrappers";
import { wordlist } from "@/lib/bip39-english";
import * as SecureStore from "expo-secure-store";

export async function initCrypto() { await sodium.ready; }

export interface PairingKeys {
  clientPublicKey: Uint8Array;
  clientSecretKey: Uint8Array;
  serverPublicKey: Uint8Array;
}

export async function generatePairingKeypair() {
  await initCrypto();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

// Derive a 4-word BIP39 code from the two public keys (same on both sides).
export function verificationCode(clientPk: Uint8Array, serverPk: Uint8Array): string[] {
  const h = sodium.crypto_generichash(8, sodium.from_string("anyclaw-pair"),
    new Uint8Array([...clientPk, ...serverPk]));
  const words: string[] = [];
  for (let i = 0; i < 4; i++) {
    const idx = ((h[i*2] << 8) | h[i*2+1]) % wordlist.length;
    words.push(wordlist[idx]);
  }
  return words;
}

export async function storePairingKeys(serverId: string, keys: PairingKeys) {
  await SecureStore.setItemAsync(`nacl_${serverId}`, JSON.stringify({
    client_pk: sodium.to_base64(keys.clientPublicKey),
    client_sk: sodium.to_base64(keys.clientSecretKey),
    server_pk: sodium.to_base64(keys.serverPublicKey),
  }));
}
```

Pairing sequence:

1. Client: `const { publicKey, secretKey } = await generatePairingKeypair()`.
2. Client: `POST broker/api/pair { serverId, clientPublicKey }`.
3. Broker relays to server; server generates its own keypair and returns `serverPublicKey`.
4. Both sides compute `verificationCode(client_pk, server_pk)`. Server prints it to the install-script stdout; client shows it in the Pair screen.
5. User taps "Yes, they match" — client stores all three keys in `expo-secure-store` and proceeds to tunnel establishment.
6. User taps "No" — client aborts, broker invalidates the pairing attempt.

Re-pair is available from Settings for device loss (see §13).

### Tunnel establishment (Phase 1: WSS relay)

```typescript
// After pairing:
const conn = await fetch(`${BROKER}/api/connect`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${jwt}`, "content-type": "application/json" },
  body: JSON.stringify({ serverId }),
}).then(r => r.json());

// { relayUrl: "https://abc123.relay.anyclawapp.com", sessionToken, pbAuthToken }

await SecureStore.setItemAsync("server_session", JSON.stringify({
  serverId, relayUrl: conn.relayUrl, sessionToken: conn.sessionToken, pbAuthToken: conn.pbAuthToken,
}));
```

All three path prefixes (`/app/*`, `/api/*`, `/pb/*`) are served from the same relay URL; the tunnel manager on the host routes by prefix to the right supervised process.

### Connection store and reconnect

```typescript
// stores/connection.ts
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { apiClient } from "@/lib/api";
import { initPocketBase } from "@/lib/pocketbase";
import { refreshBrokerJwt } from "@/lib/broker";

type State = "disconnected" | "connecting" | "connected" | "reconnecting";

interface ConnectionStore {
  isAuthenticated: boolean;
  isConnected: boolean;
  serverUrl: string | null;
  sessionToken: string | null;
  pbAuthToken: string | null;
  connectionState: State;

  restoreSession: () => Promise<void>;
  reconnect: () => Promise<void>;
  logout: () => Promise<void>;
}

const BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  isAuthenticated: false, isConnected: false,
  serverUrl: null, sessionToken: null, pbAuthToken: null,
  connectionState: "disconnected",

  restoreSession: async () => {
    const jwt = await SecureStore.getItemAsync("broker_jwt");
    if (!jwt) return;
    set({ isAuthenticated: true });
    const sess = await SecureStore.getItemAsync("server_session");
    if (!sess) return;
    const { relayUrl, sessionToken, pbAuthToken } = JSON.parse(sess);
    set({ serverUrl: relayUrl, sessionToken, pbAuthToken, connectionState: "connecting" });
    try {
      apiClient.configure({ baseUrl: relayUrl, sessionToken });
      await apiClient.get("/api/health");
      initPocketBase(relayUrl, pbAuthToken);
      set({ isConnected: true, connectionState: "connected" });
    } catch {
      set({ connectionState: "reconnecting" });
      get().reconnect();
    }
  },

  reconnect: async () => {
    for (let i = 0; ; i++) {
      try {
        await apiClient.get("/api/health");
        set({ isConnected: true, connectionState: "connected" });
        return;
      } catch {
        if (i === 0) { try { await refreshBrokerJwt(); } catch {} }
        await new Promise(r => setTimeout(r, BACKOFF[Math.min(i, BACKOFF.length - 1)]));
      }
    }
  },

  logout: async () => {
    await SecureStore.deleteItemAsync("broker_jwt");
    await SecureStore.deleteItemAsync("broker_refresh");
    await SecureStore.deleteItemAsync("server_session");
    set({ isAuthenticated: false, isConnected: false, serverUrl: null, sessionToken: null, pbAuthToken: null });
  },
}));
```

---

## 10. NaCl E2E Encryption

### Library and key lifecycle

- **Library:** `libsodium-wrappers` (WASM) — same on mobile and server.
- **Primitive:** `crypto_box` authenticated public-key encryption.
- **Key lifecycle:** Long-lived keypair per `(device, server)` pair generated at pairing (§9.3) and stored in `expo-secure-store` (iOS Keychain / Android Keystore). **No rotation for MVP.** Re-pair flow recovers from device loss.

### Encryption boundary

Per spec decision #33:

- **TLS-only for static assets** — HTML/CSS/JS from the prod static server at `/app/*` ride on TLS alone. Assets are not secret.
- **NaCl additionally for sensitive API payloads** — PocketBase API calls carrying user data (`/pb/*`) and dispatch API calls (`/api/*`) are wrapped in a NaCl box on top of TLS. The broker relay, even if compromised, sees only opaque bytes.

This keeps the WebView simple (no complex proxy scheme for asset loading) while protecting everything that carries user data.

### Encrypt/decrypt primitives

```typescript
// lib/crypto.ts
import sodium from "libsodium-wrappers";

export interface Envelope { ciphertext: string; nonce: string; }

export function encryptJSON(plain: unknown, theirPk: Uint8Array, mySk: Uint8Array): Envelope {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ct = sodium.crypto_box_easy(sodium.from_string(JSON.stringify(plain)), nonce, theirPk, mySk);
  return { ciphertext: sodium.to_base64(ct), nonce: sodium.to_base64(nonce) };
}

export function decryptJSON<T = unknown>(env: Envelope, theirPk: Uint8Array, mySk: Uint8Array): T {
  const pt = sodium.crypto_box_open_easy(
    sodium.from_base64(env.ciphertext), sodium.from_base64(env.nonce), theirPk, mySk,
  );
  if (!pt) throw new Error("Decryption failed");
  return JSON.parse(sodium.to_string(pt));
}
```

### API client integration

```typescript
// lib/api.ts
import { encryptJSON, decryptJSON, Envelope } from "./crypto";
import { loadPairingKeys } from "./crypto-storage";

interface Config { baseUrl: string; sessionToken: string; serverId: string; debug?: boolean; }

class ApiClient {
  private cfg: Config | null = null;
  configure(cfg: Config) { this.cfg = cfg; }

  async post<T>(path: string, body: unknown): Promise<T> {
    const { baseUrl, sessionToken, serverId, debug } = this.requireCfg();
    const keys = await loadPairingKeys(serverId);
    const envelope = encryptJSON(body, keys.serverPublicKey, keys.clientSecretKey);
    if (debug) console.log("[api] plaintext request", path, body);

    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-nacl-box",
        "authorization": `Bearer ${sessionToken}`,
        "x-anyclaw-client-pk": sodium.to_base64(keys.clientPublicKey),
      },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const env: Envelope = await res.json();
    const plain = decryptJSON<T>(env, keys.serverPublicKey, keys.clientSecretKey);
    if (debug) console.log("[api] plaintext response", path, plain);
    return plain;
  }

  async get<T>(path: string): Promise<T> {
    // GET uses the same NaCl envelope in the response body; request has no body.
    const { baseUrl, sessionToken, serverId, debug } = this.requireCfg();
    const keys = await loadPairingKeys(serverId);
    const res = await fetch(`${baseUrl}${path}`, { headers: { "authorization": `Bearer ${sessionToken}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const env: Envelope = await res.json();
    const plain = decryptJSON<T>(env, keys.serverPublicKey, keys.clientSecretKey);
    if (debug) console.log("[api] plaintext response", path, plain);
    return plain;
  }

  private requireCfg() { if (!this.cfg) throw new Error("api client not configured"); return this.cfg; }
}

export const apiClient = new ApiClient();
```

PocketBase SSE events carry the same envelope format; a wrapper around `pb.collection(x).subscribe` decrypts the payload before passing it to the store's `_applyServerRecord`.

---

## 11. PocketBase Realtime SSE Integration

```typescript
// lib/pocketbase.ts
import PocketBase, { RecordSubscription } from "pocketbase";
import { decryptJSON, Envelope } from "./crypto";
import { loadPairingKeys } from "./crypto-storage";

let pb: PocketBase | null = null;
let serverId: string;

export function initPocketBase(relayUrl: string, pbAuthToken: string, sid: string) {
  pb = new PocketBase(`${relayUrl}/pb`);
  pb.authStore.save(pbAuthToken, null);
  serverId = sid;
}

export function getPocketBase(): PocketBase {
  if (!pb) throw new Error("PocketBase not initialized");
  return pb;
}

export function subscribeToTask(taskId: string, onUpdate: (rec: any) => void) {
  const handler = async (e: RecordSubscription<Envelope>) => {
    const keys = await loadPairingKeys(serverId);
    const record = decryptJSON(e.record as unknown as Envelope, keys.serverPublicKey, keys.clientSecretKey);
    onUpdate(record);
  };
  pb!.collection("_tasks").subscribe(taskId, handler);
  return () => pb!.collection("_tasks").unsubscribe(taskId);
}

export function subscribeToAgentMessages(onMessage: (rec: any) => void) {
  pb!.collection("_agent_messages").subscribe("*", async (e) => {
    const keys = await loadPairingKeys(serverId);
    const rec = decryptJSON(e.record as unknown as Envelope, keys.serverPublicKey, keys.clientSecretKey);
    onMessage(rec);
  });
  return () => pb!.collection("_agent_messages").unsubscribe("*");
}

export function subscribeToDeployments(onDeploy: () => void) {
  pb!.collection("_deployments").subscribe("*", (e) => {
    if (e.action === "create") onDeploy();
  });
  return () => pb!.collection("_deployments").unsubscribe("*");
}
```

The PocketBase JS SDK auto-reconnects on SSE drop. After reconnect, the task store refetches the active `_tasks` record via REST to catch any missed updates, then resumes streaming.

---

## 12. Push Notifications

### Registration

```typescript
// lib/notifications.ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiClient } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "AnyClaw",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await apiClient.post("/api/device/register", { pushToken: token.data, platform: Platform.OS });
  return token.data;
}
```

### Notification types and deep links

| Event | Title | Body | Data | Deep link |
|-------|-------|------|------|-----------|
| Agent asks question | "Question from your agent" | Truncated question | `{ screen: "task", taskId }` | `anyclaw://task/{id}` |
| Task completed | "New version deployed" | Truncated version description | `{ screen: "versions" }` | `anyclaw://versions` |
| Task failed | "Task failed" | Truncated error | `{ screen: "task", taskId }` | `anyclaw://task/{id}` |

```typescript
// Deep-link handling (called from app/_layout.tsx)
export function useNotificationDeepLinks() {
  const router = useRouter();
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;
      if (data?.screen === "task" && data?.taskId) router.push(`/(main)/task/${data.taskId}`);
      else if (data?.screen === "versions") router.push("/(main)/versions");
    });
    return () => sub.remove();
  }, [router]);
}
```

The server dispatches notifications via the Expo Push API from the dispatch/MCP server (not from agent code) so that notifications still fire even if the logic service is crashed.

---

## 13. Settings Screen

```
+----------------------------------------+
|  Settings                               |
+----------------------------------------+
|  Account                                |
|    Signed in as alice@example.com  [>]  |
|    Sign out                        [>]  |
+----------------------------------------+
|  Agent behavior                         |
|    Clarification mode                   |
|      ( ) Best judgment (default)        |
|      (*) Pause and wait                 |
|    Clarification timeout      [ 5 min v]|
+----------------------------------------+
|  Connection                             |
|    Server: Home Server (online)   [>]   |
|    Re-pair this device            [>]   |
+----------------------------------------+
|  Keys & secrets                         |
|    LLM API keys                   [>]   |
|    Master encryption key          [info]|
+----------------------------------------+
|  Advanced                               |
|    Debug encrypted traffic        [ ]   |
|    View logs                      [>]   |
+----------------------------------------+
```

**Sections:**

1. **Account** — Shows OAuth identity; sign out clears `expo-secure-store`.
2. **Clarification timeout mode** — Per spec decision #2. Two modes: `best-judgment` (default) — agent proceeds with best guess after `N` minutes; `pause-indefinitely` — task waits forever. Both are mirrored to the dispatch server via `PATCH /api/settings`.
3. **Clarification timeout duration** — Minutes dropdown (1 / 5 / 15 / 30 / 60). Only shown when mode is `best-judgment`.
4. **API key management** — List/add/remove LLM provider keys. Per spec decision #21, keys are encrypted server-side in PocketBase; the UI posts plaintext over the NaCl-encrypted API channel and the server encrypts on write.
5. **Connection / server management** — Shows the active server; "Change server" returns to server-list. "Re-pair this device" generates a new NaCl keypair, revokes the old one at the broker, and runs the pairing flow again — the recovery path for device loss or key compromise.
6. **Debug mode for encrypted traffic** — Per spec decision #34. Toggle enables plaintext logging in `apiClient` and `subscribeTo*` locally only; never reports to broker. Includes a "clear logs" button.
7. **View logs** — Displays locally captured logs (rolling ring buffer of last 500 lines).

Settings store:

```typescript
// stores/settings.ts
import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface SettingsStore {
  clarificationMode: "best-judgment" | "pause-indefinitely";
  clarificationTimeoutMinutes: number;
  debugEncryptedTraffic: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<SettingsStore>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  clarificationMode: "best-judgment",
  clarificationTimeoutMinutes: 5,
  debugEncryptedTraffic: false,
  hydrate: async () => {
    const raw = await AsyncStorage.getItem("anyclaw_settings");
    if (raw) set(JSON.parse(raw));
  },
  update: async (patch) => {
    set(patch as any);
    await AsyncStorage.setItem("anyclaw_settings", JSON.stringify(get()));
    // Mirror to server for agent-relevant settings
    if ("clarificationMode" in patch || "clarificationTimeoutMinutes" in patch) {
      const { clarificationMode, clarificationTimeoutMinutes } = get();
      try { await apiClient.post("/api/settings", { clarificationMode, clarificationTimeoutMinutes }); } catch {}
    }
  },
}));
```

---

## 14. Testing Strategy

### Unit tests (`jest-expo`)

- `lib/crypto.ts` — round-trip encrypt/decrypt, BIP39 verification-code determinism, rejection of tampered ciphertext.
- `lib/bridge.ts` — `parseBridgeMessage` accepts valid JSON, rejects malformed payloads.
- `stores/task.ts` — state transitions (submit → working → done), idempotency-key handling, resume-active-task restoration, retry flow.
- `stores/connection.ts` — restoreSession happy path, reconnect backoff ordering.
- `stores/versions.ts` — fetchVersions success/error, rollback triggers refetch.

### Integration tests (with mocked PocketBase + dispatch server)

- Submit a task; simulate an SSE update with `state: "clarifying"`; verify the Request tab badge appears.
- Answer a clarification; verify optimistic transition to `working` followed by reconcile on next SSE event.
- Kill the mock dispatch server mid-task; verify reconnect backoff and resume of the active task on recovery.
- Trigger a `_deployments` SSE event; verify `WebView.reload()` is called and `versionStore.fetchVersions` runs.
- Pair flow: generate keypair, exchange via mock broker, assert BIP39 codes match on both sides.

### Manual test plan

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Fresh install → OAuth with Google | Lands on server-list |
| 2 | Pair with new server | BIP39 code shown; matches server terminal output |
| 3 | Submit task, answer clarification | Task moves clarifying → working → done; WebView reloads |
| 4 | Kill the logic service mid-session | WebView shows "app broken" error screen; Versions tab still works; `/api/rollback` restores prior version |
| 5 | Kill the dispatch server | Header badge turns red; Versions tab becomes read-only; auto-recover on restart |
| 6 | Close app during clarification, reopen | Pending question is restored via `resumeActiveTask` |
| 7 | Receive push notification while backgrounded | Tap opens the relevant tab via deep link |
| 8 | Rollback with DB snapshot | Sheet shows DB-restore copy; rollback succeeds; WebView reloads |
| 9 | Rollback without DB snapshot | Sheet shows code-only copy |
| 10 | Toggle debug traffic mode, submit a task | Plaintext appears in local log only; never sent to broker |
| 11 | Re-pair flow from Settings | New keypair generated; old one revoked; connection re-established |
| 12 | Airplane mode toggle | `reconnecting` state, exponential backoff, recovery on network return |
| 13 | Android API 28 device (Android 9.0) | WebView renders, SSE stable, biometric unlock works |
| 14 | iOS 15.1 device | Same as above, WKWebView bridge works |
