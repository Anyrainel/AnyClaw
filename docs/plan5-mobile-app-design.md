# Plan 5: Mobile App — Technical Design

**Goal:** Build the AnyClaw companion mobile app -- a thin Expo (React Native) shell that wraps the agent-built web UI in a WebView, manages server connections, dispatches tasks to the coding agent, and provides version history with rollback.

**Architecture:** The app has two layers: (1) a native shell built with Expo Router (tabs + stack navigation) that handles connection setup, task dispatch, version history, and settings; (2) a full-screen WebView that loads the agent-built React frontend from the user's server. The native shell and WebView communicate via a postMessage/onMessage JS bridge.

**Tech Stack:** Expo SDK 52, expo-router v4, react-native-webview, expo-secure-store, expo-notifications, zustand (state management), React Native Reanimated (animations).

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
    "date-fns": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "~5.6.0",
    "@types/react": "~18.3.0",
    "jest": "^29.0.0",
    "jest-expo": "~52.0.0"
  }
}
```

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
│   │   ├── login.tsx                 # Login / signup
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
│   ├── api.ts                        # HTTP/WS client for server communication
│   ├── bridge.ts                     # WebView JS bridge helpers
│   ├── auth.ts                       # Auth token management
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
    ├── Task tab       — Task dispatch card (input/clarify/working/done/failed)
    ├── Versions tab   — Version history list with rollback
    └── Settings tab   — Server status, adapter config, logs, account
```

### Tab Bar Design

The tab bar uses four icons and sits at the bottom of the screen. The Home tab is the default. A small badge on the Task tab appears when the agent has a pending clarifying question.

```
  [Home]    [Task]    [Versions]    [Settings]
    o        o (!)        o             o
```

- **Home** -- Globe or app icon. The WebView fills the entire safe area above the tab bar. No header.
- **Task** -- Sparkle or wand icon. Shows the task card. Header: "New Request" or the current task's short title.
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
          title: "Task",
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

The WebView loads the production frontend from the user's server. The URL is constructed from the stored connection credentials:

```
https://<tunnel-host>/app?token=<session-token>
```

In Phase 1 (broker relay), the tunnel host is a subdomain on the broker (e.g., `abc123.relay.anyclaw.io`). In Phase 2 (WebRTC), the WebView connects to a local HTTP server that proxies over the data channel -- but this is transparent to the WebView component.

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

  const uri = `${serverUrl}/app?token=${sessionToken}`;

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const msg = parseBridgeMessage(event.nativeEvent.data);
    if (!msg) return;

    switch (msg.type) {
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
  }, []);

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
| Server returns 5xx | WebView `onHttpError` with status >= 500 | Same as above |
| Server returns 401 | WebView `onHttpError` with status 401 | Attempt token refresh; if that fails, redirect to login |
| WebView JS crash | WebView `onRenderProcessGone` (Android) / `onContentProcessDidTerminate` (iOS) | Auto-reload the WebView, show brief toast |
| Slow load (>10s) | Timer started on load begin | Show "Still loading..." overlay with option to retry |

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

Tasks are dispatched and monitored through the server's agent adapter REST API. The mobile app does NOT communicate directly with the coding agent -- it goes through the server's adapter layer.

