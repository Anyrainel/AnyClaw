# Plan 5: Mobile App — Technical Design

**Goal:** Build the AnyClaw companion mobile app -- a thin Expo (React Native) shell that wraps the agent-built web UI in a WebView, manages server connections, dispatches tasks to the coding agent, and provides version history with rollback.

**Architecture:** The app has two layers: (1) a native shell built with Expo Router (tabs + stack navigation) that handles connection setup, task dispatch, version history, and settings; (2) a full-screen WebView that loads the agent-built React frontend from the user's server. The native shell and WebView communicate via a postMessage/onMessage JS bridge. The app authenticates via the broker at `broker.anyclawapp.com`, then connects through a **single tunnel endpoint** (a relay subdomain brokered via `broker.anyclawapp.com`) to the user's host. On the host, a tunnel manager multiplexes incoming traffic across three supervised processes using path-based routing: `/pb/*` → PocketBase (data + Realtime SSE), `/api/*` → dispatch/MCP server (task submission, rollback, version history, emergency controls), `/app/*` → prod static server (the agent-built WebView content). All traffic is NaCl-encrypted on top of TLS.

**Tech Stack:** Expo SDK 52, expo-router v4, react-native-webview, expo-secure-store, expo-notifications, zustand (state management), React Native Reanimated (animations), tweetnacl (NaCl encryption).

**Locked decisions applied:** Task dispatch UI is a dedicated "Request" tab + full-screen modal/bottom sheet (not FAB). Min Android API 28 (Android 9.0). WebView auth via JS bridge injection. Realtime via PocketBase SSE + REST. NaCl E2E encryption. OAuth: Google + Apple + GitHub. Domain: `anyclawapp.com`, broker at `broker.anyclawapp.com`. Supervised-process server architecture (PocketBase, tunnel manager, dispatch/MCP server, logic service, prod static server) — no container splits; path-based routing through a single tunnel.

---

## 1. Expo Project Setup

### SDK and Workflow

- **Expo SDK 52** (latest stable as of early 2026). Provides managed build pipeline, OTA updates via EAS Update, and push notification infrastructure.
- **Managed workflow for Phase 1.** No native code, no ejection. Expo Go for development. EAS Build for production binaries.
- **Development builds (expo-dev-client) for Phase 2** when WebRTC is needed (`@config-plugins/react-native-webrtc` requires `expo prebuild`). This is not a full ejection -- Expo still manages the build pipeline, but native modules are compiled in.

### Key Dependencies

```json
{
  "dependencies": {
    "expo": "~52.0.0",
    "expo-router": "~4.0.0",
    "expo-secure-store": "~14.0.0",
    "expo-notifications": "~0.29.0",
    "expo-constants": "~17.0.0",
    "expo-device": "~7.0.0",
    "expo-haptics": "~14.0.0",
    "react-native-webview": "13.x",
    "react-native-reanimated": "~3.16.0",
    "zustand": "^5.0.0",
    "@react-native-async-storage/async-storage": "2.x",
    "react-native-safe-area-context": "~5.0.0",
    "react-native-gesture-handler": "~2.20.0",
    "date-fns": "^4.0.0",
    "pocketbase": "^0.25.0",
    "tweetnacl": "^1.0.3",
    "tweetnacl-util": "^0.15.1",
    "expo-auth-session": "~6.0.0",
    "expo-web-browser": "~14.0.0"
  },
  "devDependencies": {
    "typescript": "~5.6.0",
    "@types/react": "~18.3.0",
    "jest": "^29.0.0",
    "jest-expo": "~52.0.0"
  }
}
```

### Platform Requirements

