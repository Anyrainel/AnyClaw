# AnyClaw — Self-Evolving AI Companion App

## Overview

AnyClaw is a self-evolving mobile UI layer powered by a personal AI coding agent. Instead of a fixed interface, the agent designs, builds, and maintains a fully personalized full-stack web application that the user accesses through a companion mobile app. The user submits feature requests; the agent clarifies requirements, then designs, implements, tests, and deploys — all automatically.

**AnyClaw is agent-agnostic.** It does not own or bundle a coding agent. Instead, it provides infrastructure (server runtime, MCP tools, deployment pipeline) and a mobile viewer that works with any compatible coding agent. Initial adapters support **OpenClaw** and **Claude Code**, with the architecture extensible to Codex, Aider, or any agent that can use MCP tools.

**AnyClaw consists of:**
1. **Server infrastructure** — PocketBase + Node.js logic service + Vite/React frontend + dev/prod deployment pipeline. This is the foundation the agent builds on.
2. **An MCP server + skill suite** — gives any compatible coding agent the ability to create UI, API routes, DB collections, deploy, and rollback.
3. **An agent dispatch layer** — a pluggable adapter interface that lets the mobile app submit work requests to the user's chosen coding agent (OpenClaw, Claude Code, etc.), including support for agent-initiated clarifying questions.
4. **A companion mobile app** — a thin native shell (WebView for agent-built UI, task submission with Q&A, version history/rollback, settings).

**Deployment modes:**

1. **Plugin mode (for existing agent users):** User already has OpenClaw, Claude Code, or another agent. AnyClaw installs the MCP server + skills into the existing agent, spins up the server infrastructure alongside it, and the mobile app connects via the appropriate adapter.
2. **Standalone mode (for new users):** A single installation script sets up everything — the AnyClaw infrastructure + a default agent (likely OpenClaw). One command, fully self-contained.

Both modes produce the same server infrastructure. The difference is whether the coding agent already exists or is bundled.

## Deployment Model

**Hybrid: self-hosted or cloud-hosted.**

- **Self-hosted (plugin):** User has an existing coding agent (OpenClaw, Claude Code, etc.). Installs AnyClaw MCP server + skills + infrastructure alongside it. Free tier. User provides their own LLM API keys.
- **Self-hosted (standalone):** User runs a single install script that sets up everything from scratch — a default agent (OpenClaw) + AnyClaw infrastructure. Free tier. User provides their own LLM API keys.
- **Cloud-hosted:** Monthly subscription. AnyClaw hosts the full stack (one container per subscriber). LLM tokens bundled or BYOK.
- **Connection broker:** A lightweight cloud service (run by AnyClaw) that authenticates users and brokers connections between the mobile app and the server. Handles NAT traversal for self-hosters. Content flows directly between client and server — the broker only handles signaling.

## Architecture

### System Diagram

```
+---------------------+         +-------------------+         +----------------------+
|   Mobile App        |         |  Connection       |         |  User's Host         |
|   (Expo/RN)         | <-----> |  Broker           | <-----> |  (one Docker container
|                     |  auth   |  (Cloud)          |  signal |   or native install) |
|  +---------------+  |         +-------------------+         |                      |
|  | Native Shell  |  |                                       |  ┌── supervisord ──┐ |
|  | - Task Card   |  |       NaCl-encrypted relay (E2E)      |  │                 │ |
|  | - Versions    |  | <----------------------------------> |  │  Tunnel Manager │ |
|  | - Settings    |  |                                       |  │  PocketBase     │ |
|  +---------------+  |                                       |  │  Dispatch/MCP   │ |
|  +---------------+  |                                       |  │  Logic Service  │ |
|  | WebView       |  |                                       |  │  Prod Static    │ |
|  | (agent-built  |  |                                       |  └─────────────────┘ |
|  |  React app)   |  |                                       |                      |
|  +---------------+  |                                       |  Transient (per task)|
+---------------------+                                       |  ┌─ cgroup limits ─┐ |
                                                              |  │                 │ |
                                                              |  │  Coding Agent   │ |
                                                              |  │  (Claude Code   │ |
                                                              |  │   or OpenClaw)  │ |
                                                              |  │       │         │ |
                                                              |  │       │ uses    │ |
                                                              |  │       ▼         │ |
                                                              |  │  AnyClaw MCP    │ |
                                                              |  │  (HTTP/SSE)     │ |
                                                              |  │       │         │ |
                                                              |  │       ▼         │ |
                                                              |  │  Vite Dev       │ |
                                                              |  │  (for testing)  │ |
                                                              |  └─────────────────┘ |
                                                              |                      |
                                                              |  Filesystem:         |
                                                              |  - dev/ (agent rw)   |
                                                              |  - prod/ (deployed)  |
                                                              |  - .anyclaw/ (infra, |
                                                              |    agent read-only)  |
                                                              +----------------------+
```

