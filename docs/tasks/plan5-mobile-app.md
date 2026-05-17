# Plan 5: Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for all tasks in this plan. Each task is self-contained and can be dispatched to a subagent. Logic tasks use TDD (superpowers:test-driven-development). UI tasks end in a CHECKPOINT for human review before proceeding.

**Goal:** Ship a production-ready Expo (React Native) companion app that authenticates the user, pairs end-to-end-encrypted with their AnyRaven server, renders the agent-built frontend in a WebView, dispatches tasks with a resumable state machine, and exposes version history, rollback, and personalization preferences.

**Architecture:** A thin Expo managed-workflow shell using expo-router tabs over four screens (Home/WebView, Request, Versions, Settings) plus an onboarding stack and an auth stack. All sensitive traffic is wrapped in `libsodium` `crypto_box` envelopes on top of TLS; task/version state streams over PocketBase Realtime SSE; zustand stores back every screen. The WebView and native shell talk over a postMessage JS bridge that injects the session token and resolved preferences.

**Tech Stack:** Expo SDK 52+, React Native, expo-router, libsodium-wrappers, pocketbase JS SDK, zustand, expo-secure-store, expo-auth-session

**Dependencies:** Plan 4 (Broker) for OAuth/pairing endpoints. Plan 1+2+3 (server) for the host the app talks to.

**Plans that depend on this:** None — leaf plan.

**Plan Style Note:** This plan mixes rigid TDD tasks (logic, state, crypto) with CHECKPOINT tasks (UI screens that need visual iteration with the user). Checkpoints are marked clearly. Visual details — the `@theme` block, exact pixel values, animation timings, copy — are deliberately left open and decided during the checkpoint reviews.

---

## Task 1: Project scaffold and dependencies

**Type:** Setup (no checkpoint)

Create the Expo managed-workflow project at the repo root under `mobile/` with TypeScript, expo-router v4, and the full dependency list from the design doc.

- `npx create-expo-app@latest mobile -t tabs@52`
- Prune the generated tabs; we rebuild routing in Task 3.
- Install: `expo-router expo-secure-store expo-notifications expo-auth-session expo-web-browser expo-haptics expo-device expo-constants expo-localization react-native-webview react-native-reanimated react-native-safe-area-context react-native-gesture-handler zustand pocketbase@^0.25.0 libsodium-wrappers tweetnacl-util date-fns`
- Dev deps: `jest-expo @testing-library/react-native @testing-library/jest-native @types/libsodium-wrappers`
- Configure `app.json` exactly as the design doc section 3 specifies (scheme `anyraven`, iOS deploymentTarget 15.1, Android minSdkVersion 28, plugins `expo-router` + `expo-secure-store`).
- Configure `tsconfig.json` with strict mode and the `@/*` path alias → `./`.
- Configure `jest-expo` preset in `package.json` with `setupFilesAfterEach` for `@testing-library/jest-native`.
- Create the folder skeleton from section 4 of the design doc (`app/`, `components/`, `lib/`, `stores/`, `types/`) with empty `.gitkeep` placeholders.
- Add `npm run test`, `npm run lint`, `npm run typecheck` scripts.

**Done when:** `npx expo start` boots; `npm run typecheck` passes on the empty scaffold; `npm test` runs zero tests successfully.

---

## Task 2: `lib/crypto.ts` — libsodium init, pairing keypair, BIP39 verification code, box encrypt/decrypt (TDD)

**Type:** TDD logic task

Write `lib/crypto.ts` and `lib/crypto-storage.ts` implementing:

- `initCrypto()` awaiting `sodium.ready`, idempotent.
- `generatePairingKeypair(): Promise<{ publicKey, secretKey }>`
- `verificationCode(clientPk, serverPk): string[]` deterministic 4-word BIP39 code derived via `crypto_generichash(8, "anyraven-pair", clientPk || serverPk)`, reading from a bundled `lib/bip39-english.ts` wordlist (2048 words).
- `encryptJSON(plain, theirPk, mySk): Envelope` and `decryptJSON<T>(env, theirPk, mySk): T` using `crypto_box_easy`.
- `storePairingKeys(serverId, keys)` and `loadPairingKeys(serverId)` in `lib/crypto-storage.ts` backed by `expo-secure-store`, serializing via `sodium.to_base64`/`from_base64`.