- **iOS:** 15.1+ (Expo SDK 52 default)
- **Android:** API 28 / Android 9.0+ (override Expo's default API 23 minimum). Set in `app.json`:

```json
{
  "expo": {
    "android": {
      "minSdkVersion": 28
    }
  }
}
```

Rationale: API 28+ provides a modern WebView with reliable SSE support, dark mode APIs, and biometric authentication. Drops ~5% of Android devices.

### Project Structure

```
anyclaw-mobile/
├── app.json                          # Expo config
├── package.json
├── tsconfig.json
├── app/                              # expo-router file-based routing
│   ├── _layout.tsx                   # Root layout (auth gate + providers)
│   ├── (auth)/                       # Unauthenticated screens
│   │   ├── _layout.tsx               # Stack navigator for auth flow
│   │   ├── login.tsx                 # Login / signup (OAuth: Google, Apple, GitHub)
│   │   └── server-setup.tsx          # Server discovery + connection
│   ├── (main)/                       # Authenticated screens
│   │   ├── _layout.tsx               # Tab navigator
│   │   ├── index.tsx                 # Home tab (WebView)
│   │   ├── task.tsx                  # Task dispatch tab
│   │   ├── versions.tsx              # Version history tab
│   │   └── settings.tsx              # Settings tab
│   └── (main)/task/
│       └── [id].tsx                  # Task detail (deep link from notification)
├── components/
│   ├── WebViewShell.tsx              # WebView wrapper with bridge
│   ├── TaskCard.tsx                  # Task state machine UI
│   ├── TaskInput.tsx                 # Text input for new task
│   ├── ClarifyingQuestion.tsx        # Agent question + answer input
│   ├── ActivityLog.tsx               # Scrolling agent activity feed
│   ├── VersionRow.tsx                # Single version in history list
│   ├── RollbackConfirm.tsx           # Confirmation bottom sheet
│   ├── ConnectionStatus.tsx          # Header badge: connected/reconnecting/offline
│   └── EmptyState.tsx                # Placeholder for no-content screens
├── lib/
│   ├── api.ts                        # HTTP/REST client for server communication
│   ├── bridge.ts                     # WebView JS bridge helpers
│   ├── auth.ts                       # Auth token management (OAuth: Google/Apple/GitHub)
│   ├── crypto.ts                     # NaCl key generation, key exchange, encrypt/decrypt
│   ├── pocketbase.ts                # PocketBase client init + SSE subscription helpers
│   └── notifications.ts             # Push notification registration + handling
├── stores/
│   ├── connection.ts                 # Server connection state (zustand)
│   ├── task.ts                       # Active task state machine (zustand)
│   └── versions.ts                   # Cached version list (zustand)
├── types/
│   ├── task.ts                       # TaskStatus, TaskHandle, ActivityEntry
│   ├── version.ts                    # VersionInfo, RollbackResult
│   └── server.ts                     # ServerInfo, ConnectionCredentials
└── assets/
    └── images/
```

---

## 2. Screen / Navigation Structure

### Navigation Hierarchy

```
Root Layout (_layout.tsx)
├── Auth Gate: checks expo-secure-store for valid token
│
├── (auth) — Stack Navigator (unauthenticated)
│   ├── login          — Email/password or OAuth login via broker
│   └── server-setup   — Server discovery, tunnel test, save credentials
│
└── (main) — Tab Navigator (authenticated + connected)
    ├── Home tab       — Full-screen WebView (agent-built UI)
    ├── Request tab    — Task dispatch (full-screen modal/bottom sheet for input/clarify/working/done/failed)
    ├── Versions tab   — Version history list with rollback
    └── Settings tab   — Server status, adapter config, logs, account
```

### Tab Bar Design

The tab bar uses four icons and sits at the bottom of the screen. The Home tab is the default. A small badge on the Task tab appears when the agent has a pending clarifying question.

```
  [Home]    [Request]    [Versions]    [Settings]
    o        o (!)           o             o
```

- **Home** -- Globe or app icon. The WebView fills the entire safe area above the tab bar. No header.
- **Request** -- Sparkle or wand icon. Opens a full-screen modal/bottom sheet for task dispatch. Header: "New Request" or the current task's short title. Badge appears when agent has a pending clarifying question.
- **Versions** -- Clock/history icon. Scrollable list. Header: "Version History".
- **Settings** -- Gear icon. Grouped settings list. Header: "Settings".

### Root Layout Implementation

```tsx
// app/_layout.tsx
import { Slot, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { useConnectionStore } from "../stores/connection";

export default function RootLayout() {
  const { isAuthenticated, isConnected } = useConnectionStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const inAuthGroup = segments[0] === "(auth)";

    if (!isAuthenticated && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (isAuthenticated && !isConnected && !inAuthGroup) {
      router.replace("/(auth)/server-setup");
    } else if (isAuthenticated && isConnected && inAuthGroup) {
      router.replace("/(main)");
    }
  }, [isAuthenticated, isConnected, segments]);

  return <Slot />;
}
```

### Main Tab Layout

```tsx
// app/(main)/_layout.tsx
import { Tabs } from "expo-router";
import { useTaskStore } from "../../stores/task";
import { ConnectionStatus } from "../../components/ConnectionStatus";

export default function MainLayout() {
  const hasPendingQuestion = useTaskStore(
    (s) => s.activeTask?.state === "clarifying"
  );

  return (
    <Tabs
      screenOptions={{
        headerRight: () => <ConnectionStatus />,
        tabBarActiveTintColor: "#7C3AED",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerShown: false, // WebView is full-bleed
          tabBarIcon: ({ color }) => <GlobeIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="task"
        options={{
          title: "Request",
          tabBarBadge: hasPendingQuestion ? "!" : undefined,
          tabBarIcon: ({ color }) => <WandIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="versions"
        options={{
          title: "Versions",
          tabBarIcon: ({ color }) => <HistoryIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <GearIcon color={color} />,
        }}
      />
    </Tabs>
  );
}
```

---

## 3. WebView Integration

### Loading the Agent-Built UI

The WebView loads the production frontend from the user's server through the single tunnel endpoint, under the `/app/*` path. The URL does **not** include the auth token -- tokens are injected via the JS bridge after page load to avoid exposing them in URLs, server logs, or referrer headers.

```
https://<tunnel-host>/app/
```

In Phase 1 (broker relay), the tunnel host is a subdomain on the broker (e.g., `abc123.relay.anyclawapp.com`). The host's tunnel manager multiplexes `/pb/*`, `/api/*`, and `/app/*` to the corresponding supervised processes (PocketBase, dispatch/MCP server, prod static server). In Phase 2 (WebRTC), the WebView connects to a local HTTP server that proxies over the data channel -- but this is transparent to the WebView component, and the same path-based routing applies on the host side.

**Auth flow:** The native shell loads the page without a token. The page's JS waits for the bridge to inject a `session-token` message. Once received, the frontend uses the token for all API calls. This is the most secure option -- the token never appears in URLs, logs, or browser history.

### WebViewShell Component

```tsx
// components/WebViewShell.tsx
import { useRef, useCallback, useState } from "react";
import { View, ActivityIndicator, StyleSheet, Text, Pressable } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { useConnectionStore } from "../stores/connection";
import { BridgeMessage, parseBridgeMessage, sendBridgeMessage } from "../lib/bridge";

export function WebViewShell() {
  const webViewRef = useRef<WebView>(null);
  const { serverUrl, sessionToken } = useConnectionStore();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Auth token is NOT in the URL -- injected via JS bridge after page load
  const uri = `${serverUrl}/app/`;

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const msg = parseBridgeMessage(event.nativeEvent.data);
    if (!msg) return;

    switch (msg.type) {
      case "bridge-ready":
        // Inject auth token via JS bridge (never in URL)
        sendBridgeMessage(webViewRef, {
          type: "session-token",
          token: sessionToken!,
        });
        break;
      case "deploy-complete":
        // Agent deployed a new version -- reload the WebView
        webViewRef.current?.reload();
        break;
      case "navigate-to-task":
        // Agent-built UI wants to open the task tab
        // Handled via expo-router navigation
        break;
      case "health-check":
        sendBridgeMessage(webViewRef, { type: "health-check-ack" });
        break;
    }
  }, [sessionToken]);

  if (loadError) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Cannot reach server</Text>
        <Text style={styles.errorBody}>{loadError}</Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => {
            setLoadError(null);
            setIsLoading(true);
            webViewRef.current?.reload();
          }}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isLoading && (
        <ActivityIndicator style={styles.loader} size="large" />
      )}
      <WebView
        ref={webViewRef}
        source={{ uri }}
        style={styles.webview}
        onMessage={onMessage}
        onLoadEnd={() => setIsLoading(false)}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          setLoadError(nativeEvent.description || "Connection failed");
        }}
        onHttpError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          if (nativeEvent.statusCode >= 500) {
            setLoadError(`Server error (${nativeEvent.statusCode})`);
          }
        }}
        // Security: only allow navigation to the user's own server
        originWhitelist={[serverUrl]}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={false}
        // Inject bridge initialization into the page
        injectedJavaScriptBeforeContentLoaded={BRIDGE_INIT_SCRIPT}
      />
    </View>
  );
}

const BRIDGE_INIT_SCRIPT = `
  window.AnyClaw = {
    postMessage: (msg) => window.ReactNativeWebView.postMessage(JSON.stringify(msg)),
    onMessage: null, // set by the agent-built frontend
  };

  // Listen for messages from the native shell
  document.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (window.AnyClaw.onMessage) {
        window.AnyClaw.onMessage(msg);
      }
    } catch (e) {}
  });

  // Notify native shell that the bridge is ready
  window.AnyClaw.postMessage({ type: 'bridge-ready' });
  true;
