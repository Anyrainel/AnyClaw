# AnyRaven — Self-Evolving AI Companion App

## Overview

AnyRaven is a self-evolving mobile UI layer powered by a personal AI coding agent. Instead of a fixed interface, the agent designs, builds, and maintains a fully personalized full-stack web application that the user accesses through a companion mobile app. The user submits feature requests; the agent clarifies requirements, then designs, implements, tests, and deploys — all automatically.

**AnyRaven is agent-agnostic.** It does not own or bundle a coding agent. Instead, it provides infrastructure (server runtime, MCP tools, deployment pipeline) and a mobile viewer that works with any compatible coding agent. Initial adapters support **OpenClaw** and **Claude Code**, with the architecture extensible to Codex, Aider, or any agent that can use MCP tools.

**AnyRaven consists of:**

1. **Server infrastructure** — PocketBase + Node.js app backend + Vite/React frontend + dev/prod deployment pipeline. This is the foundation the agent builds on.
2. **An MCP server + skill suite** — gives any compatible coding agent the ability to deploy, rollback, snapshot data, and ask the user questions.
3. **An agent dispatch layer** — a pluggable adapter interface that lets the mobile app submit work requests to the user's chosen coding agent, including support for agent-initiated clarifying questions.
4. **A companion mobile app** — a thin native shell (WebView for agent-built UI, task submission with Q&A, version history/rollback, settings).

## Product Principles

These principles shape every product decision and inform the agent's skill prompts. They are not implementation details — they are how AnyRaven should *feel* to use.

### Voice & Tone

- **Direct and easy to understand.** Optimize for fast reading, not personality. Users want to know if something works and why it failed.
- **Non-technical by default.** Explain things assuming the user has never written code. Use plain words for technical concepts.
- **No humor, no whimsy.** Funny error messages waste the user's time. State the problem and the next step.
- **The agent is the customer support.** There is no human on the other end. Every error message, every status update, every clarification must be self-contained and actionable.

### The User Cannot See the Code

This is the central constraint that shapes everything else. The user only sees the mobile app and the WebView. They cannot inspect the agent's work, debug code, or verify implementation details. Therefore:

- **Empower the user to understand the app through the UI alone.** If a feature exists, the UI must make it discoverable and self-explanatory.
- **Errors must be explicit.** Never silently fall back to a default that hides failure. A feature that works the first time and fails the second time because of a hidden fallback is far worse than one that fails clearly both times.
- **Robustness via full test cycles.** The agent must validate everything before deploying. The user is not at the screen during builds — there's no manual smoke test.
- **Versions are the user's control surface.** Every change is a versioned, rollback-able event. The version description is the user's only window into what changed.

### Agent Behavior

- **Ask only fundamental questions.** Don't pepper the user with detail. Make reasonable defaults and surface them in the version description so the user can adjust later.
- **Learn from past interactions.** The agent should infer preferences from prior conversations and prior deployments rather than re-asking every time. (Implementation: agent reads past versions and clarification history before asking new questions.)
- **Always run the full test cycle.** Lint, typecheck, build, smoke tests — every time, before promoting to prod.
- **Domain modeling first.** Code should reflect the user's mental model. Name things after what they mean, not what they technically are.
- **Separate concerns, co-locate related logic.** Files that change together belong together. But never let a file grow so large that editing becomes painful (and token-expensive).
- **Comments are for agents, not humans.** Only write comments that capture context not in the code itself, or TODOs for temporary states. No "this function adds two numbers" noise.

### Design Language

A confident, calm aesthetic that gets out of the way of the user's data. Concrete properties:

- **Soft corners.** Medium radius (8px default for cards/buttons, 4px for inputs, 12px for sheets). Never sharp.
- **Generous whitespace.** Calm density. Breathing room between elements over packed efficiency.
- **Restrained color.** Mostly grayscale UI with one accent color (user-chosen during onboarding). The accent is for primary actions and key data points only — never for decoration.
- **Strong typographic hierarchy.** Clear scale (e.g., 12/14/16/20/28/40px) so structure is visible at a glance. Bold for emphasis, not color.
- **Subtle elevation.** Soft shadows over heavy borders. Layered surfaces, not boxed regions.
- **Warm neutrals.** Light mode background is a warm off-white (not pure `#fff`). Dark mode is a deep neutral (not pure black). High contrast for text, but never harsh.
- **System-aware.** Respects the user's system theme, font scale, and accessibility settings by default. User can override in settings.

The complete `@theme` block (specific oklch values, spacing scale, type scale) ships with the install and is documented in the style guide skill.

### User Preferences (Onboarding)

On first launch, the mobile app asks a small set of impactful questions. Nothing nuanced — only choices that change the everyday experience for non-technical users:

| Question | Options | Default |
|----------|---------|---------|
| Theme | System / Light / Dark | System |
| Font size | Small / Medium / Large | Pulled from system accessibility (`PixelRatio.getFontScale()` on RN; respects iOS Dynamic Type and Android font scale) |
| Font family | Sans / Serif | Sans |
| Language | Device locale, with override | Device locale |
| Accent color | 6 curated options (e.g., Blue, Teal, Green, Amber, Rose, Violet) | Blue |

Preferences are stored in PocketBase under `user_preferences` and exposed to the agent-built frontend via a global hook (`usePreferences()`). All agent-generated UI reads these and adapts. Changes in Settings take effect immediately, without re-deploying.

The agent **never** asks the user about visual preferences during a task. It reads from the preference store.

### Empty State as Canonical Example

When a user first connects, the WebView shows a default "Welcome to AnyRaven" page. This page serves two purposes:

1. **Onboards the user.** Explains how to use the Request button, what kinds of features the agent can build, and shows example prompts ("Try: 'Build me a daily mood tracker'").
2. **Is the canonical example for the agent.** The page is written using the exact patterns the style guide skill prescribes — file structure, component composition, data fetching, theme tokens, error handling, loading states. The agent reads it as the authoritative example of "how AnyRaven code should look."

When the user replaces it with their first real feature, the welcome page is preserved as `dev/_examples/welcome.tsx` so the agent can still reference it.

## Deployment Modes

**Hybrid: self-hosted or cloud-hosted. Both modes produce the same server layout.**

- **Self-hosted (plugin):** User already has a coding agent (OpenClaw, Claude Code, etc.). Installs AnyRaven MCP server + skills + infrastructure alongside it. Free. User provides their own LLM API keys.
- **Self-hosted (standalone):** A single install script sets up everything from scratch — a default agent (OpenClaw) + AnyRaven infrastructure. Free. User provides their own LLM API keys.
- **Cloud-hosted:** Monthly subscription. AnyRaven hosts the full stack (one container per subscriber) on Hetzner. LLM tokens bundled or BYOK.

## Connection Options

The mobile app can connect to the user's server through multiple paths:

1. **Broker relay (legacy):** A lightweight cloud service run by AnyRaven that authenticates users and brokers connections between the mobile app and the server. Content flows end-to-end encrypted — the broker only relays opaque bytes. **Note: Broker relay is being phased out.**
2. **Direct tunnel (recommended):** User provides their own tunnel URL (Cloudflare Tunnel, ngrok, or any WSS-capable reverse proxy). The mobile app connects directly to this endpoint. No broker involvement, no bandwidth limits, full user control.
3. **Local network:** When mobile and server are on the same network, direct HTTP/WebSocket connection without tunneling.

**Default:** Direct tunnel mode. The user provides a tunnel URL during setup or in settings.

## Architecture

### System Diagram

```
+---------------------+         +-----------------------+
|   Mobile App        |         |  User's Host          |
|   (Expo/RN)         | <-----> |  (one Docker          |
|                     |  WSS    |   container or        |
|  +---------------+  |  tunnel |   native install)     |
|  | Native Shell  |  |         |                       |
|  | - Task Card   |  |         |  ┌── supervisord ───┐ |
|  | - Versions    |  |         |  │                  │ |
|  | - Settings    |  |         |  │  Tunnel Manager  │ |
|  +---------------+  |         |  │  PocketBase      │ |
|  +---------------+  |         |  │  Dispatch/MCP    │ |
|  | WebView       |  |         |  │  Logic Service   │ |
|  | (agent-built  |  |         |  │  Prod Static     │ |
|  |  React app)   |  |         |  └──────────────────┘ |
|  +---------------+  |         |                       |
+---------------------+         |  Transient (per task) |
                                |  ┌─ cgroup limits ──┐ |
                                |  │                  │ |
                                |  │  Coding Agent    │ |
                                |  │  (Claude Code    │ |
                                |  │   or OpenClaw)   │ |
                                |  │        │         │ |
                                |  │        ▼  uses   │ |
                                |  │  AnyRaven MCP     │ |
                                |  │  (HTTP/SSE)      │ |
                                |  │        │         │ |
                                |  │        ▼         │ |
                                |  │  Vite Dev        │ |
                                |  │  (for testing)   │ |
                                |  └──────────────────┘ |
                                |                       |
                                |  Filesystem:          |
                                |  - dev/ (agent rw,    |
                                |    worktree per task) |
                                |  - prod/ (deployed)   |
                                |  - .anyclaw/ (infra,  |
                                |    agent read-only)   |
                                +-----------------------+
```