**Tests first (`lib/__tests__/crypto.test.ts`):**
1. `encryptJSON`/`decryptJSON` round-trip an object with nested fields.
2. Tampering with one byte of ciphertext causes `decryptJSON` to throw.
3. `verificationCode` is deterministic — same inputs produce the same 4 words.
4. `verificationCode` is symmetric-input-sensitive — swapping pks produces a different code (server and client must pass args in the same order).
5. `verificationCode` returns exactly 4 words, all present in the wordlist.
6. `generatePairingKeypair` produces 32-byte keys and two calls produce different keys.
7. `loadPairingKeys` after `storePairingKeys` round-trips all three keys (mock `expo-secure-store`).

**Done when:** All 7 tests pass; no `any` in public API.

---

## Task 3: Root layout, expo-router tree, and auth gate (TDD for the gate)

**Type:** TDD logic + scaffold

Build the router tree per design doc sections 4 and 5:

- `app/_layout.tsx` — `<Slot />` inside safe-area and gesture-handler providers; calls `usePreferencesStore.getState().hydrate()` and `useConnectionStore.getState().restoreSession()` on mount.
- `app/(auth)/_layout.tsx` — Stack.
- `app/(auth)/login.tsx`, `server-list.tsx`, `pair.tsx` — empty placeholder screens that render the route name.
- `app/(onboarding)/_layout.tsx` — Stack with `headerShown:false`, `gestureEnabled:false`.
- `app/(onboarding)/welcome.tsx`, `theme.tsx`, `font-size.tsx`, `font-family.tsx`, `language.tsx`, `accent.tsx`, `try.tsx` — placeholder screens.
- `app/(main)/_layout.tsx` — Tabs with `index`, `request`, `versions`, `settings`.
- `app/(main)/index.tsx`, `request.tsx`, `versions.tsx`, `settings.tsx`, `task/[id].tsx` — placeholders.

Implement an **auth-gate hook** `useAuthGate()` in `lib/auth-gate.ts` containing the redirect logic as a pure function:

```ts
export function resolveRoute(input: {
  isAuthenticated: boolean;
  isConnected: boolean;
  onboardingComplete: boolean;
  segments: string[];
}): string | null
```

Returns a redirect target or `null` for "stay".

**Tests first (`lib/__tests__/auth-gate.test.ts`):**
1. Unauthenticated + not in `(auth)` → `/(auth)/login`.
2. Authenticated + onboarding incomplete + not in `(onboarding)` → `/(onboarding)/welcome`.
3. Authenticated + onboarding complete + not connected + not in `(auth)` → `/(auth)/server-list`.
4. Fully ready + currently in `(auth)` → `/(main)`.
5. Fully ready + in `(main)` → `null` (stay).
6. Authenticated + onboarding complete + not connected + already in `(auth)` → `null`.

Wire the root layout to call `resolveRoute` in a `useEffect`.

**Done when:** Tests pass; app boots to the login placeholder on fresh install; navigating manually in the hierarchy does not crash.

---

## Task 4: Preferences store (TDD) — `lib/preferences/`

**Type:** TDD logic

Implement `lib/preferences/types.ts`, `system.ts`, and `store.ts` per design doc §9b.3. The store must be **offline-first**: SecureStore is source of truth when offline, PocketBase overrides on hydrate if authenticated.

Requirements:
- `usePreferencesStore` exposes `prefs`, `resolvedTheme`, `resolvedFontScale`, `hydrated`, `hydrate()`, `set(patch)`, `reset()`.
- `resolve(prefs)` maps `'system'` theme → `Appearance.getColorScheme()` and `'system'` font size → `PixelRatio.getFontScale()`; explicit overrides go through `FONT_SCALE_MAP` (`small: 0.85, medium: 1.0, large: 1.2`).
- `hydrate()` seeds from SecureStore, falls back to `DEFAULT_PREFERENCES` with `language` from `Localization.getLocales()[0].languageTag`, then best-effort fetches from PocketBase `_user_preferences`.
- `set(patch)` always writes SecureStore first, then best-effort PocketBase upsert.
- `reset()` clears SecureStore, reseeds defaults, and clears `onboarding_completed_at`.