`;
```

### JS Bridge Protocol

Messages between the native shell and the WebView are JSON objects with a `type` discriminator:

```typescript
// lib/bridge.ts

/** Messages from WebView -> Native */
type WebViewToNative =
  | { type: "bridge-ready" }
  | { type: "navigate-to-task" }
  | { type: "navigate-to-versions" }
  | { type: "health-check" };

/** Messages from Native -> WebView */
type NativeToWebView =
  | { type: "reload" }                        // Trigger a page refresh
  | { type: "health-check-ack" }
  | { type: "session-token"; token: string }   // Refresh the auth token
  | { type: "theme-changed"; theme: "light" | "dark" };

export type BridgeMessage = WebViewToNative | NativeToWebView;

export function parseBridgeMessage(data: string): BridgeMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed.type === "string") return parsed;
  } catch {}
  return null;
}

export function sendBridgeMessage(
  webViewRef: React.RefObject<WebView>,
  msg: NativeToWebView
) {
  webViewRef.current?.injectJavaScript(
    `document.dispatchEvent(new MessageEvent('message', { data: '${JSON.stringify(msg)}' })); true;`
  );
}
```

### Reload on Deploy

When the agent completes a deployment, the server broadcasts a PocketBase realtime SSE event on the `_deployments` collection. The mobile app subscribes to this via a persistent SSE connection (managed in the connection store, not the WebView). On receiving a deploy event, the native shell sends a `reload` message to the WebView:

```typescript
// Inside connection store initialization
pb.collection("_deployments").subscribe("*", (event) => {
  if (event.action === "create") {
    // New deployment -- tell WebView to reload
    webViewRef.current?.reload();
    // Also refresh version list
    useVersionStore.getState().fetchVersions();
  }
});
```

### Error Handling

| Scenario | Detection | Behavior |
|----------|-----------|----------|
| Server unreachable | WebView `onError` fires | Show native error screen with "Retry" button and connection status |
| `/app/*` returns 5xx (logic service or prod static server crashed) | WebView `onHttpError` with status >= 500 | Show native "App is broken" screen with a prominent "Open Version History" button that routes to the Versions tab. The dispatch/MCP server on `/api/*` is a separately supervised process that `restart=always`, so version history + rollback remain available even while the agent-built app is down. |
| `/app/*` returns 401 | WebView `onHttpError` with status 401 | Attempt token refresh; if that fails, redirect to login |
| WebView JS crash | WebView `onRenderProcessGone` (Android) / `onContentProcessDidTerminate` (iOS) | Auto-reload the WebView, show brief toast |
| Slow load (>10s) | Timer started on load begin | Show "Still loading..." overlay with option to retry |

**Emergency rollback path:** Because the dispatch/MCP server is supervised with `restart=always` and lives outside the agent's writable path, `POST /api/rollback` and `GET /api/versions` are available whenever the host is reachable — even if the logic service is crash-looping from bad agent code or the prod static server returned a broken bundle. The native shell never depends on `/app/*` being healthy to render the Versions tab; it talks directly to `/api/*` and `/pb/*`.

---

## 4. Task Dispatch UI

### State Machine

The active task follows a strict state machine. Only one task is active at a time.

```
                 +-----------+
                 |   idle    |  (no active task)
                 +-----+-----+
                       |
                  user submits
                       |
                 +-----v-----+
                 |   input    |  (request sent to server)
                 +-----+-----+
                       |
              server accepts task
                       |
            +----------v-----------+
            |                      |
      +-----v-----+        +------v------+
      | clarifying |        |   working   |
      +-----+-----+        +------+------+
            |                      |
       user answers           agent finishes
            |                      |
            +-------> working      |
                                   |
                            +------v------+
                            |  deploying  |
                            +------+------+
                                   |
                         +---------+---------+
                         |                   |
                   +-----v-----+      +------v-----+
                   |   done    |      |   failed   |
                   +-----------+      +------+-----+
                                             |
                                        user taps retry
                                             |
                                       back to input
```

### Zustand Task Store