### Layer 1: Mobile App (Client)

**Stack: Expo (managed React Native) + react-native-webview**

A thin native shell with four responsibilities:

1. **Connection management** — Login screen, server selection, reconnect/restart controls. Communicates with the broker to establish a tunnel to the server.
2. **Task dispatch interface** — A "Request" button that opens a task submission flow. Not a full chat — a focused task card that transitions through states (see Task Dispatch Protocol below).
3. **Version history & rollback** — Native screen listing agent-deployed versions with descriptions and optional screenshots. User taps to rollback. Rollback is always user-initiated.
4. **Settings & monitoring** — Server status, agent adapter configuration, agent activity log, subscription management.

The main content area is a single WebView pointing at the user's server. The WebView and native shell communicate via a JS bridge (postMessage/onMessage) for events like "agent deployed a new version, please reload."

**Why Expo:** Handles builds, signing, OTA updates, and push notifications without touching Xcode or Android Studio. The native shell is simple enough that Expo's managed workflow covers it. Ejecting to bare workflow is available if needed later.

### Layer 2: Server Runtime

The server runs on the user's machine (Docker) or in a cloud container. It consists of four components:

#### 2a. PocketBase (Data & API Layer)

**Single Go binary. Zero config.**

Provides:
- SQLite database with auto-generated REST API
- Realtime subscriptions via SSE
- File storage (images, attachments)
- Auth tokens (for the WebView <-> server communication)

The agent interacts with PocketBase through its admin API to create/modify collections (tables). The agent does NOT edit PocketBase source code. PocketBase is a stable, running service — a guardrail the agent cannot break.

#### 2b. Node.js Logic Service

**TypeScript. Handles everything PocketBase cannot.**