**Connection paths:**
1. **Direct tunnel (default):** Mobile app connects directly to a user-provided WSS URL (Cloudflare Tunnel, ngrok, etc.). The tunnel manager on the host accepts this connection.
2. **Broker relay (legacy):** Mobile app connects to `broker.anyraven.com`, which relays to the host. Still supported but not the default.
3. **Local network:** Direct HTTP connection when both devices are on the same network.

### Layer 1: Mobile App (Client)

**Stack: Expo (managed React Native) + react-native-webview.**

A thin native shell with four responsibilities:

1. **Connection management** — Login, server selection, reconnect/restart controls. Talks to the broker to establish a tunnel to the server.
2. **Task dispatch interface** — A "Request" tab that opens a focused task card (not a chat). The card transitions through input → clarifying → working → deploying → done/failed states.
3. **Version history & rollback** — Native screen listing agent-deployed versions with descriptions. User taps to rollback (code + DB restored atomically). Rollback is always user-initiated.
4. **Settings & monitoring** — Server status, agent adapter configuration, activity log, API key management, subscription.

The main content area is a single WebView pointing at the user's server. The WebView and native shell communicate via a JS bridge for events like "agent deployed a new version, please reload."

**Why Expo:** Handles builds, signing, OTA updates, and push notifications without touching Xcode or Android Studio. Ejecting to bare workflow is available if needed later.

### Layer 2: Server Runtime

The server runs on the user's host (Docker or native install) or in a cloud container. It consists of:

#### 2a. PocketBase (Data & API Layer)

**Single Go binary. Zero config.**

- SQLite database with auto-generated REST API
- Realtime subscriptions via SSE
- File storage (images, attachments)
- Auth tokens for WebView ↔ server communication

The agent interacts with PocketBase only through its admin API (collections, records). It never edits PocketBase source. PocketBase is a stable guardrail the agent cannot break.

#### 2b. Node.js Logic Service

**TypeScript. Handles everything PocketBase cannot.**

- Background jobs via node-cron
- Custom API endpoints (complex queries, LLM-powered features)
- HTTP client for web access
- LLM calls via the user's API keys
- Push notification dispatch to the mobile app

The agent writes and modifies code in this layer, using a well-defined project structure and a set of built-in primitives:

```typescript
scheduleJob(name: string, cron: string, handler: () => Promise<void>): void
fetchUrl(url: string, options?: FetchOptions): Promise<Response>
callLLM(prompt: string, options?: LLMOptions): Promise<string>
sendNotification(title: string, body: string): Promise<void>
getPocketBase(): PocketBase
```

#### 2c. Vite + React Frontend

**The agent-built UI that loads in the WebView.**

- React + TypeScript + Vite
- Talks to PocketBase directly for data (PocketBase JS SDK)
- Talks to the app backend for custom endpoints
- Tailwind v4 with a locked `@theme` token set (see Style Guide)
- Responsive (phone + tablet)

#### 2d. Dev/Prod Split

Two environments live on the server:

- **Dev:** The agent's workspace. All code changes happen here first. Each task runs in its own git worktree.
- **Prod:** What the user's WebView loads. Updated only when dev passes validation.

**Promotion flow:**

1. Agent writes code in a per-task worktree under `dev/.worktrees/task-<id>/`.
2. Agent runs the validation suite: `eslint` + `tsc --noEmit` + `vite build` + smoke tests.
3. On success: agent commits to the task branch, merges into `main`, snapshots the DB (if schema changed), copies build artifacts to `prod/`, restarts the app backend via the supervisor, and fires a WebSocket event to reload the WebView.
4. On failure: worktree is deleted without merging. The user never sees broken state.
5. User can cancel a long-running task from the mobile app.

### Layer 3: Connection Broker

**Lightweight cloud service run by AnyRaven. Hosted in US East (Hetzner, iad).**

- **Auth:** Google + Apple + GitHub OAuth. Broker issues short-lived JWTs (15 min) after OAuth validation and stores provider refresh tokens server-side. A `/auth/refresh` endpoint mints new access tokens. (Apple Sign In: the broker persists name/email from the first OAuth callback, since subsequent logins only provide the user ID.)
- **Registry:** Self-hosted servers send heartbeats; broker tracks which servers are online.
- **Signaling / relay:** Establishes tunnels between clients and servers.

**Tunnel strategy (phased):**

Embedded WireGuard and Tailscale tsnet are not viable in React Native/Expo managed workflow. The realistic options are:

- **Phase 1 (launch): HTTPS/WSS relay through the broker.** Mobile app ↔ broker ↔ server, all TLS-encrypted. Works in Expo managed workflow with zero native code. NaCl box encryption is layered on top of TLS so the broker cannot read traffic even if compromised. Simplest, ships first.
- **Phase 2 (post-launch): WebRTC data channels for true P2P.** `@config-plugins/react-native-webrtc` requires an Expo dev build but not full ejection. Broker becomes a signaling-only server; content flows directly between devices.
- **Phase 3 (optional): Cloudflare Tunnel fallback.** For networks where WebRTC hole-punching fails, server runs `cloudflared` as a last-resort path.

**Tunnel multiplexing:** Envelopes carry an in-band service tag: `{ type, client_id, service: "pb"|"api"|"app", payload }`. The tunnel manager routes to PocketBase (`pb`), dispatch/MCP server (`api`), or prod static server (`app`) — no subdomain gymnastics.

**Security requirements (all phases):**

- Server exposes zero open ports to the internet
- All traffic encrypted in transit (TLS + NaCl for Phase 1; DTLS/SRTP + NaCl for Phase 2)
- Fully automated connection setup (no manual port forwarding)
- UX: install app, log in, server appears, one tap to connect

**NaCl E2E encryption:**

- Library: `libsodium-wrappers` (WASM) on both mobile and server
- One long-lived keypair per (device, server) pair, generated at pairing
- Keys stored in platform secure storage (iOS Keychain / Android Keystore / libsecret / Windows Credential Manager)
- Pairing MITM protection: display a 4-word BIP39 verification code on both sides; user visually confirms
- No rotation for MVP — re-pair flow on device loss
- Encryption boundary: TLS-only for static assets (HTML/CSS/JS from prod static server); NaCl additionally for sensitive API payloads (PocketBase and dispatch API calls carrying user data)
- Debug mode: opt-in flag in mobile app settings logs decrypted traffic locally only (never on the broker)

## Process Architecture

AnyRaven uses **process supervision** for crash isolation. All services run as supervised processes on a single host (or inside a single cloud container). Each process has its own restart policy and crash domain.

```
Host (or single cloud container)
│
├── [supervised, restart=always] PocketBase
│       Data layer. Rock-solid Go binary.
│
├── [supervised, restart=always] Tunnel Manager
│       Persistent WSS connection to broker. Survives all other crashes
│       so the mobile app never loses contact.
│
├── [supervised, restart=always] Dispatch / MCP Server
│       Task dispatch API + MCP HTTP/SSE endpoint + emergency rollback +
│       app restart endpoint. Source NOT in agent's writable path.
│       Always available even when the app backend is broken.
│
├── [supervised, restart=on-failure] Logic Service
│       Agent-modifiable Node.js service. Custom API routes, background
│       jobs. If broken by bad agent code, the user can still rollback
│       via the dispatch API.
│
├── [supervised, restart=always] Prod Static Server
│       Serves the agent-built React app to the WebView.
│
├── [transient, no auto-restart] Agent Subprocess
│       Spawned per task by the dispatch server. Runs claude/openclaw
│       under cgroup scope. Crashes = task marked failed.
│
└── [transient, no auto-restart] Vite Dev Server
        Spawned by the agent for testing during a build. Lives only as
        long as the build/test cycle. Isolated to the task worktree.
```

**Supervisor:** `systemd --user` is the primary choice (works on any distro with cgroup v2 delegation — Ubuntu 22.04+, Debian 12+, Fedora). `supervisord` is the fallback inside minimal containers that lack systemd. Linux-first for MVP; Windows/macOS self-hosters use WSL2 or a Linux VM.

**User accounts:** An install script run as root once during setup creates `anyclaw-infra` (runs supervised services) and `anyclaw-agent` (runs agent subprocesses) users and sets directory ownership. After install, no service runs as root.

**Resource limits:** A `ResourceLimits` interface is defined but is a no-op for MVP. Real cgroup/JobObject limits will be applied once abuse patterns emerge from production data.

### The Dispatch Server is the Control Plane

The dispatch server is the small, stable process that handles everything the user must be able to do **even when their app is broken**:

- `POST /tasks` — submit task
- `POST /tasks/:id/answer` — answer a clarification question
- `POST /tasks/:id/cancel` — cancel a running task
- `POST /rollback` — emergency rollback (always works)
- `POST /restart-app` — restart app backend (always works)
- `GET /versions` — version history
- `GET /health` — health check
- `POST /mcp` — MCP HTTP/SSE endpoint for the agent
- PocketBase Realtime SSE proxy for clarification questions and progress updates

Its source files are not in the agent's writable path. The agent cannot modify it.

### Crash Isolation Matrix