```typescript
// stores/task.ts
import { create } from "zustand";

type TaskState =
  | "idle"
  | "input"
  | "clarifying"
  | "working"
  | "deploying"
  | "done"
  | "failed";

interface ActiveTask {
  id: string;
  request: string;
  state: TaskState;
  question?: string;           // present when state === "clarifying"
  qaHistory: Array<{ question: string; answer: string }>;
  progressSummary?: string;    // present when state === "working" | "deploying"
  activityLog: Array<{ timestamp: string; message: string; type: string }>;
  versionDescription?: string; // present when state === "done"
  error?: string;              // present when state === "failed"
}

interface TaskStore {
  activeTask: ActiveTask | null;
  pastTasks: ActiveTask[];

  submitTask: (request: string) => Promise<void>;
  answerQuestion: (answer: string) => Promise<void>;
  cancelTask: () => Promise<void>;
  retryTask: () => void;
  dismissTask: () => void;

  // Called by the polling/subscription loop
  _updateFromServer: (status: ServerTaskStatus) => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  activeTask: null,
  pastTasks: [],

  submitTask: async (request) => {
    const api = getApi();
    const handle = await api.dispatchTask(request);
    set({
      activeTask: {
        id: handle.taskId,
        request,
        state: "input",
        qaHistory: [],
        activityLog: [],
      },
    });
    // Start polling for status updates
    get()._startPolling(handle.taskId);
  },

  answerQuestion: async (answer) => {
    const task = get().activeTask;
    if (!task || task.state !== "clarifying") return;

    const api = getApi();
    await api.answerQuestion(task.id, answer);
    set((prev) => ({
      activeTask: prev.activeTask
        ? {
            ...prev.activeTask,
            qaHistory: [
              ...prev.activeTask.qaHistory,
              { question: prev.activeTask.question!, answer },
            ],
            question: undefined,
            state: "working", // optimistic, will be corrected by next poll
          }
        : null,
    }));
  },

  cancelTask: async () => {
    const task = get().activeTask;
    if (!task) return;
    const api = getApi();
    await api.cancelTask(task.id);
    set((prev) => ({
      activeTask: null,
      pastTasks: prev.activeTask
        ? [{ ...prev.activeTask, state: "failed", error: "Cancelled" }, ...prev.pastTasks]
        : prev.pastTasks,
    }));
  },

  retryTask: () => {
    const task = get().activeTask;
    if (!task || task.state !== "failed") return;
    // Re-submit the same request
    get().submitTask(task.request);
  },

  dismissTask: () => {
    set((prev) => ({
      activeTask: null,
      pastTasks: prev.activeTask
        ? [prev.activeTask, ...prev.pastTasks]
        : prev.pastTasks,
    }));
  },

  _updateFromServer: (status) => {
    set((prev) => {
      if (!prev.activeTask) return prev;
      return {
        activeTask: {
          ...prev.activeTask,
          state: status.state,
          question: status.question,
          progressSummary: status.progressSummary,
          versionDescription: status.versionDescription,
          error: status.error,
          activityLog: status.activityLog ?? prev.activeTask.activityLog,
        },
      };
    });
  },
}));
```

### Server Communication for Tasks

Tasks are dispatched and monitored through the **dispatch/MCP server**'s REST API, reached via the `/api/*` path on the single tunnel. The mobile app does NOT communicate directly with the coding agent -- it goes through the dispatch server's adapter layer, which spawns the agent as a transient subprocess per task.