**Tests first (`lib/preferences/__tests__/store.test.ts`):** mock `expo-secure-store`, `react-native` (Appearance/PixelRatio/AppState), `expo-localization`, and `pb`.
1. First-ever hydrate (no cache, not authenticated) → defaults with language from locale.
2. Hydrate with SecureStore cache → cached values, no PB call.
3. Hydrate authenticated with remote row → remote overrides local and writes back to SecureStore.
4. Hydrate authenticated with PB network failure → local values preserved.
5. `set({ theme: 'dark' })` → SecureStore written before PB call.
6. `resolve()` with `theme: 'system'` and system dark → `resolvedTheme: 'dark'`.
7. `resolve()` with `font_size: 'large'` → `resolvedFontScale: 1.2`.
8. `reset()` clears `onboarding_completed_at` and reseeds language.

**Done when:** Tests pass; the store is wired into the root layout's mount-time hydrate.

---

## Task 5: Broker OAuth module (TDD)

**Type:** TDD logic

Implement `lib/broker.ts` per design doc §9.1:

- `loginWithProvider(provider: 'google' | 'apple' | 'github')` using `expo-auth-session` against `https://broker.anyraven.com/auth/{provider}/start`. On success stores `broker_jwt` and `broker_refresh` in SecureStore.
- `refreshBrokerJwt()` posts to `/auth/refresh`, updates SecureStore, returns the new access token, throws on failure.
- `fetchServers()` GETs `/api/servers` with the current JWT, auto-refreshing once on 401.
- `requestPairing(serverId, clientPublicKey)` POSTs to `/api/pair` and returns `{ serverPublicKey }` as a `Uint8Array`.
- `establishTunnel(serverId)` POSTs to `/api/connect` and returns `{ relayUrl, sessionToken, pbAuthToken }`.

**Tests first (`lib/__tests__/broker.test.ts`):** mock `fetch`, `expo-secure-store`, `expo-auth-session`.
1. `loginWithProvider('google')` success → SecureStore has both tokens.
2. `loginWithProvider` cancelled → throws `"OAuth cancelled"` and does not touch SecureStore.
3. `refreshBrokerJwt` with no refresh token → throws.
4. `refreshBrokerJwt` on 401 → throws `"Refresh failed"`.
5. `fetchServers` 401 then 200 → single refresh, then retry succeeds.
6. `fetchServers` 401 then 401 → throws.
7. `requestPairing` correctly base64-encodes the client public key in the request body and base64-decodes the response.

**Done when:** Tests pass; no real network calls.

---

## Task 6: API client with NaCl envelopes (TDD)

**Type:** TDD logic

Implement `lib/api.ts` per design doc §10.

- `ApiClient` class with `configure({ baseUrl, sessionToken, serverId, debug })`, `get<T>(path)`, `post<T>(path, body)`. `baseUrl` always points at the dispatch REST API root (`/api/*`, port 4100 on the host; in the paired-over-broker case, requests go to `https://broker.anyraven.com/relay/client` and are routed via the in-envelope `service` tag). The full host surface the app talks to: `POST /api/tasks`, `POST /api/tasks/:id/answer`, `POST /api/tasks/:id/cancel`, `POST /api/rollback`, `POST /api/restart-app`, `GET /api/versions`, `GET /api/health`, `GET /api/settings`, `PATCH /api/settings`, `POST /api/device/register`.
- POST wraps body in `encryptJSON` under the loaded pairing keys, sends with headers `content-type: application/x-nacl-box`, `authorization: Bearer ...`, `x-anyraven-client-pk: <base64>`, and decrypts the response.
- GET sends no body, decrypts the response envelope.
- Non-2xx responses throw `Error("HTTP ${status}")`.
- Debug mode (from `useSettingsStore.debugEncryptedTraffic`) routes plaintext through a `lib/log-buffer.ts` ring buffer (last 500 entries) — **never** to the network.

**Tests first (`lib/__tests__/api.test.ts`):** mock `fetch`, crypto, crypto-storage.
1. `post` encrypts body and attaches the three expected headers.
2. `post` decrypts response and returns plaintext typed value.
3. `get` returns decrypted response.
4. HTTP 500 → throws `"HTTP 500"`.
5. Debug mode on → plaintext request and response land in the ring buffer; ring buffer caps at 500.
6. Calling `post` before `configure` → throws `"api client not configured"`.