| What crashes | What survives | User experience |
|--------------|---------------|-----------------|
| Agent subprocess | Everything else | Task marked failed; user retries from app |
| Logic service (agent code) | PocketBase, tunnel, dispatch, prod static | WebView shows API errors; user rolls back via version history |
| Vite dev server | Everything else | Current build fails; deploy doesn't happen |
| PocketBase | Tunnel, dispatch | ~2s restart; WebView and dispatch retry automatically |
| Tunnel manager | Everything else | App shows reconnecting; comes back when tunnel restarts |
| Dispatch/MCP server | PocketBase, tunnel, logic | Task submission briefly unavailable; restarts in seconds |
| Whole host | Nothing | App shows reconnecting until the host comes back |

### Why Not Containers

A container-per-role split (app server / control plane / sandbox) would give the same crash isolation with substantially more complexity. Coding agents already run commands natively — that's what they do. We only need cgroup limits on the agent process, not a separate container. Process supervisors (systemd/supervisord) are battle-tested for exactly this, and the container remains the multi-tenancy boundary. Replit, Codex sandboxes, and Devin use the same model.

## Task Dispatch Protocol

AnyRaven communicates with agents through a pluggable **Agent Adapter** interface. The interaction model is **task dispatch with clarification**, not real-time chat.

### Task Lifecycle

```
[input] → [clarifying] → [working] → [deploying] → [done]
                ↑    ↓
              (Q&A rounds — agent asks, user answers)
```

1. **Input** — User types a request ("add a mood tracker for stress, sleep, and energy").
2. **Clarifying** — Agent may ask questions via the `anyclaw_ask_user` tool. User answers in the app. Multiple rounds possible. Agent may skip if the request is clear.
3. **Working** — Agent designs, implements, and tests the feature in the task's worktree. App shows progress updates. User can cancel.
4. **Deploying** — Agent runs the validation suite, commits, snapshots the DB if needed, promotes to prod.
5. **Done** — WebView reloads. Task card shows the version description.

If a task fails, the card shows the failure reason. No changes reach prod.

### Delivery Guarantees