**Supervised-process model (from mobile app's perspective):**
- **Dispatch/MCP server** (`/api/*`) -- a supervised process with `restart=always`. Handles task dispatch, clarification answers, cancellation, version history, emergency rollback, and logic-service restart. Its source is outside the agent's writable path, so it remains available even when agent-authored code (the logic service) is broken. This is the "control plane" capability from the old design, now just a process rather than a container.
- **PocketBase** (`/pb/*`) -- a supervised process. Stores task state, versions, clarification Q&A, and streams updates over Realtime SSE.
- **Prod static server** (`/app/*`) -- a supervised process that serves the agent-built React bundle into the WebView.
- **Logic service** -- agent-modifiable Node.js service; supervised with `restart=on-failure`. The mobile app never talks to it directly; the WebView frontend calls it for custom endpoints.
- **Agent subprocess** -- spawned per task by the dispatch server with cgroup limits. Transient. Mobile app never contacts it directly.

**Endpoints (served by the dispatch/MCP server under `/api/*`):**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/tasks` | Submit a new task. Body: `{ request: string }`. Returns `{ taskId: string }`. |
| POST | `/api/tasks/:id/answer` | Answer a clarifying question. Body: `{ answer: string }`. |
| POST | `/api/tasks/:id/cancel` | Cancel a running task. |
| GET | `/api/versions` | List deployment history. |
| POST | `/api/rollback` | Emergency rollback — atomic code + DB snapshot restore. Always available. |
| POST | `/api/restart-app` | Restart the logic service (agent code) after a crash loop. |
| GET | `/api/health` | Health check for all supervised processes. |

**Realtime communication: PocketBase SSE + REST**

All realtime updates flow through **PocketBase Realtime SSE** (server-to-client push). Client-to-server actions use **REST POST**. This covers:

- **Progress updates** -- SSE subscription on the `_tasks` collection. When the adapter updates the task record in PocketBase, the change streams to the mobile app in real time.
- **Clarification questions** -- Agent writes a question to the task record in PocketBase. SSE pushes it to the mobile app. User answers via REST POST to the control plane.
- **Task history** -- Fetched via PocketBase REST API. Past tasks persist in PocketBase and can be browsed offline if cached.

**Task state persistence:** Task state lives in PocketBase (`/pb/*`) — this is the single source of truth. The dispatch/MCP server writes to PocketBase when it accepts a task, and both the dispatch server and the agent subprocess update the same `_tasks` records throughout the task lifecycle. There is no separate task store in the dispatch server. Because PocketBase is its own supervised process (not coupled to the logic service), it stays up across logic-service crashes, so task state survives even when the agent-authored app is broken. If the user closes the app during a clarification question, the question persists in PocketBase; when the user reopens the app, it reconnects to PocketBase SSE on `/pb/*` and resumes where it left off.

```typescript
// lib/pocketbase.ts — task status subscription
import PocketBase from "pocketbase";

let pb: PocketBase;

export function initPocketBase(serverUrl: string, authToken: string) {
  pb = new PocketBase(`${serverUrl}/pb`);
  pb.authStore.save(authToken, null);
  return pb;
}

export function subscribeToTask(
  taskId: string,
  onUpdate: (status: TaskStatus) => void
) {
  pb.collection("_tasks").subscribe(taskId, (event) => {
    onUpdate(event.record as unknown as TaskStatus);
  });

  // Return unsubscribe function
  return () => pb.collection("_tasks").unsubscribe(taskId);
}

export function subscribeToDeployments(onDeploy: (event: any) => void) {
  pb.collection("_deployments").subscribe("*", onDeploy);
  return () => pb.collection("_deployments").unsubscribe("*");
}
```

**Reconnection on SSE drop:** If the SSE connection drops, the PocketBase JS SDK automatically reconnects. On reconnect, the app fetches the latest task state via REST GET to catch any missed updates, then resumes SSE streaming.

**Resume after app close/reopen:**

```typescript
// In task store initialization (called on app launch)
async function resumeActiveTask() {
  const pb = getPocketBaseClient();
  // Query for any task in a non-terminal state
  const activeTasks = await pb.collection("_tasks").getList(1, 1, {
    filter: 'state != "done" && state != "failed" && state != "cancelled"',
    sort: "-created",
  });
  if (activeTasks.items.length > 0) {
    const task = activeTasks.items[0];
    // Restore task into the zustand store
    useTaskStore.getState()._updateFromServer(task);
    // Re-subscribe to SSE for this task
    subscribeToTask(task.id, (status) => {
      useTaskStore.getState()._updateFromServer(status);
    });
  }
}
```

### TaskCard Component

```tsx
// components/TaskCard.tsx
import { View, Text, TextInput, Pressable, ScrollView } from "react-native";
import { useTaskStore } from "../stores/task";
import { ClarifyingQuestion } from "./ClarifyingQuestion";
import { ActivityLog } from "./ActivityLog";

export function TaskCard() {
  const task = useTaskStore((s) => s.activeTask);

  if (!task) return <TaskInput />;

  switch (task.state) {
    case "input":
      return (
        <View style={styles.card}>
          <Text style={styles.request}>{task.request}</Text>
          <Text style={styles.status}>Sending to agent...</Text>
          <LoadingDots />
        </View>
      );

    case "clarifying":
      return (
        <View style={styles.card}>
          <Text style={styles.request}>{task.request}</Text>
          {task.qaHistory.map((qa, i) => (
            <View key={i} style={styles.qaRound}>
              <Text style={styles.agentQuestion}>{qa.question}</Text>
              <Text style={styles.userAnswer}>{qa.answer}</Text>
            </View>
          ))}
          <ClarifyingQuestion question={task.question!} />
        </View>
      );

    case "working":
    case "deploying":
      return (
        <View style={styles.card}>
          <Text style={styles.request}>{task.request}</Text>
          <Text style={styles.status}>
            {task.state === "deploying" ? "Deploying..." : "Working..."}
          </Text>
          {task.progressSummary && (
            <Text style={styles.progress}>{task.progressSummary}</Text>
          )}
          <ActivityLog entries={task.activityLog} />
          <Pressable style={styles.cancelButton} onPress={cancelTask}>
            <Text>Cancel</Text>
          </Pressable>
        </View>
      );

    case "done":
      return (
        <View style={styles.cardSuccess}>
          <Text style={styles.checkmark}>Done</Text>
          <Text style={styles.versionDesc}>{task.versionDescription}</Text>
          <Pressable style={styles.dismissButton} onPress={dismissTask}>
            <Text>Dismiss</Text>
          </Pressable>
        </View>
      );

    case "failed":
      return (
        <View style={styles.cardError}>
          <Text style={styles.errorTitle}>Task Failed</Text>
          <Text style={styles.errorBody}>{task.error}</Text>
          <View style={styles.row}>
            <Pressable style={styles.retryButton} onPress={retryTask}>
              <Text>Retry</Text>
            </Pressable>
            <Pressable style={styles.dismissButton} onPress={dismissTask}>
              <Text>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      );
  }
}
```

### TaskInput Component

```tsx
// components/TaskInput.tsx
import { useState } from "react";
import { View, TextInput, Pressable, Text, Keyboard } from "react-native";
import { useTaskStore } from "../stores/task";
import * as Haptics from "expo-haptics";

export function TaskInput() {
  const [text, setText] = useState("");
  const submitTask = useTaskStore((s) => s.submitTask);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await submitTask(trimmed);
    setText("");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>What would you like to build?</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="e.g. Add a mood tracker with daily check-ins"
        multiline
        maxLength={2000}
        textAlignVertical="top"
      />
      <Pressable
        style={[styles.submitButton, !text.trim() && styles.submitDisabled]}
        onPress={handleSubmit}
        disabled={!text.trim()}
      >
        <Text style={styles.submitText}>Submit</Text>
      </Pressable>
    </View>
  );
}
```

---

## 5. Version History & Rollback

### Screen Design

The Versions tab is a flat list of deployments, most recent first. Each row shows:

```
+-----------------------------------------------+
|  v12  "Added mood tracker with charts"         |
|  Apr 5, 2026 at 2:34 PM                       |
|  3 files changed                               |
+-----------------------------------------------+
|  v11  "Fixed navigation bug on habits page"    |
|  Apr 5, 2026 at 11:12 AM                      |
|  1 file changed                                |
+-----------------------------------------------+
|  v10  "Added daily habits checklist"           |
|  Apr 4, 2026 at 4:58 PM                       |
|  7 files changed                               |
+-----------------------------------------------+
```

Tapping a row expands it inline to show:
- Full version description (agent-written, non-technical)
- List of changed files (collapsed by default)
- "Rollback to this version" button (only for non-current versions)

### Data Model

Versions are stored in a PocketBase `_versions` collection:

```typescript
interface VersionInfo {
  id: string;
  versionNumber: number;
  description: string;        // Agent-written, user-friendly
  gitCommitHash: string;
  hasDbSnapshot: boolean;     // Whether a DB snapshot exists for this version
  filesChanged: number;
  createdAt: string;          // ISO timestamp
  isCurrent: boolean;
}
```

### Fetching Versions

```typescript
// stores/versions.ts
import { create } from "zustand";

interface VersionStore {
  versions: VersionInfo[];
  isLoading: boolean;
  error: string | null;

  fetchVersions: () => Promise<void>;
  rollbackTo: (versionId: string) => Promise<RollbackResult>;
}

export const useVersionStore = create<VersionStore>((set, get) => ({
  versions: [],
  isLoading: false,
  error: null,

  fetchVersions: async () => {
    set({ isLoading: true, error: null });
    try {
      const pb = getPocketBaseClient();
      const records = await pb.collection("_versions").getList(1, 50, {
        sort: "-versionNumber",
      });
      set({
        versions: records.items.map(mapToVersionInfo),
        isLoading: false,
      });
    } catch (err) {
      set({ error: "Failed to load versions", isLoading: false });
    }
  },

  rollbackTo: async (versionId) => {
    const api = getApi();
    const result = await api.post(`/api/rollback`, { versionId });
    // After rollback, refresh the version list
    await get().fetchVersions();
    return result;
  },
}));
```

### Rollback Flow

Rollback is always user-initiated. The flow has a mandatory confirmation step:

1. User taps a version row to expand it.
2. User taps "Rollback to this version".
3. A bottom sheet appears with:
   - Warning text: "This will revert your app to version N. Any changes made after this version will be undone."
   - If the version has a DB snapshot: "Database will also be restored to this version's state."
   - If the version does NOT have a DB snapshot: "Note: Only code will be reverted. Database changes since this version will remain."
   - Two buttons: "Cancel" and "Confirm Rollback".
4. On confirm, the app calls POST `/api/rollback` with `{ versionId }` on the dispatch/MCP server.
5. The server performs the rollback (git checkout + optional DB restore).
6. The server emits a deploy event on the `_deployments` collection.
7. The WebView reloads. The version list refreshes to show the restored version as current.

### RollbackConfirm Component

```tsx
// components/RollbackConfirm.tsx
import { View, Text, Pressable } from "react-native";
import { BottomSheet } from "./BottomSheet";

interface Props {
  version: VersionInfo;
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

export function RollbackConfirm({ version, visible, onConfirm, onCancel, isLoading }: Props) {
  return (
    <BottomSheet visible={visible} onDismiss={onCancel}>
      <Text style={styles.title}>Rollback to v{version.versionNumber}?</Text>
      <Text style={styles.description}>"{version.description}"</Text>
      <Text style={styles.warning}>
        This will revert your app to version {version.versionNumber}. Any
        changes made after this version will be undone.
      </Text>
      {version.hasDbSnapshot ? (
        <Text style={styles.info}>
          Database will also be restored to this version's state.
        </Text>
      ) : (
        <Text style={styles.caution}>
          Note: Only code will be reverted. Database changes since this version
          will remain.
        </Text>
      )}
      <View style={styles.actions}>
        <Pressable style={styles.cancelBtn} onPress={onCancel} disabled={isLoading}>
          <Text>Cancel</Text>
        </Pressable>
        <Pressable style={styles.confirmBtn} onPress={onConfirm} disabled={isLoading}>
          <Text style={styles.confirmText}>
            {isLoading ? "Rolling back..." : "Confirm Rollback"}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
```

---

## 6. Connection Setup Flow

### Login Screen

The login screen authenticates the user against the AnyClaw connection broker at `broker.anyclawapp.com`. This is the user's AnyClaw account, not their server credentials.

**OAuth providers:** Google, Apple, and GitHub. Apple is required by the App Store for apps that offer third-party sign-in. GitHub targets the developer early-adopter audience.

**Flow:**
1. User opens app for the first time.
2. Login screen shows three OAuth buttons: "Continue with Google", "Continue with Apple", "Continue with GitHub".
3. Tapping a button opens the OAuth flow via `expo-auth-session` + `expo-web-browser`. The OAuth redirect URI points to the broker at `https://broker.anyclawapp.com/api/auth/callback/{provider}`.
4. Broker validates the OAuth token, creates or looks up the user, and returns a JWT + refresh token.
5. Both tokens are stored in `expo-secure-store` (encrypted keychain on iOS, encrypted SharedPreferences on Android).

```typescript
// lib/auth.ts
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "anyclaw_auth_token";
const REFRESH_KEY = "anyclaw_refresh_token";
const SERVER_CREDS_KEY = "anyclaw_server_creds";

export async function storeAuthTokens(token: string, refresh: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function getAuthToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearAuth() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(SERVER_CREDS_KEY);
}
```

### Server Discovery

After login, the app queries the broker for the user's registered servers:

```
GET https://broker.anyclawapp.com/api/servers
Authorization: Bearer <jwt>

Response:
{
  "servers": [
    {
      "id": "srv_abc123",
      "name": "Home Server",
      "lastSeen": "2026-04-05T14:30:00Z",
      "status": "online",
      "version": "0.3.1"
    }
  ]
}
```

If the user has no servers, the app shows setup instructions (install Docker, run the server setup script, etc.).

If the user has one server and it is online, the app auto-connects. If multiple servers exist, the user picks one.

### Tunnel Establishment (Phase 1: Broker Relay)

1. App sends a connect request to the broker:
   ```
   POST https://broker.anyclawapp.com/api/connect
   Body: { serverId: "srv_abc123" }
   ```
2. Broker allocates a relay subdomain (e.g., `abc123.relay.anyclawapp.com`) and opens a WSS tunnel to the server.
3. Broker returns the relay URL and a session token:
   ```json
   {
     "relayUrl": "https://abc123.relay.anyclawapp.com",
     "sessionToken": "sess_xyz789",
     "pbAuthToken": "pb_token_for_pocketbase_client"
   }
   ```
4. The app stores these in the connection store and in `expo-secure-store` for reconnection on app restart.
5. The WebView loads `https://abc123.relay.anyclawapp.com/app/` (auth token injected via JS bridge, not URL). The host's tunnel manager routes this to the prod static server.
6. The PocketBase client connects to `https://abc123.relay.anyclawapp.com/pb` for realtime subscriptions. The tunnel manager routes this to the PocketBase process.
7. The native shell's task/versions API calls go to `https://abc123.relay.anyclawapp.com/api/*`, routed to the dispatch/MCP server.

### Connection Store

```typescript
// stores/connection.ts
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

interface ConnectionStore {
  isAuthenticated: boolean;
  isConnected: boolean;
  serverUrl: string | null;       // relay URL or direct URL
  sessionToken: string | null;
  pbAuthToken: string | null;
  serverInfo: ServerInfo | null;
  connectionState: "disconnected" | "connecting" | "connected" | "reconnecting";

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  connectToServer: (serverId: string) => Promise<void>;
  reconnect: () => Promise<void>;
  restoreSession: () => Promise<void>;  // Called on app launch
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  isAuthenticated: false,
  isConnected: false,
  serverUrl: null,
  sessionToken: null,
  pbAuthToken: null,
  serverInfo: null,
  connectionState: "disconnected",

  restoreSession: async () => {
    const token = await SecureStore.getItemAsync("anyclaw_auth_token");
    if (!token) return;
    set({ isAuthenticated: true });

    const creds = await SecureStore.getItemAsync("anyclaw_server_creds");
    if (!creds) return;
    const { serverUrl, sessionToken, pbAuthToken } = JSON.parse(creds);

    set({ connectionState: "connecting" });
    try {
      // Verify the session is still valid
      const res = await fetch(`${serverUrl}/api/health`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (res.ok) {
        set({
          isConnected: true,
          serverUrl,
          sessionToken,
          pbAuthToken,
          connectionState: "connected",
        });
      } else {
        // Session expired, need to re-establish via broker
        set({ connectionState: "disconnected" });
      }
    } catch {
      set({ connectionState: "reconnecting" });
      // Will retry in background
    }
  },

  // ... login, connectToServer, etc.
}));
```

### Reconnection Strategy

When the connection drops:
1. The connection store transitions to `"reconnecting"`.
2. The `ConnectionStatus` header badge turns yellow with "Reconnecting...".
3. The app retries with exponential backoff: 1s, 2s, 4s, 8s, 16s, then every 30s.
4. On reconnect, the WebView reloads and PocketBase realtime subscriptions are re-established.
5. If the relay session expired (broker returns 401), the app silently requests a new relay session from the broker using the stored JWT. No user action required unless the JWT itself expired.

---

## 7. NaCl E2E Encryption

All traffic between the mobile app and the user's server is NaCl-encrypted on top of TLS. This ensures the broker relay (Phase 1) cannot read traffic even if compromised.

### Key Management

The mobile app uses `tweetnacl` (NaCl) for key generation, key exchange, and encrypt/decrypt operations.

**Key generation (on first connection):**

```typescript
// lib/crypto.ts
import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import * as SecureStore from "expo-secure-store";

const KEYPAIR_KEY = "anyclaw_nacl_keypair";

export async function getOrCreateKeyPair(): Promise<nacl.BoxKeyPair> {
  const stored = await SecureStore.getItemAsync(KEYPAIR_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    return {
      publicKey: decodeBase64(parsed.publicKey),
      secretKey: decodeBase64(parsed.secretKey),
    };
  }

  const keyPair = nacl.box.keyPair();
  await SecureStore.setItemAsync(
    KEYPAIR_KEY,
    JSON.stringify({
      publicKey: encodeBase64(keyPair.publicKey),
      secretKey: encodeBase64(keyPair.secretKey),
    })
  );
  return keyPair;
}
```

**Key exchange via broker:**

1. On first connection to a server, the mobile app generates a NaCl keypair and stores it in `expo-secure-store`.
2. The app sends its public key to the broker: POST `https://broker.anyclawapp.com/api/key-exchange` with `{ serverId, clientPublicKey }`.
3. The broker relays the client's public key to the server and returns the server's public key.
4. Both sides now have each other's public keys and can compute a shared secret for NaCl box encryption.
5. Public keys are cached locally. Re-exchange only happens if the server's key changes (server reinstall).

**Encrypt/decrypt:**

```typescript
export function encryptMessage(
  message: string,
  theirPublicKey: Uint8Array,
  mySecretKey: Uint8Array
): { encrypted: string; nonce: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = new TextEncoder().encode(message);
  const encrypted = nacl.box(messageBytes, nonce, theirPublicKey, mySecretKey);
  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

export function decryptMessage(
  encrypted: string,
  nonce: string,
  theirPublicKey: Uint8Array,
  mySecretKey: Uint8Array
): string {
  const decrypted = nacl.box.open(
    decodeBase64(encrypted),
    decodeBase64(nonce),
    theirPublicKey,
    mySecretKey
  );
  if (!decrypted) throw new Error("Decryption failed");
  return new TextDecoder().decode(decrypted);
}
```

### Integration with API Layer

The `lib/api.ts` module wraps all HTTP requests and PocketBase SSE traffic with NaCl encryption:

- **Outgoing REST requests:** Request body is encrypted with `encryptMessage()` before sending. The `Content-Type` header is set to `application/x-nacl-box`.
- **Incoming REST responses:** Response body is decrypted with `decryptMessage()`.
- **SSE events:** Each SSE event payload is NaCl-encrypted by the server. The PocketBase subscription handler decrypts before passing to the zustand store.
- **WebView traffic:** The WebView loads content over TLS from the relay. The JS bridge injects the NaCl keys so the agent-built frontend can also encrypt/decrypt API calls to PocketBase. Alternatively, the native shell can proxy PocketBase requests through the bridge with encryption handled natively.

---

## 8. Push Notifications

### Setup

Push notifications use Expo's push notification service (Expo Push). The server sends notifications through Expo's push API.

**Registration flow:**
1. On first connection, the app requests push notification permissions.
2. If granted, the app gets an Expo push token via `Notifications.getExpoPushTokenAsync()`.
3. The app sends this token to the user's server: POST `/api/device/register` with `{ pushToken, platform }`.
4. The server stores it and uses it to send notifications via the Expo Push API.

```typescript
// lib/notifications.ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    // Push notifications don't work on simulators
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  // Android requires a notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "AnyClaw",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}
```

### Notification Types

The server sends push notifications for three events:

| Event | Title | Body | Deep Link |
|-------|-------|------|-----------|
| Task needs clarification | "Question from your agent" | The agent's question (truncated) | `anyclaw://task/{taskId}` |
| Task completed | "New version deployed" | Version description (truncated) | `anyclaw://versions` |
| Task failed | "Task failed" | Error summary (truncated) | `anyclaw://task/{taskId}` |

### Deep Linking

Tapping a notification opens the app to the relevant screen via expo-router deep links:

```typescript
// In app/_layout.tsx
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";

function useNotificationDeepLink() {
  const router = useRouter();

  useEffect(() => {
    // Handle notification tapped while app was in background
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        if (data?.screen === "task" && data?.taskId) {
          router.push(`/(main)/task/${data.taskId}`);
        } else if (data?.screen === "versions") {
          router.push("/(main)/versions");
        }
      }
    );
    return () => subscription.remove();
  }, [router]);
}
```

### Server-Side Push (Node.js Logic Service)

The server uses the Expo Push API to send notifications. This runs inside the `sendNotification` primitive defined in Plan 1:

```typescript
// packages/logic/src/primitives/send-notification.ts
import { Expo, ExpoPushMessage } from "expo-server-sdk";

const expo = new Expo();

export async function sendNotification(
  pushTokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
) {
  const messages: ExpoPushMessage[] = pushTokens
    .filter((token) => Expo.isExpoPushToken(token))
    .map((token) => ({
      to: token,
      sound: "default",
      title,
      body,
      data,
    }));

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    await expo.sendPushNotificationsAsync(chunk);
  }
}
```

---

## 9. Technical Decisions (Resolved)

All open questions from the original design have been resolved by the locked decisions in the main spec.

| # | Question | Resolution | Reference |
|---|----------|------------|-----------|
| 8.1 | Tab bar vs FAB for task dispatch | **Dedicated "Request" tab + full-screen modal/bottom sheet.** Clear, discoverable, avoids WebView z-index conflicts. Not FAB. | Spec decision #9 |
| 8.2 | Minimum Android API level | **API 28 (Android 9.0).** Drops ~5% of devices. Better WebView, dark mode, biometric API. | Spec decision #10 |
| 8.3 | Offline native shell behavior | **Cache-nothing for MVP.** Server down = reconnect screen. No offline cache. | Spec decision #11 |
| 8.4 | Concurrent tasks | **Single active task + queue.** Design with task isolation for future parallelization. | Spec decision #1 |
| 8.5 | WebView auth token model | **JS bridge injection after page load.** Most secure -- token never in URL or logs. Frontend waits for bridge `session-token` message before making API calls. | Spec decision #12 |

---

## New Gaps

Technical decisions that emerged from applying the locked decisions to this design. These need resolution before implementation.

**Resolved by the supervised-process architecture:**
- ~~Control plane vs app server URL routing~~ — path-based routing through a single tunnel: `/pb/*` → PocketBase, `/api/*` → dispatch/MCP server, `/app/*` → prod static server. Availability across crashes comes from independent process supervision, not from separate subdomains.
- ~~Task state ownership~~ — PocketBase is the single source of truth. The dispatch/MCP server writes `_tasks` records directly; there is no second task store. PocketBase runs as its own supervised process, so task state stays available even when the logic service is crashed.

### 1. NaCl encryption for WebView traffic

The locked decision requires NaCl E2E encryption on all traffic through the broker relay. For native REST/SSE calls, this is straightforward (encrypt in `lib/crypto.ts`). But the WebView loads HTML/CSS/JS assets and makes its own PocketBase API calls. **Options:**

- **(a) Proxy all WebView API calls through the native shell via JS bridge.** The agent-built frontend calls `window.AnyClaw.fetch()` instead of `fetch()`. The native shell encrypts, sends, receives, decrypts, and returns the result. Assets are fetched natively and injected. High complexity, but true E2E for everything.
- **(b) NaCl encrypt only the relay tunnel at the transport layer.** The broker relay decrypts TLS, then re-encrypts with NaCl for the hop to the server (or vice versa). Simpler, but the broker momentarily sees plaintext.
- **(c) Inject NaCl keys into the WebView and let the frontend encrypt its own PocketBase calls.** Less secure (keys in JS memory) but simpler. Asset loading remains unencrypted through the relay.
- **(d) Accept that WebView asset traffic goes through TLS-only relay, and only NaCl-encrypt sensitive API payloads (task data, user content).** Pragmatic middle ground.

**Decision needed:** Which approach for WebView traffic encryption?

### 2. NaCl key rotation and revocation

The current design generates a keypair on first connection and caches it. **Questions:**

- How often should keys rotate? On every new relay session? Periodically? Never (until server reinstall)?
- If a user loses their phone, how do they revoke the old keypair? Does the broker need a key revocation endpoint?
- Should there be a "re-pair" flow in the app settings for manually triggering key exchange?

**Decision needed:** Key rotation policy and revocation mechanism.

### 3. OAuth token storage and refresh

With OAuth (Google/Apple/GitHub) replacing email/password, the auth flow changes. **Questions:**

- Does the broker issue its own JWT after OAuth validation, or does the app store the OAuth provider's tokens directly?
- If the broker issues its own JWT, what is the refresh token strategy? The broker needs its own refresh endpoint.
- Apple Sign In requires handling the "user info only provided on first login" quirk -- the broker must persist user details from the first OAuth callback.

**Decision needed:** Broker JWT strategy and OAuth token lifecycle.

### 4. Full-screen modal/bottom sheet interaction for task dispatch

The locked decision says "dedicated Request tab + full-screen modal/bottom sheet" but the current code shows the task card inline in the tab. **Questions:**

- Is the modal/bottom sheet triggered by a "New Request" button on the Task tab, opening over the tab content?
- Or does the Task tab itself present as a bottom sheet overlaying the Home tab (WebView)?
- For the clarification Q&A flow, does each round stay within the same modal, or does the modal dismiss and re-present?
- On small screens, should the modal be a full-screen modal (iOS style) or a draggable bottom sheet (Material style)?

**Decision needed:** Exact modal/bottom sheet UX for the task dispatch flow.