- Background jobs via node-cron (news scouting, scheduled reports)
- Custom API endpoints (complex queries, LLM-powered features)
- HTTP client for web access
- LLM interface (calls to OpenAI, Anthropic, etc. via user's API keys)
- Push notification dispatch to the mobile app

The agent writes and modifies code in this layer. It has a well-defined project structure and a set of primitives:

```typescript
// Built-in primitives the agent can use
scheduleJob(name: string, cron: string, handler: () => Promise<void>): void
fetchUrl(url: string, options?: FetchOptions): Promise<Response>
callLLM(prompt: string, options?: LLMOptions): Promise<string>
sendNotification(title: string, body: string): Promise<void>
getPocketBase(): PocketBase  // typed client for PocketBase API
```

#### 2c. Vite + React (Frontend)

**The agent-built UI that loads in the WebView.**

- React + TypeScript + Vite for fast builds
- Talks to PocketBase directly for data (using the PocketBase JS SDK)
- Talks to the Node logic service for custom endpoints
- Responsive design (phone + tablet)
- The agent creates pages, components, and routes here

#### 2d. Dev/Prod Split

**Two environments run on the server:**

- **Dev:** The agent's workspace. Code changes happen here first. The agent runs validation (lint, type check, build, smoke tests) in dev before promoting.
- **Prod:** What the user's WebView loads. Updated only when dev passes validation.

**Promotion flow:**
1. Agent writes code in dev
2. Agent runs validation suite: `eslint` + `tsc --noEmit` + `vite build` + smoke tests
3. If all pass: agent commits to git with a version description, copies build artifacts to prod, triggers a WebSocket event to reload the WebView
4. If validation fails: agent can iterate in dev. The user never sees broken state.
5. User can cancel a long-running agent task from chat if it's burning too many tokens.

### Layer 3: Connection Broker

**Lightweight cloud service run by AnyClaw.**

Responsibilities:
- User authentication (email/password, OAuth)
- Server instance registry (self-hosted servers send heartbeats)
- NAT traversal / tunnel establishment

**Tunnel strategy (phased):**

Research confirmed that embedded WireGuard and Tailscale tsnet are not viable in React Native/Expo — the libraries are immature and require full native ejection. The realistic options are:

**Phase 1 (MVP): HTTPS/WSS relay through the broker**
- The broker acts as a thin encrypted relay — mobile app connects to broker via WSS, broker forwards to server via WSS. All traffic TLS-encrypted.
- Works in Expo managed workflow with zero native code.
- Tradeoff: traffic passes through the broker (not true P2P). Mitigated by TLS encryption — the broker relays encrypted bytes without inspecting content.
- Simplest to build, fastest to ship.

**Phase 2 (upgrade): WebRTC data channels for true P2P**
- `react-native-webrtc` has an official Expo config plugin (`@config-plugins/react-native-webrtc`). Requires `expo prebuild` (development build, not Expo Go) but does not require full ejection.
- WebRTC provides NAT traversal (ICE/STUN/TURN) built in, encrypted P2P data channels.
- The broker becomes a signaling server only (exchanges SDP offers/answers). Content flows directly between devices.
- This is the Parsec-like model: broker helps devices find each other, then gets out of the way.

**Phase 3 (optional): Cloudflare Tunnel as fallback**
- For networks where WebRTC hole-punching fails (strict symmetric NAT), server runs `cloudflared` as a fallback path.
- Client connects via standard HTTPS through Cloudflare's network.
- Privacy tradeoff: traffic routes through Cloudflare. Acceptable as a last-resort fallback.

**Security requirements (all phases):**
- The server exposes zero open ports to the internet
- All traffic is encrypted in transit (TLS for Phase 1, DTLS/SRTP for Phase 2)
- The connection setup is fully automated (no manual port forwarding, no DNS config)
- User experience: install app, log in, server appears, one tap to connect

### Task Dispatch Protocol (Mobile App ↔ Agent)

AnyClaw does not own the coding agent. Instead, the mobile app communicates with agents through a pluggable **Agent Adapter** interface. The interaction model is **task dispatch with clarification**, not real-time chat.

#### Task Lifecycle

A task moves through these states:

```
[input] → [clarifying] → [working] → [deploying] → [done]
                ↑    ↓
              (Q&A rounds — agent asks, user answers)
```

1. **Input** — User types a request: "add a mood tracker for stress, sleep, and energy"
2. **Clarifying** — Agent may ask questions: "Daily check-in or multiple times per day? Do you want trend charts?" User answers in the mobile app. Multiple Q&A rounds are possible. Agent may also skip this step if the request is clear enough.
3. **Working** — Agent designs, implements, and tests the feature in the dev environment. Mobile app shows progress updates and an activity log (if the adapter supports it). User can cancel.
4. **Deploying** — Agent runs validation suite, commits, snapshots DB, promotes to prod.
5. **Done** — WebView reloads. User sees the new feature. Task card shows the version description.

If the task fails at any step, the card shows an error state with the failure reason. No changes reach prod.

#### Agent Adapter Interface

```typescript
interface AgentAdapter {
  /** Submit a new task request. Returns a handle to track progress. */
  dispatch(request: string): Promise<TaskHandle>;

  /** Get current task status and any pending clarification questions. */
  getStatus(handle: TaskHandle): Promise<TaskStatus>;

  /** Respond to a clarifying question from the agent. */
  answerQuestion(handle: TaskHandle, answer: string): Promise<void>;

  /** Cancel a running task. */
  cancel(handle: TaskHandle): Promise<void>;

  /** Get the activity log (what the agent is doing). Optional — not all adapters support this. */
  getActivityLog?(handle: TaskHandle): Promise<ActivityEntry[]>;
}

interface TaskStatus {
  state: "clarifying" | "working" | "deploying" | "done" | "failed" | "cancelled";
  /** If state is "clarifying", this is the agent's question to the user. */
  question?: string;
  /** If state is "done", this is the version description. */
  versionDescription?: string;
  /** If state is "failed", this is the error message. */
  error?: string;
  /** Progress summary (e.g., "Creating React components...") */
  progressSummary?: string;
}

interface ActivityEntry {
  timestamp: string;
  message: string;
  type: "info" | "warning" | "error";
}
```

#### Adapter: OpenClaw

- **Dispatch:** POST to OpenClaw gateway's WebSocket or OpenAI-compatible REST endpoint. The request is sent as a user message. The system prompt instructs the agent to use AnyClaw MCP tools and follow the build-feature skill.
- **Clarification:** OpenClaw's gateway supports multi-turn conversation. When the agent responds with a question (detected by message format or a structured tag), the adapter surfaces it to the user. When the user answers, the adapter sends the follow-up message.
- **Progress:** Subscribe to gateway WebSocket events for real-time status updates. The MCP tools emit progress events during validation and deployment.
- **Cancel:** Send a cancel signal via the gateway API.
- **Activity log:** Available via gateway event stream.

**For OpenClaw users who prefer WhatsApp/Discord:** They can continue to dispatch work through those channels. The mobile app will still show the results (WebView refreshes on deploy, version history updates). The task dispatch in the mobile app is an additional channel, not a replacement.

#### Adapter: Claude Code

- **Dispatch:** Spawn `claude -p` as a subprocess with the user's request as the prompt. MCP server is pre-configured so the agent has access to all AnyClaw tools. Permission mode `--allowedTools` scoped to AnyClaw MCP tools.
- **Clarification:** Via the `anyclaw_ask_user` MCP tool. The agent calls the tool, which writes the question to PocketBase and polls for the user's answer. The adapter monitors the PocketBase collection for questions to surface to the mobile app.
- **Progress:** Via `anyclaw_update_progress` MCP tool + monitoring the agent's stdout stream for activity.
- **Cancel:** Kill the subprocess.
- **Activity log:** Parse the agent's `--output-format stream-json` stdout.
- **Future upgrade:** Migrate to `@anthropic-ai/claude-agent-sdk` TypeScript SDK for richer lifecycle control when needed.

#### Adapter: Generic Webhook (extensibility)

For future agents (Codex, Aider, custom harnesses):
- **Dispatch:** POST to a user-configured webhook URL with a standard payload `{ request, taskId, callbackUrl }`.
- **Clarification:** The agent POSTs questions back to the callback URL. The adapter surfaces them to the user.
- **Progress:** Agent POSTs status updates to the callback URL.
- **Cancel:** POST to a cancel endpoint.

This generic adapter makes AnyClaw compatible with any agent that can implement the webhook contract.

#### Mobile UI for Task Dispatch

The mobile app's task interface is a **single card** that transitions through states:

- **Input state:** Text input + "Submit" button. Simple, not a chat interface.
- **Clarifying state:** Shows the agent's question as a card. Text input for the answer + "Reply" button. Multiple rounds stack as a short Q&A thread.
- **Working state:** Progress spinner + activity log (scrolling list of what the agent is doing). "Cancel" button.
- **Done state:** Success card with version description. "View" button refreshes the WebView. Auto-dismisses after a few seconds.
- **Failed state:** Error card with the failure reason. "Retry" or "Dismiss" buttons.

### Layer 4: Agent Integration (Agent-Agnostic)

AnyClaw does not own or bundle a coding agent. It provides two integration points that any compatible agent can use:

#### 4a. MCP Server (Infrastructure Tools)

An MCP server that exposes the AnyClaw infrastructure as tools. Any agent that supports MCP (OpenClaw, Claude Code, Codex, Aider, etc.) can use these tools directly.

- **anyclaw_create_page** — Scaffold a new React page with routing
- **anyclaw_create_api_route** — Add a new endpoint to the Node logic service
- **anyclaw_create_collection** — Define a new PocketBase collection (DB table) via PocketBase admin API
- **anyclaw_create_job** — Register a background scheduled task
- **anyclaw_deploy** — Run validation suite (lint, typecheck, build, smoke tests), commit to git with version description, promote to prod
- **anyclaw_rollback** — Revert to a specific version (code + DB snapshot atomically)
- **anyclaw_snapshot_db** — Create a DB backup (called automatically before migrations, available manually for risky operations)
- **anyclaw_list_versions** — Show deployment history with descriptions
- **anyclaw_read_file / anyclaw_write_file** — Read/write source files in the dev environment
- **anyclaw_run_dev** — Execute commands in the dev environment (for testing, debugging)
- **anyclaw_ask_user** — Post a clarifying question to the mobile app and wait for the user's answer. This enables the agent to clarify requirements before building.
- **anyclaw_update_progress** — Post a progress update to the mobile app's task card (e.g., "Creating database collections...", "Running tests...")

The MCP server enforces constraints:
- All code changes happen in the dev environment only
- PocketBase is accessed only through its admin API (never direct file edits)
- Validation must pass before promotion to prod
- DB snapshot is mandatory before any schema migration
- A user-facing version description is required for every deployment

#### 4b. Skill Suite (Agent-Specific Instructions)

Skills/prompts that teach the agent *how* to use the MCP tools effectively. These are formatted for the target agent's skill/prompt system:

**For OpenClaw:** Installed as OpenClaw skills in the standard skill directory.
**For Claude Code:** Installed as CLAUDE.md instructions or custom slash commands.
**For other agents:** Provided as system prompt templates or documentation.

The content is the same regardless of format:

- **anyclaw-build-feature** — High-level workflow: given a user request, (1) ask clarifying questions via `anyclaw_ask_user` if needed, (2) plan the feature (pages, API routes, collections), (3) implement it, (4) test it in dev, (5) deploy via `anyclaw_deploy`. Post progress updates throughout.
- **anyclaw-style-guide** — Conventions for the React frontend: component patterns, CSS approach, responsive layout rules. Keeps the UI consistent across agent-generated features.
- **anyclaw-refactor** — Periodic skill: review the codebase for growing complexity, extract shared components, clean up dead code.
- **anyclaw-describe-version** — Write a clear, non-technical version description that a non-developer can understand.

#### Agent Compatibility

| Agent | MCP Tools | Skills Format | Dispatch Adapter | Clarification Support |
|-------|-----------|---------------|------------------|----------------------|
| **OpenClaw** | Native MCP support | OpenClaw skills directory | Gateway WebSocket/REST | Full (multi-turn via gateway) |
| **Claude Code** | Native MCP support | CLAUDE.md + slash commands | Remote triggers or headless SDK | Via `anyclaw_ask_user` MCP tool (polls for answer) |
| **Codex / future** | Via MCP or tool-use API | System prompt template | Generic webhook adapter | Via `anyclaw_ask_user` MCP tool |

#### Why Agent-Agnostic

- Users keep their preferred agent (OpenClaw, Claude Code, etc.) with its memory, personality, and capabilities
- No vendor lock-in — switch agents without rebuilding the app
- The same MCP tools work regardless of which agent uses them
- Agent ecosystems evolve fast — AnyClaw doesn't need to keep up with every agent's internals, just the MCP interface
- OpenClaw users can also dispatch work via WhatsApp/Discord — the mobile app is an additional channel, not a replacement

## Versioning & Rollback

**Every deployment is a versioned snapshot:**

- **Code:** Git commit with a tag and a human-readable description written by the agent
- **Database:** SQLite snapshot (compressed copy of the DB file) taken before each deployment that includes a schema migration

**Rollback is user-initiated** from the native version history screen. A rollback restores both the code (git checkout) and the database snapshot (file swap) atomically. This avoids schema/data mismatches.

**Snapshot storage management:**
- SQLite snapshots are compressed (gzip or zstd)
- Retention policy: keep last N snapshots (configurable, default 20), plus any snapshot the user has bookmarked
- Incremental approach if storage becomes an issue: SQLite's `.backup` API + binary diff (fossil delta or similar). This is an optimization to add later if needed — full compressed copies are fine for early versions given SQLite DBs for a single user will be small.

## Failure Modes & Recovery

| # | Failure | Detection | Recovery |
|---|---------|-----------|----------|
| 1 | Agent writes code that doesn't compile/run | Validation gate in dev (lint, typecheck, build, smoke tests) | Code never reaches prod. Agent iterates in dev. User can cancel from chat. |
| 2 | Agent creates ugly or broken-looking UI | Hard to auto-detect. Taste is subjective. | User rolls back from version history. Style guidelines and component library reduce likelihood. |
| 3 | Agent corrupts database (bad migration, data loss) | Smoke tests catch some cases. Schema validation in PocketBase catches others. | Automatic DB snapshot before every migration. User restores from version history (code + DB together). |
| 4 | Agent enters fix loop (repeated failed attempts) | Token/time budget. User monitors agent activity from chat or settings. | Agent works only in dev — user never sees thrashing. User cancels the task from chat if it runs too long. Work never promotes to prod. |
| 5 | New feature breaks existing feature (regression) | Smoke tests: each feature registers a health check endpoint. All run after every deployment. | If smoke tests fail, promotion is blocked. If user discovers regression manually, rollback from version history. Feature isolation (separate routes, collections, endpoints) limits blast radius. |

## App Store Strategy

**Apple App Store:**
- The app has genuine native functionality (settings, chat/voice, version management, connection controls) — it is not a WebView wrapper
- JavaScript in WKWebView is explicitly allowed (exempted from code execution restrictions)
- Frame as "personal AI dashboard" or "AI assistant companion" in store listing
- Precedent: Notion, Salesforce, ServiceNow all use heavy WebView patterns
- Risk: moderate. If Apple rejects, can distribute via TestFlight / enterprise cert while appealing.

**Google Play:**
- WebView-based apps are first-class (TWA pattern). Low risk.

## Tech Stack Summary

| Component | Technology | Why |
|-----------|-----------|-----|
| Mobile app shell | Expo (React Native) + Expo Router | Managed builds, OTA updates, push notifications, no native build pain |
| WebView | react-native-webview | Mature, bidirectional JS bridge |
| Data & API | PocketBase | Single binary, zero config, auto-generated REST, realtime, auth, file storage. Agent-proof. |
| Server logic | Node.js + TypeScript | Agents are fluent in it, rich ecosystem, good for background jobs |
| Frontend UI | Vite + React + TypeScript | Fast builds, agents know it cold, hot reload in dev |
| Database | SQLite (via PocketBase) | Single file, easy to snapshot, zero config, sufficient for single-user |
| Background jobs | node-cron (in-process) | Simple, no Redis dependency, sufficient for single-user |
| Versioning | Git | Natural fit — agent commits, tags, describes. Rollback = checkout. |
| Agent integration | MCP server + agent-specific skills | Agent-agnostic — same MCP tools for OpenClaw, Claude Code, or any compatible agent |
| Agent dispatch | Pluggable adapter interface | OpenClaw adapter (gateway WS/REST), Claude Code adapter (remote triggers/SDK), generic webhook |
| Containerization | Docker / docker-compose | PocketBase + Node + Vite + MCP server + watchdog in one compose file |
| Tunnel (phased) | WSS relay → WebRTC P2P → Cloudflare fallback | Phase 1 MVP relay, Phase 2 true P2P via @config-plugins/react-native-webrtc |
| Broker | Node.js or Go API server | Lightweight signaling service |

## Monetization

| Tier | What's included | Cost |
|------|----------------|------|
| Free (self-hosted) | Mobile app + connection broker + AnyClaw server (Docker image). User provides hardware + LLM API keys. | Free |
| Cloud-hosted | Everything above, hosted by AnyClaw. One container per user. LLM tokens bundled or BYOK. | Monthly subscription |

## Process Architecture

AnyClaw uses **process supervision** for crash isolation, not container splits. All services run as supervised processes on a single host (or inside a single cloud container). Each process has its own restart policy and crash domain.

```
Host (or single cloud container)
│
├── [supervised, restart=always] PocketBase
│       Data layer. Rock-solid Go binary. Almost never crashes.
│
├── [supervised, restart=always] Tunnel Manager
│       Persistent WSS connection to broker. Survives all other crashes
│       so the mobile app never loses contact.
│
├── [supervised, restart=always] Dispatch / MCP Server
│       Task dispatch API + MCP HTTP/SSE endpoint + emergency rollback +
│       app restart endpoint. Source NOT in agent's writable path.
│       Always available even when logic service is broken.
│
├── [supervised, restart=on-failure] Logic Service
│       Agent-modifiable Node.js service. Custom API routes, background
│       jobs. Restart-on-crash. If broken by bad agent code, the user
│       can still rollback via the dispatch API.
│
├── [supervised, restart=always] Prod Static Server
│       Serves the agent-built React app to the WebView. Could be a
│       small Express process or PocketBase serving static files.
│
├── [transient, no auto-restart] Agent Subprocess
│       Spawned per task by the dispatch server. Runs claude/openclaw
│       with cgroup limits (CPU, memory). Crashes = task marked failed.
│       Reads/writes files in dev directory using its own tools.
│
└── [transient, no auto-restart] Vite Dev Server
        Spawned by the agent for testing during a build. Lives only
        as long as the build/test cycle. Isolated to dev/ directory.
```

### Crash Isolation Matrix

| What crashes | What survives | User experience |
|--------------|---------------|-----------------|
| Agent subprocess | Everything else | Task marked failed; user retries from app |
| Logic service (agent code) | PocketBase, tunnel, dispatch, prod static | WebView shows API errors; user rollbacks via version history |
| Vite dev server | Everything else | Current build fails; deploy doesn't happen |
| PocketBase | Tunnel, dispatch | ~2s restart; WebView and dispatch retry automatically |
| Tunnel manager | Everything else | App shows reconnecting; comes back when tunnel restarts |
| Dispatch/MCP server | PocketBase, tunnel, logic | Task submission temporarily unavailable; restarts in seconds |
| Whole host | Nothing | App shows reconnecting until user fixes the host |

### Why Not Containers

The earlier three-container design (app server / control plane / sandbox) was overengineered. Key realizations:

- **Coding agents already run commands natively** — Claude Code spawns subprocesses, OpenClaw spawns subprocesses. We don't need a sandbox container; we just need cgroup limits on the agent process.
- **Process supervision gives the same crash isolation** as containers, with much less complexity. systemd/supervisord/pm2 are battle-tested for this.
- **The "control plane" is just two persistent processes** (tunnel manager + dispatch server). They don't need their own container — just supervisor entries with `restart=always`.
- **Agent can't break the dispatch server** because the dispatch server's source files are not in the agent's writable path. The MCP `write_file` tool enforces path checks.
- **Same model as Replit, Codex, Devin** — multiple processes in one isolated environment, supervised independently.

### The Dispatch Server is the "Control Plane"

The dispatch server is the small, stable process that handles everything the user needs to be able to do **even when their app is broken**:

- `POST /tasks` — submit task
- `POST /tasks/:id/answer` — answer clarification
- `POST /tasks/:id/cancel` — cancel a running task
- `POST /rollback` — emergency rollback (always works)
- `POST /restart-app` — restart logic service (always works)
- `GET /versions` — version history
- `GET /health` — health check
- `POST /mcp` — MCP HTTP/SSE endpoint for the agent
- PocketBase Realtime SSE proxy for clarification questions and progress updates

This server is part of the AnyClaw infrastructure, not the dev workspace. The agent never modifies it.

## Technical Decisions (Locked)

All open decisions from the subsystem design docs have been resolved. These are binding for implementation.

### Architecture & Agent Integration

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Concurrent tasks | Single active task + queue. Design with task isolation for future parallelization. | Simplest for MVP, but don't paint ourselves into a corner. |
| 2 | Clarification timeout | User-configurable: "agent proceeds with best judgment" (default 5 min) OR "pause indefinitely." | Different users have different risk tolerance. |
| 3 | Claude Code adapter | CLI `-p` mode for MVP. Upgrade to TypeScript SDK later if richer lifecycle control is needed. | Less code, clarification via MCP tool works fine. |
| 4 | MCP transport | HTTP/SSE from the start. | Cloud-ready from day one. Worth the upfront complexity for long-term flexibility. |
| 5 | MCP tools philosophy | No scaffolding tools (create_page, etc). Agent runs in the coding folder using its built-in tools. MCP tools only for things agents tend to get wrong — deploy, rollback, DB snapshots, ask_user, update_progress. Robustness over convenience. | Agents can create files with high success rate. MCP tools should guard failure-prone operations. |
| 6 | run_dev commands | Blocklist for MVP, log all commands, tighten to allowlist later. | Ship fast, observe real agent behavior, then lock down. |
| 7 | Task persistence across restart | Persist task state. Resume where the agent left off after restart. | Worth the complexity — users expect reliability. |

### Process Architecture

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 8 | Process model | **Process supervision, not container split.** All AnyClaw services run as supervised processes (systemd / supervisord / pm2) with independent restart policies. No separate containers. **Self-hosted:** one Docker container with supervisord, OR native install with systemd. **Cloud-hosted:** one container per user with supervisord inside. **Supervised processes (auto-restart):** PocketBase, tunnel manager, dispatch/MCP server, logic service, prod static server. **Transient processes:** agent subprocess (per task), Vite dev server (per build). The dispatch/MCP server source files are NOT in the agent's writable path — agent cannot break it. cgroup limits on the agent process prevent CPU/RAM starvation. | Same crash isolation as three containers, dramatically simpler. The agent already runs commands natively (it's a coding agent — that's what it does). The container is the multi-tenancy boundary; supervisord is the crash-isolation boundary. Same model used by Replit, Codex sandboxes, and Devin. |

### Mobile App

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 9 | Task dispatch UI | Dedicated "Request" tab + full-screen modal/bottom sheet. | Clear, discoverable, avoids WebView z-index conflicts. |
| 10 | Min Android API | API 28 (Android 9.0). Drops ~5% of devices. | Better WebView, dark mode support, biometric API. |
| 11 | Offline native shell | Cache-nothing for MVP. Server down = reconnect screen. | Spec already says no offline requirement. |
| 12 | WebView auth token | JS bridge injection after page load. | Most secure — token never in URL or logs. |
| 13 | Realtime communication | PocketBase Realtime SSE + REST. SSE for server→client push (progress, questions). REST POST for client→server (answers, commands). PocketBase handles persistence and state automatically. Task state survives app close/reopen — user can resume clarification questions. | Leverages existing PocketBase infra. Less custom code. Built-in persistence. |

### Frontend & Styling

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 14 | CSS framework | Tailwind v4. | Newer CSS-first config. Agents will learn it quickly, and we define conventions in the style guide skill. |

### Connection & Security

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 15 | Domain | `anyclawapp.com` (purchased). Mobile app uses `broker.anyclawapp.com`. | Already bought. |
| 16 | OAuth providers | Google + Apple + GitHub at launch. | Apple required by App Store. GitHub for developer early-adopter audience. |
| 17 | WebRTC Phase 2 timing | Launch with WSS relay only. Begin Phase 2 dev after launch. | Ship faster, accept relay costs initially. |
| 18 | Broker region | US East (iad). Add regions when user distribution justifies it. | Best peering, largest user base. |
| 19 | Phase 1 E2E encryption | Yes — NaCl box encryption on top of TLS. Broker cannot read relayed traffic even if compromised. | Privacy-maximalist audience expects this. ~200 lines of crypto code, negligible perf impact. |

### Server & Data

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 20 | PocketBase credentials | PocketBase API tokens (not email/password). | More secure for programmatic access. |
| 21 | API key storage | Encrypted in PocketBase for both self-hosted and cloud. Settings UI can manage keys in both modes. | Consistent experience. Mobile app settings screen works everywhere. |
| 22 | Cloud hosting | Single VPS with Docker Compose first (one container per user with supervisord). Migrate to E2B microVMs or Kubernetes Agent Sandbox later when scale justifies it. | Start simple, scale when needed. Same container layout as self-hosted. |
| 23 | Agent execution model | Agent runs natively as a transient subprocess. Uses its own built-in tools for files and shell commands. AnyClaw MCP tools only for things the agent can't do natively (deploy, rollback, snapshot, ask_user, update_progress, create_collection). cgroup limits prevent runaway commands from starving supervised processes. | Coding agents already know how to run commands — that's their job. MCP tools should add value, not duplicate native capability. |
| 24 | Skill versioning | Independent with compatibility check. Skills declare minimum server version. Server rejects incompatible skills. | Faster iteration on prompts without requiring full server update. |

## Out of Scope (for now)

- Offline / degraded connectivity support (server down = app shows reconnect screen)
- Multi-user / sharing features (single user per instance)
- Custom domain support for self-hosters
- Native widgets (iOS/Android home screen widgets) — future enhancement
- End-to-end encryption of data at rest on cloud-hosted instances (trust model TBD)