**Done when:** Tests pass. Export `apiClient` singleton and `logBuffer`.

---

## Task 7: PocketBase SSE wrapper (TDD)

**Type:** TDD logic

Implement `lib/pocketbase.ts` per design doc §11.

- `initPocketBase(relayUrl, pbAuthToken, serverId)`, `getPocketBase()`.
- `subscribeToTask(taskId, onUpdate)` subscribes to the `_tasks` collection, `subscribeToAgentMessages(onMessage)` subscribes to `_agent_messages`, `subscribeToDeployments(onDeploy)` subscribes to `_deployments` — all decrypt envelope records via `loadPairingKeys` before passing to the callback, and return an unsubscribe function. All subscriptions are routed through the broker relay using the `pb` service tag.
- A `reconnectPolicy` wrapper that, on SSE error, re-fetches the latest record for the active task via REST before resuming — the "catch up missed updates after a drop" behavior from §11.

**Tests first (`lib/__tests__/pocketbase.test.ts`):** mock the `pocketbase` module.
1. `subscribeToTask` decrypts the incoming envelope and passes the plaintext record to the callback.
2. Unsubscribe function actually calls `pb.collection.unsubscribe`.
3. `subscribeToDeployments` only fires `onDeploy` on `action === 'create'`.
4. SSE error → reconnectPolicy refetches via REST and re-subscribes.
5. `getPocketBase()` before `initPocketBase()` throws.

**Done when:** Tests pass.

---

## Task 8: Connection store with exponential backoff (TDD)

**Type:** TDD logic

Implement `stores/connection.ts` per design doc §9.6.

- State: `isAuthenticated`, `isConnected`, `serverUrl`, `sessionToken`, `pbAuthToken`, `connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'`.
- `restoreSession()`, `reconnect()` (exponential backoff `[1, 2, 4, 8, 16, 30]` seconds capped), `logout()`.
- On the first backoff attempt, call `refreshBrokerJwt()` once before retrying.
- `reconnect()` exits the loop when `/api/health` succeeds; tests use injected delay/health fakes to avoid real timers.

**Tests first (`stores/__tests__/connection.test.ts`):** mock `apiClient`, `broker`, `expo-secure-store`, `lib/pocketbase`.
1. `restoreSession` with no JWT → state unchanged.
2. `restoreSession` with JWT and session → health check passes → `isConnected: true`, `connectionState: 'connected'`.
3. `restoreSession` health check fails → transitions to `reconnecting` and kicks off `reconnect()`.
4. `reconnect` delays follow the backoff schedule `[1000, 2000, 4000, 8000, 16000, 30000, 30000, ...]`.
5. `reconnect` calls `refreshBrokerJwt` exactly once (on attempt 0).
6. `logout` clears all three SecureStore keys and resets all state.

**Done when:** Tests pass; no real `setTimeout` waits (use fake timers).

---

## Task 9: Task store with full state machine (TDD)

**Type:** TDD logic

Implement `stores/task.ts` per design doc §7.

- Full state machine: `idle → input → (clarifying ↔ working) → deploying → done | failed`.
- `submitTask(request)` generates an idempotency key, optimistically creates the active task, POSTs `/api/tasks`, subscribes to SSE, transitions to `working` on success.
- `answerQuestion(answer)` only valid in `clarifying`, optimistically transitions to `working`, appends to `qaHistory`.
- `cancelTask()`, `retryTask()`, `dismissTask()` (moves to `pastTasks`, capped at 50).
- `resumeActiveTask()` queries PocketBase for the most recent non-terminal task and re-subscribes.
- `_applyServerRecord(rec)` merges incoming SSE records into `activeTask`.

**Tests first (`stores/__tests__/task.test.ts`):** mock `apiClient`, `lib/pocketbase`.
1. `submitTask` success: optimistic `input` → `working`, subscription installed, idempotency key sent.
2. `submitTask` failure: state becomes `failed` with error message, no subscription.
3. `answerQuestion` in wrong state is a no-op.
4. `answerQuestion` appends to `qaHistory`, clears `question`, transitions to `working`, posts to `/api/tasks/:id/answer`.
5. `_applyServerRecord` with `state: 'clarifying'` and `question: '...'` updates the store.
6. `dismissTask` unsubscribes and pushes to `pastTasks` capped at 50.
7. `retryTask` only runs from `failed`, reuses original request.
8. `resumeActiveTask` fetches the newest non-terminal task and re-subscribes; no-op if none found.
9. `cancelTask` posts to cancel endpoint then dismisses.