- **Exactly-once task delivery.** Client generates a task UUID. Dispatch server does an idempotent upsert into the PocketBase `_tasks` collection.
- **Crash recovery.** On dispatch server restart, any task in `working` state without a running subprocess is atomically moved to `failed` with reason `"server_restart"`. The user can retry with a new UUID.
- **Task checkpoints.** Hybrid schema: agent-agnostic step tracking (`lastCompletedStep`, `filesModified`) for the UI plus an optional agent-specific blob for internal resume state.
- **Clarification resume.** On restart, a resumed agent first checks `_agent_messages` for pending questions. If one is unanswered, the adapter waits for the answer (respecting the user's timeout mode) before re-dispatching. No duplicate questions.
- **Stall detection.** Hard timeout only (default 30 min). No heartbeats. Exceeding the timeout force-cancels and marks the task failed.
- **Concurrency.** Single active task + queue for MVP. Each task runs in its own git worktree (`dev/.worktrees/task-<id>/`), so removing the serialization later is the only step needed to parallelize. A merge agent for worktree conflicts is deferred to when parallelism ships.
- **Clarification timeout:** User-configurable. Default: "agent proceeds with best judgment" after 5 minutes. Alternative: "pause indefinitely."

### Agent Adapter Interface

```typescript
interface AgentAdapter {
  dispatch(request: string): Promise<TaskHandle>;
  getStatus(handle: TaskHandle): Promise<TaskStatus>;
  answerQuestion(handle: TaskHandle, answer: string): Promise<void>;
  cancel(handle: TaskHandle): Promise<void>;
  getActivityLog?(handle: TaskHandle): Promise<ActivityEntry[]>;
}

interface TaskStatus {
  state: "clarifying" | "working" | "deploying" | "done" | "failed" | "cancelled";
  question?: string;
  versionDescription?: string;
  error?: string;
  progressSummary?: string;
}
```

### Adapters

**OpenClaw:** Dispatches via the gateway's WebSocket or OpenAI-compatible REST endpoint. Multi-turn clarification uses the gateway's conversation support. Progress and activity log come from gateway event streams. Cancel via gateway API. OpenClaw users can also continue dispatching work through WhatsApp/Discord — the mobile app's task dispatch is an additional channel, not a replacement.

**Claude Code:** Dispatches by spawning `claude -p` as a subprocess with the user's request as the prompt and the AnyRaven MCP server pre-configured. Clarification uses the `anyclaw_ask_user` MCP tool, which writes the question to PocketBase and polls for the answer. Progress via `anyclaw_update_progress` plus `--output-format stream-json`. Cancel by killing the subprocess. A future upgrade to `@anthropic-ai/claude-agent-sdk` is possible for richer lifecycle control.

**Generic webhook:** For future agents (Codex, Aider, custom harnesses). Dispatches a POST to a user-configured webhook with `{ request, taskId, callbackUrl }`. The agent POSTs questions, progress, and completion back to the callback URL.

### MCP Loopback Auth

The agent subprocess authenticates to the MCP server with a per-task bearer token written to a file only the agent's user can read, injected via `ANYCLAW_MCP_TOKEN` env var.

### MCP Tools

The MCP server is deliberately minimal. Agents use their own built-in tools (file I/O, shell, git) for everything they already do well. AnyRaven MCP tools only guard failure-prone operations:

- `anyclaw_deploy` — Run validation suite, commit, merge worktree, snapshot DB if needed, promote to prod, restart app backend via supervisor
- `anyclaw_rollback` — Revert to a specific version (code + DB atomically)
- `anyclaw_snapshot_db` — Create a DB backup (called automatically before migrations)
- `anyclaw_list_versions` — Show deployment history
- `anyclaw_create_collection` — Define a PocketBase collection via admin API
- `anyclaw_ask_user` — Post a clarifying question and wait for the answer
- `anyclaw_update_progress` — Post a progress update to the task card

Enforced constraints:

- All code changes happen in the task's worktree only
- PocketBase is accessed only through its admin API
- Validation must pass before promotion
- DB snapshot mandatory before schema migration
- A user-facing version description is required for every deployment

### Skill Suite

Agent-specific prompts/skills that teach the agent *how* to use the MCP tools and conventions. Same content across agents, different format:

- **OpenClaw:** OpenClaw skills directory
- **Claude Code:** CLAUDE.md + custom slash commands
- **Other agents:** System prompt templates

Skills:

- **anyclaw-build-feature** — Workflow: clarify → plan → implement → test → deploy. Post progress throughout.
- **anyclaw-style-guide** — React + Tailwind v4 conventions; locked `@theme` tokens; responsive layout rules.
- **anyclaw-refactor** — Periodic cleanup: extract shared components, remove dead code.
- **anyclaw-describe-version** — Write a clear, non-technical version description.

**Skill versioning:** Skills declare a minimum server version. Server rejects incompatible skills. Skills iterate independently of the server.

### Agent Compatibility

| Agent | MCP Tools | Skills Format | Dispatch Adapter | Clarification Support |
|-------|-----------|---------------|------------------|----------------------|
| OpenClaw | Native MCP | OpenClaw skills directory | Gateway WS/REST | Full (multi-turn via gateway) |
| Claude Code | Native MCP | CLAUDE.md + slash commands | `claude -p` subprocess | Via `anyclaw_ask_user` |
| Codex / future | Via MCP or tool-use API | System prompt template | Generic webhook | Via `anyclaw_ask_user` |

## Versioning & Rollback

- **Code:** Git commit with a tag and a human-readable description written by the agent.
- **Database:** SQLite snapshot (compressed) taken before each deployment that includes a schema migration.
- **Rollback** is user-initiated from the native version history screen. It restores code (git checkout) and DB snapshot (file swap) atomically, avoiding schema/data mismatches.

**Snapshot storage:** gzip/zstd compressed. Retention: last N snapshots (configurable, default 20) plus any the user has bookmarked. Incremental snapshots (SQLite `.backup` + binary diff) are an optimization for later if storage becomes an issue.

## Failure Modes & Recovery

| # | Failure | Detection | Recovery |
|---|---------|-----------|----------|
| 1 | Agent writes code that doesn't compile/run | Validation gate in dev (lint, typecheck, build, smoke tests) | Worktree deleted, no merge, prod untouched |
| 2 | Agent creates ugly or broken-looking UI | Hard to auto-detect | User rolls back from version history; style guide and `@theme` tokens reduce likelihood |
| 3 | Agent corrupts database | Smoke tests + PocketBase schema validation | Automatic DB snapshot before every migration; rollback restores code + DB together |
| 4 | Agent enters fix loop | Hard timeout (30 min default); user monitors via activity log | Force-cancel on timeout; user can cancel manually; work never promotes to prod |
| 5 | Regression in existing feature | Smoke tests (each feature registers a health check endpoint) | Failed smoke tests block promotion; user rollback otherwise; separate routes/collections limit blast radius |

## App Store Strategy

**Apple App Store:** The app has genuine native functionality (task dispatch, version management, connection controls, settings) — it is not a WebView wrapper. JS in WKWebView is explicitly allowed. Frame as "personal AI dashboard." Precedent: Notion, Salesforce, ServiceNow. If rejected, TestFlight/enterprise cert while appealing.

**Google Play:** WebView-based apps are first-class (TWA pattern). Low risk.

## Technical Decisions (Locked)

All decisions below are binding for implementation.

### Architecture & Process Model

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Process model | Process supervision, not container split. Supervised: PocketBase, tunnel manager, dispatch/MCP server, app backend, prod static server. Transient: agent subprocess, Vite dev server. Dispatch/MCP source NOT in agent's writable path. | Same crash isolation as multi-container, dramatically simpler. Same model as Replit, Codex, Devin. |
| Supervisor choice | `systemd --user` primary; `supervisord` fallback for minimal containers | Works without root on any modern distro with cgroup v2 delegation |
| Platform | Linux-first for MVP; WSL2/VM for Windows/macOS self-hosters | Cross-platform cgroup abstraction not worth MVP complexity |
| Resource limits | `ResourceLimits` interface exists as a no-op for MVP | Premature optimization; lock down once real abuse emerges |
| Filesystem bootstrapping | Install script runs as root once; creates `anyclaw-infra` and `anyclaw-agent` users; services run non-root after install | Standard Linux pattern |
| Restart prod app backend after deploy | `systemctl --user restart anyclaw-logic` (or supervisord equivalent), invoked by dispatch server | Standard supervisor mechanism |

### Agent Integration

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent execution | Transient subprocess using its own built-in tools for files/shell | Agents already know how to run commands — don't duplicate |
| MCP tools philosophy | No scaffolding. MCP only for deploy, rollback, snapshot, ask_user, update_progress, create_collection | Robustness over convenience; guard failure-prone operations |
| MCP transport | HTTP/SSE from day one | Cloud-ready from the start |
| MCP loopback auth | Per-task bearer token in a file only the agent user can read, injected via `ANYCLAW_MCP_TOKEN` | Cross-platform, simple, sufficient for loopback |
| Claude Code adapter | `claude -p` CLI mode for MVP; upgrade to TS SDK later if needed | Less code; clarification via MCP tool works fine |
| `run_dev` commands | Blocklist for MVP, log all commands, tighten to allowlist later | Ship fast, observe real behavior, lock down |
| Concurrent tasks | Single active task + queue; worktree-per-task from day one | Simplest for MVP without painting into a corner |
| Task persistence across restart | Persist task state; resume after restart | Users expect reliability |
| Task checkpoint schema | Agent-agnostic step tracking + optional agent-specific blob | UI generic, agent precise |
| Task delivery guarantee | Exactly-once. Client-generated UUID + idempotent upsert. Orphaned `working` tasks marked `failed` on restart | User instructions must never be lost or duplicated |
| Queue stall detection | Hard timeout only (default 30 min) | Heartbeat complexity unjustified |
| Skill versioning | Independent with minimum-server-version declaration | Faster iteration on prompts |
| Clarification timeout | User-configurable: proceed after 5 min (default) or pause indefinitely | Different users, different tolerance |
| Worktree strategy | `dev/.worktrees/task-<id>/`. Merge to `main` on success, delete on failure | Isolation from day one; parallelization just removes the queue |
| Merge conflicts (future parallelism) | Dedicated merge agent. Deferred | Not needed for sequential MVP |
| ask_user resume | Resumed agent checks `_agent_messages` for pending questions first | No duplicates |
| OpenClaw gateway failure handling | Deferred to post-MVP | Different failure modes need different handling |

### Mobile App

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Task dispatch UI | Dedicated "Request" tab + full-screen modal/bottom sheet | Clear, discoverable, no WebView z-index conflicts |
| Min Android API | API 28 (Android 9.0) | Better WebView, dark mode, biometric API; drops ~5% of devices |
| Offline behavior | Cache-nothing for MVP; server down = reconnect screen | No offline requirement |
| WebView auth token | JS bridge injection after page load | Most secure — never in URL or logs |
| Realtime communication | PocketBase Realtime SSE (server→client) + REST (client→server). Task state persists in PocketBase and survives app close/reopen | Leverages existing infra, built-in persistence |

### Frontend & Style Guide

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CSS framework | Tailwind v4 | Newer CSS-first config; conventions enforced via style guide skill |
| `@theme` tokens | Style guide ships a complete default `@theme` block (colors, spacing, typography, shadows) in `app.css`. Agent uses existing tokens; cannot add new tokens without user approval via `anyclaw_ask_user` | Consistency with user-approved extension path |
| Dark mode | `@media (prefers-color-scheme: dark)` overrides in the default `@theme` block | Automatic, no toggle initially |

### Connection & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Domain | `anyraven.com` (purchased); mobile app uses `broker.anyraven.com` | Owned |
| OAuth providers | Google + Apple + GitHub at launch | Apple required by App Store; GitHub for developer early adopters |
| OAuth strategy | Broker-issued short-lived JWTs (15 min) after OAuth validation; broker holds provider refresh tokens; `/auth/refresh` endpoint | Standard pattern (Supabase, Firebase, Clerk) |
| Apple Sign In quirk | Broker persists name/email from first OAuth callback | Apple documented behavior |
| Phase 1 E2E encryption | NaCl box encryption layered on TLS. Broker cannot read relayed traffic | Privacy-maximalist audience expects this |
| NaCl library | `libsodium-wrappers` (WASM) on mobile and server | Industry standard; works everywhere including RN |
| NaCl key lifecycle | Long-lived keypair per (device, server) pair, generated at pairing, stored in platform secure storage. No rotation for MVP; re-pair on device loss | Threat model is machine compromise, not conversation privacy |
| Pairing MITM protection | 4-word BIP39 verification code displayed on both sides | Industry standard (Signal, WhatsApp, Threema) |
| Encryption boundary | TLS-only for static assets; NaCl additionally for sensitive API payloads (PocketBase + dispatch) | Clean separation, minimal WebView complexity |
| Debug mode | Opt-in flag in mobile settings; decrypted traffic logged locally only, never on broker | Troubleshooting without compromising default privacy |
| WebRTC Phase 2 timing | Launch with WSS relay only; begin Phase 2 dev after launch | Ship faster |
| Broker region | US East (iad); add regions as distribution justifies | Best peering, largest user base |
| Tunnel multiplexing | In-envelope service tag (`pb`/`api`/`app`) routed by tunnel manager | No DNS/subdomain complexity |
| VPS provider | Hetzner (US East + EU) | Proven, Docker-ready, generous bandwidth, low cost |

### Server, Data & Secrets

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PocketBase credentials | PocketBase API tokens, not email/password | More secure for programmatic access |
| PocketBase token provisioning | Install script runs `pocketbase superuser create` non-interactively, calls admin API to mint a long-lived token, stores at `/data/.anyclaw/pb-token`. Superuser account remains for emergency access | Non-interactive, repeatable |
| API key storage | Encrypted in PocketBase for both self-hosted and cloud. Settings UI manages keys in both modes | Consistent experience across modes |
| Master encryption key | Generated at install time, stored at `/data/.anyclaw/master.key` mode `0600`, owned by `anyclaw-infra`. Cloud: derived from per-user provisioning secret | Simple, standard |
| Encrypted secrets algorithm | AES-256-GCM, implemented in the dispatch server | Industry-standard authenticated encryption |
| Cloud hosting | Single Hetzner VPS with Docker Compose (one container per user with supervisord inside). Migrate to E2B microVMs or Kubernetes Agent Sandbox later | Start simple, same layout as self-hosted |

## Tech Stack Summary

| Component | Technology |
|-----------|-----------|
| Mobile app shell | Expo (React Native) + Expo Router |
| WebView | react-native-webview |
| Data & API | PocketBase (SQLite, REST, Realtime, auth, files) |
| Server logic | Node.js + TypeScript |
| Frontend UI | Vite + React + TypeScript + Tailwind v4 |
| Background jobs | node-cron |
| Versioning | Git (per-task worktrees merged to `main`) |
| Agent integration | MCP server (HTTP/SSE) + agent-specific skills |
| Agent dispatch | Pluggable adapters (OpenClaw gateway, Claude Code `-p`, generic webhook) |
| Process supervision | systemd --user (primary), supervisord (fallback) |
| Containerization | Docker / docker-compose (one container per user) |
| Tunnel (phased) | WSS relay → WebRTC P2P → ~~Cloudflare fallback~~ → **User-provided tunnel (Cloudflare/ngrok/etc.)** |
| E2E encryption | NaCl (libsodium-wrappers) on top of TLS |
| Secret encryption | AES-256-GCM in dispatch server |
| Broker | Node.js or Go API server, Hetzner (US East) | **Deprecated** — broker relay being phased out in favor of user-provided tunnels |

## Pricing

**Self-hosted is free, indefinitely.** Cloud-hosted pricing is deferred until we have real cost data from running the infrastructure. The broker (auth + signaling) is free for both tiers.

## Monetization

| Tier | What's included | Cost |
|------|----------------|------|
| Free (self-hosted) | Mobile app + connection broker + AnyRaven server. User provides hardware + LLM API keys. | Free |
| Cloud-hosted | Everything above, hosted by AnyRaven (one container per user on Hetzner). LLM tokens bundled or BYOK. | Monthly subscription |

## Out of Scope (for now)

- Offline / degraded connectivity support (server down = reconnect screen)
- Multi-user / sharing features (single user per instance)
- Custom domain support for self-hosters
- Native home screen widgets
- End-to-end encryption of data at rest on cloud-hosted instances (trust model TBD)
- Parallel task execution (worktree layout already supports it; queue serialization is the only blocker)
- Cross-platform native cgroup/JobObject resource limits