**Endpoints (served by the Node.js logic service):**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/tasks` | Submit a new task. Body: `{ request: string }`. Returns `{ taskId: string }`. |
| GET | `/api/tasks/:id` | Get current task status. Returns `TaskStatus`. |
| POST | `/api/tasks/:id/answer` | Answer a clarifying question. Body: `{ answer: string }`. |
| POST | `/api/tasks/:id/cancel` | Cancel a running task. |
| GET | `/api/tasks/:id/activity` | Get the activity log. Returns `ActivityEntry[]`. |

**Polling vs WebSocket vs SSE:**

For Phase 1, use **SSE (Server-Sent Events)** via PocketBase realtime subscriptions. The mobile app subscribes to the `_tasks` collection for the active task ID. When the adapter updates the task record in PocketBase, the change streams to the mobile app in real time.

```typescript
// lib/api.ts — task status subscription
function subscribeToTask(taskId: string, onUpdate: (status: TaskStatus) => void) {
  const pb = getPocketBaseClient();
  pb.collection("_tasks").subscribe(taskId, (event) => {
    onUpdate(event.record as unknown as TaskStatus);
  });

  // Return unsubscribe function
  return () => pb.collection("_tasks").unsubscribe(taskId);
}
```

Fallback: if the SSE connection drops, the app polls GET `/api/tasks/:id` every 3 seconds until the SSE connection is re-established.

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
    const result = await api.post(`/api/versions/${versionId}/rollback`);
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
4. On confirm, the app calls POST `/api/versions/:id/rollback`.
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

The login screen authenticates the user against the AnyClaw connection broker. This is the user's AnyClaw account, not their server credentials.

**Flow:**
1. User opens app for the first time.
2. Login screen shows email + password fields and a "Sign Up" link.
3. On submit, the app calls the broker's auth endpoint: POST `https://broker.anyclaw.io/api/auth/login`.
4. Broker returns a JWT + refresh token.
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
GET https://broker.anyclaw.io/api/servers
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
   POST https://broker.anyclaw.io/api/connect
   Body: { serverId: "srv_abc123" }
   ```
2. Broker allocates a relay subdomain (e.g., `abc123.relay.anyclaw.io`) and opens a WSS tunnel to the server.
3. Broker returns the relay URL and a session token:
   ```json
   {
     "relayUrl": "https://abc123.relay.anyclaw.io",
     "sessionToken": "sess_xyz789",
     "pbAuthToken": "pb_token_for_pocketbase_client"
   }
   ```
4. The app stores these in the connection store and in `expo-secure-store` for reconnection on app restart.
5. The WebView loads `https://abc123.relay.anyclaw.io/app?token=sess_xyz789`.
6. The PocketBase client connects to `https://abc123.relay.anyclaw.io/pb` for realtime subscriptions.

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

## 7. Push Notifications

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

## 8. Technical Decisions Needed

### 8.1. Tab bar vs bottom sheet for task dispatch

The current design places task dispatch in a dedicated tab. An alternative is a floating action button (FAB) that opens a bottom sheet overlay, keeping the WebView always visible behind it. The FAB approach feels more natural for a "quick request" interaction pattern and avoids navigating away from the agent-built UI. The tab approach is simpler and avoids z-index / gesture conflicts with the WebView.

**Decision needed:** Tab bar with dedicated Task tab, or FAB + bottom sheet overlay on top of the WebView?

### 8.2. Minimum supported OS versions

Expo SDK 52 supports iOS 15.1+ and Android 6.0+ (API 23+). However, targeting older Android versions increases testing burden significantly. WebView behavior (especially around WebSocket and SSE support) varies across Android WebView versions.

**Decision needed:** Should we raise the Android minimum to API 26+ (Android 8.0) to avoid older WebView quirks? This would drop roughly 2% of active Android devices.

### 8.3. Offline behavior for the native shell

Currently, the spec says "server down = app shows reconnect screen." But the native screens (version history, past task list) could work with cached data. Should the app persist the version list and past tasks to local storage so they're visible even when disconnected?

**Decision needed:** Cache-nothing (always show reconnect screen), or cache-with-staleness-indicator (show cached data with a banner: "Last updated 2 hours ago")?

### 8.4. How to handle multiple concurrent tasks

The current design assumes one active task at a time. But a user might want to submit a second request while the first is still working (e.g., "fix the color on the header" while a larger feature is building). Supporting concurrent tasks adds complexity to the state machine, the task tab UI, and the server adapter.

**Decision needed:** Strict single-task (queue additional requests), or allow up to N concurrent tasks with a task list UI?

### 8.5. Auth model for the WebView session token

The WebView loads the agent-built frontend with a session token in the URL query parameter. This token is visible in the URL bar (if any) and in server logs. Alternatives: (a) inject the token via the JS bridge after page load instead of the URL, (b) use an HTTP-only cookie set by the relay, (c) accept the query parameter approach since the relay URL is already scoped to the user.

**Decision needed:** Query parameter token (simplest), JS bridge injection (more secure, but requires the frontend to wait for the bridge), or HTTP-only cookie (requires cookie support in the relay)?