**Done when:** All 9 tests pass.

---

## Task 10: Versions store (TDD)

**Type:** TDD logic

Implement `stores/versions.ts` per design doc §8.

**Tests first (`stores/__tests__/versions.test.ts`):**
1. `fetchVersions` success populates `versions` and clears error.
2. `fetchVersions` failure sets `error` and clears `isLoading`.
3. `rollbackTo` posts, then refetches.
4. `rollbackTo` error propagates.

**Done when:** Tests pass.

---

## Task 11: Settings store (TDD)

**Type:** TDD logic

Implement `stores/settings.ts` per design doc §13 — but use `expo-secure-store` instead of `AsyncStorage` since we have it already. Fields: `clarificationMode`, `clarificationTimeoutMinutes`, `debugEncryptedTraffic`.

**Tests first:**
1. `hydrate` loads from SecureStore.
2. `update({ clarificationMode: 'pause-indefinitely' })` writes SecureStore and mirrors to the host via `PATCH /api/settings`. `hydrate()` may pull current server values via `GET /api/settings`.
3. `update({ debugEncryptedTraffic: true })` writes SecureStore but does **not** hit the network.
4. Mirror network failure does not throw (best-effort).

**Done when:** Tests pass.

---

## Task 12: Bridge protocol and preference injection (TDD)

**Type:** TDD logic

Implement `lib/bridge.ts` per design doc §6.2 plus a `buildResolvedPreferencesPayload(prefs, resolvedTheme, resolvedFontScale)` helper that maps the internal preferences into the external `Preferences` shape documented in §9b.6 (resolved theme, resolved `fontScale` number, `fontFamily`, `language`, `accent`).

**Tests first (`lib/__tests__/bridge.test.ts`):**
1. `parseBridgeMessage` accepts valid JSON with a string `type`.
2. Malformed JSON → `null`.
3. Missing `type` → `null`.
4. `buildResolvedPreferencesPayload` never includes `'system'` in `theme` or `font_size` output.
5. `buildResolvedPreferencesPayload` with `font_size: 'large'` → `fontScale: 1.2`.

**Done when:** Tests pass.

---

## Task 13: Onboarding screens (scaffold + logic + CHECKPOINT)

**Type:** UI with checkpoint

**13a. Scaffold:** Build each of the 7 onboarding screens listed in the design doc §9b.1 with minimal placeholder layout — one heading, the choice controls (cards/swatches/pickers), a `Next` button, and a top-right `Skip` link (except Welcome and Pair). Wire navigation through the stack in order. Do **not** polish visuals.

**13b. Logic:** Each screen's controls call `usePreferencesStore.getState().set({ ... })` on change. The final `try.tsx` screen writes `onboarding_completed_at: new Date().toISOString()` and routes to `/(main)`. Live preview on theme and accent screens reads `resolvedTheme` and `accent_color` from the store so the screen re-renders on change. Welcome screen shows one paragraph and a single Get Started button. Language screen uses `Localization.getLocales()` for detection plus a minimal searchable list from a bundled `lib/locales.ts` (e.g., the 20 most common BCP 47 tags to start).

**13c. CHECKPOINT:** User runs the app, taps through the full onboarding flow — welcome → theme → font size → font family → language → accent → (skips pair for now) → try. Verifies live previews work, skip actions advance, and preferences persist across restart. User signs off on visuals, copy, and animation or requests changes before proceeding.

---

## Task 14: Login and server-list screens (scaffold + logic + CHECKPOINT)

**Type:** UI with checkpoint

**14a. Scaffold:** `login.tsx` with three OAuth buttons (Google, Apple, GitHub). `server-list.tsx` with a list renderer and three empty/loading/error states plus a "None — install the server" empty state placeholder.

**14b. Logic:** Login buttons call `loginWithProvider(...)`. On success, set `isAuthenticated: true` in the connection store and navigate based on the auth gate's next target. Server list calls `fetchServers()` on mount, shows loading/error/empty/list, routes a single paired online server directly via `establishTunnel` and into `(main)`, routes an unpaired tap to `/(auth)/pair` with the `serverId` as a query param.

**14c. CHECKPOINT:** User signs in with a real provider against a staging broker, sees their server list, picks a server (or sees the empty state). Confirms routing and error copy before proceeding.

---

## Task 15: Pairing flow screen (scaffold + logic + CHECKPOINT)

**Type:** UI with checkpoint

**15a. Scaffold:** `pair.tsx` with a `Bip39VerificationCard` component — a prominent display of the 4-word code, an explanation block, and two buttons: "No, cancel" and "Yes, they match".

**15b. Logic:** On mount, read `serverId` from route params, call `generatePairingKeypair()`, `requestPairing(serverId, clientPk)`, then compute `verificationCode(clientPk, serverPk)` and render it. On confirm: `storePairingKeys(serverId, keys)` → `establishTunnel(serverId)` → persist `server_session` → `initPocketBase(...)` → route to `(main)`. On cancel: abort (no storage) and route back to `/(auth)/server-list`. Error states: broker failure shows retry; visibly different messaging from a mismatch (which is user-initiated cancel).

**15c. CHECKPOINT:** User runs the real pairing flow against a dev server, verifies the 4 words match between the server terminal and the phone, taps confirm, sees the Main tab render. Signs off on word layout, copy, error states.

---

## Task 16: Home tab — WebView shell (scaffold + logic + CHECKPOINT)

**Type:** UI with checkpoint

**16a. Scaffold:** `components/WebViewShell.tsx` per design doc §6.1 with `source={{ uri: '${serverUrl}/app/' }}`, `injectedJavaScriptBeforeContentLoaded={BRIDGE_INIT}`, loading spinner, `onRenderProcessGone`/`onContentProcessDidTerminate` auto-reload. Wire into `app/(main)/index.tsx`.

**16b. Logic:**
- `onMessage` handler dispatches on `bridge-ready` by `sendBridgeMessage({ type: 'session-token', token: sessionToken })` immediately followed by the resolved preferences payload.
- Subscribe to `usePreferencesStore` — on change, push a `preferences` bridge message into the WebView.
- Subscribe to `_deployments` via `subscribeToDeployments` (uses the `pb` service tag through the broker relay) — on create, `ref.current?.reload()` and `useVersionStore.getState().fetchVersions()`.
- Error handling matrix from §6.4: 401 triggers silent broker JWT refresh then reload; 5xx shows "app broken" screen with an "Open Version History" CTA; `onError` (tunnel down) shows the reconnect card.
- `ConnectionStatus` header badge reflects `useConnectionStore.connectionState`.

**16c. CHECKPOINT:** User connects to a live server, sees the agent-built welcome page render in the WebView. Trigger a dev deploy — WebView auto-reloads. Kill the app backend — "app broken" screen appears with working Versions CTA. User signs off on loading state, error screens, and reload behavior.

---

## Task 17: Request tab — Task Card (scaffold + logic + CHECKPOINT)

**Type:** UI with checkpoint

**17a. Scaffold:** `components/TaskCard.tsx`, `TaskInput.tsx`, `ClarifyingQuestion.tsx`, `ActivityLog.tsx`. Per design doc §7, the card renders one of six state branches: `null → TaskInput`, `input`, `clarifying`, `working/deploying`, `done`, `failed`. Wire into `app/(main)/request.tsx`. On mount, call `useTaskStore.getState().resumeActiveTask()` so close/reopen mid-clarification restores state.

**17b. Logic:** `TaskInput` collects a request string and calls `submitTask`. `ClarifyingQuestion` shows the agent's question, a text input, and a Send button that calls `answerQuestion(answer)`. `ActivityLog` renders the most recent 20 entries with `date-fns` relative timestamps. `working/deploying` shows a Cancel button. `done` shows the version description and a Dismiss button. `failed` shows the error and both Retry and Dismiss. The Request tab's badge (set by `(main)/_layout.tsx`) already shows `!` when `activeTask.state === 'clarifying'`.

**17c. CHECKPOINT:** User submits a real task end-to-end, answers a clarification question, sees it deploy, taps Dismiss. User force-closes the app mid-clarification and reopens — the pending question is restored. User signs off on copy, card transitions, activity log density, Cancel/Retry/Dismiss placement.

---

## Task 18: Versions tab with rollback (scaffold + logic + CHECKPOINT)

**Type:** UI with checkpoint

**18a. Scaffold:** `components/VersionRow.tsx` (collapsed summary; tap to expand), `RollbackConfirm.tsx` bottom sheet, and `app/(main)/versions.tsx` listing rows. Show loading, error, and empty states.

**18b. Logic:** Mount calls `fetchVersions()`. Row expand reveals the agent-written description and a "Rollback to this version" button (hidden for `isCurrent`). Tap opens `RollbackConfirm` with branched copy depending on `hasDbSnapshot` (§8). Confirm calls `rollbackTo(versionId)`; on success, sheet closes — the incoming `_deployments` SSE will cause the WebView to reload automatically. The Versions tab must remain functional when `/app/*` is broken (it only talks to `/api/versions`).

**18c. CHECKPOINT:** User reviews version history, expands a row, opens the rollback sheet (both snapshot and no-snapshot copy variants), performs a real rollback. Verifies that with the app backend killed, the tab still renders and rollback still works. Signs off on list density, expand animation, sheet copy.

---

## Task 19: Settings screen (scaffold + logic + CHECKPOINT)

**Type:** UI with checkpoint

**19a. Scaffold:** `app/(main)/settings.tsx` with the six sections from design doc §13 plus a Personalization section that contains: Theme, Font size, Font family, Language, Accent color, and a destructive **Reset preferences** row (§9b.4).

**19b. Logic:**
- Account: shows OAuth email; Sign out calls `connection.logout()` then routes to `/(auth)/login`.
- Agent behavior: radio for clarification mode, picker for timeout minutes, both call `settings.update(...)`.
- Connection: shows server name + online/offline badge; "Change server" routes to `server-list`; "Re-pair this device" routes back into the pairing flow with a flag to generate a new keypair and revoke the old server-side via broker.
- Keys & secrets: placeholder row that routes to a future LLM API key screen (stub for now).
- Advanced: `debugEncryptedTraffic` switch wired to `settings.update`; View logs displays `logBuffer.snapshot()`.
- Personalization: each control calls `usePreferencesStore.set(...)`; Reset shows a confirmation sheet then calls `usePreferencesStore.reset()` and navigates to `/onboarding/welcome`.

**19c. CHECKPOINT:** User tours every section, toggles each control, verifies the agent behavior mirror call hits the server, flips debug mode and sees plaintext in View logs, resets preferences and watches the onboarding flow re-run without losing the server session. Signs off on grouping, copy, and destructive-action confirmations.

---

## Task 20: Push notifications setup and deep-link handler

**Type:** Logic task (no checkpoint — verification is real-device manual)

Implement `lib/notifications.ts` per design doc §12.

- `registerForPushNotifications()` with iOS permission flow, Android high-importance channel, Expo push token retrieval, and `apiClient.post('/api/device/register', { pushToken, platform })`.
- `useNotificationDeepLinks()` hook registered in `app/_layout.tsx` that listens to `addNotificationResponseReceivedListener` and routes on `data.screen === 'task' | 'versions'`.
- Call `registerForPushNotifications()` once `connection.isConnected` flips true.
- No automated tests for the native permission flow; instead, add a `lib/__tests__/notifications-routing.test.ts` covering the pure routing function: given a notification data payload, assert the target route.

**Done when:** Pure routing tests pass; the hook is wired into the root layout; token registration fires on first successful connection.

---

## Task 21: End-to-end manual test pass

**Type:** Manual QA (no checkpoint — this IS the final checkpoint)

Execute the 14-row manual test plan from design doc §14 against a real iOS 15.1 device and an Android API 28 device, connected to a staging broker and a dev server. Log any failures as follow-up issues and fix blocking bugs before calling the plan complete.

**Done when:** All 14 scenarios pass on both platforms, or any failures have logged follow-ups with explicit user sign-off to defer.

---

## Out of scope for this plan

- WebRTC tunnel transport (Phase 2, bare workflow eject).
- EAS Build/Update configuration and store submission (separate release plan).
- LLM API key management screen (stubbed in Task 19, dedicated plan later).
- Biometric unlock (mentioned in manual test row 13 but not required for MVP — the SecureStore read on launch is enough).
- Key rotation (explicitly deferred per design doc §10).
