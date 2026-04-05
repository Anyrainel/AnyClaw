# AnyClaw — Self-Evolving AI Companion App

## Overview

AnyClaw is a self-evolving mobile UI layer powered by a personal AI agent. Instead of a fixed interface, the agent designs, builds, and maintains a fully personalized full-stack web application that the user accesses through a companion mobile app. The user talks to their agent via a persistent chat/voice interface; the agent responds by building features — dashboards, trackers, news feeds, custom tools — that persist across sessions.

**AnyClaw supports two deployment modes:**

1. **Plugin mode (for existing OpenClaw users):** AnyClaw installs as an MCP server + skill suite into an existing OpenClaw deployment. The user keeps their agent's memory, personality, and capabilities. Infrastructure (PocketBase, Node logic, Vite frontend) spins up alongside OpenClaw.
2. **Standalone mode (for new users):** A single installation script sets up everything — a bundled agent runtime (lightweight OpenClaw or compatible harness), the AnyClaw infrastructure, and all dependencies. One command, fully self-contained. No prior setup required.

Both modes produce the same server environment. The difference is whether the agent harness already exists or is bundled.

**AnyClaw consists of:**
1. **An MCP server + skill suite** — gives the agent the ability to create UI, API routes, DB collections, deploy, and rollback. In plugin mode, installs into the existing harness. In standalone mode, bundled with the agent runtime.
2. **Server infrastructure** — PocketBase + Node.js logic service + Vite/React frontend.
3. **A companion mobile app** — a thin native shell (settings, chat, version history) wrapping a WebView that loads the agent-generated UI from the user's server.

## Deployment Model

**Hybrid: self-hosted or cloud-hosted.**

- **Self-hosted (plugin):** User has an existing OpenClaw. Installs AnyClaw MCP server + skills + infrastructure alongside it. Free tier. User provides their own LLM API keys.
- **Self-hosted (standalone):** User runs a single install script that sets up everything from scratch — agent runtime + AnyClaw. Free tier. User provides their own LLM API keys.
- **Cloud-hosted:** Monthly subscription. AnyClaw hosts the full stack (one container per subscriber). LLM tokens bundled or BYOK.
- **Connection broker:** A lightweight cloud service (run by AnyClaw) that authenticates users and brokers connections between the mobile app and the server. Handles NAT traversal for self-hosters. Content flows directly between client and server — the broker only handles signaling.

## Architecture

### System Diagram

```
+---------------------+         +-------------------+         +----------------------+
|   Mobile App        |         |  Connection       |         |  User's Server       |
|   (Expo/RN)         | <-----> |  Broker           | <-----> |  (Self-hosted or     |
|                     |  auth   |  (Cloud)          |  signal |   Cloud-hosted)      |
|  +---------------+  |         +-------------------+         |                      |
|  | Native Shell  |  |                                       |  +----------------+  |
|  | - Settings    |  |         encrypted tunnel (direct)     |  | PocketBase     |  |
|  | - Chat/Voice  |  | <----------------------------------> |  | (data, auth,   |  |
|  | - Versions    |  |                                       |  |  files, RT)    |  |
|  | - Rollback    |  |                                       |  +----------------+  |
|  +---------------+  |                                       |                      |
|  +---------------+  |                                       |  +----------------+  |
|  | WebView       |  |                                       |  | Node.js Logic  |  |
|  | (agent-built  |  |                                       |  | (jobs, custom  |  |
|  |  React app)   |  |                                       |  |  APIs, LLM)    |  |
|  +---------------+  |                                       |  +----------------+  |
+---------------------+                                       |                      |
                                                              |  +----------------+  |
                                                              |  | Vite + React   |  |
                                                              |  | (agent-built   |  |
                                                              |  |  frontend)     |  |
                                                              |  +----------------+  |
                                                              |                      |
                                                              |  +----------------+  |
                                                              |  | OpenClaw       |  |
                                                              |  | (existing)     |  |
                                                              |  | + AnyClaw MCP  |  |
                                                              |  | + AnyClaw      |  |
                                                              |  |   Skills       |  |
                                                              |  +----------------+  |
                                                              +----------------------+
```

### Layer 1: Mobile App (Client)

**Stack: Expo (managed React Native) + react-native-webview**

A thin native shell with four responsibilities:

1. **Connection management** — Login screen, server selection, reconnect/restart controls. Communicates with the broker to establish a tunnel to the server.
2. **Chat/voice interface** — Floating action button (bottom-right), opens a native chat view. Text and voice input. This is how the user talks to the agent. Always available regardless of what the WebView shows.
3. **Version history & rollback** — Native screen listing agent-deployed versions with descriptions and optional screenshots. User taps to rollback. Rollback is always user-initiated.
4. **Settings & monitoring** — Server status, resource usage, agent activity log, subscription management.

The main content area is a single WebView pointing at the user's server. The WebView and native shell communicate via a JS bridge (postMessage/onMessage) for events like "agent deployed a new version, please reload" or "user tapped chat button."

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

**Tunnel options to prototype (in priority order):**

1. **Embedded WireGuard** — Server and mobile app both embed WireGuard libraries. Broker handles key exchange and STUN/TURN-style hole punching. Traffic flows directly P2P, encrypted. Broker sees nothing. Most private, most Parsec-like UX.
2. **Tailscale tsnet** — Embed Tailscale's open-source library in the server. Gets NAT traversal for free without requiring users to install Tailscale. Less control but faster to prototype.
3. **Cloudflare Tunnel** — Server runs `cloudflared`. Client connects through Cloudflare's network. Simplest to implement but routes traffic through Cloudflare (privacy tradeoff). Good fallback option.

**Security requirements:**
- The server exposes zero open ports to the internet
- All traffic is end-to-end encrypted
- The broker never sees content — only signaling metadata
- The connection setup must be fully automated (no manual port forwarding, no DNS config)
- User experience: install app, log in, server appears, one tap to connect

### Layer 4: Agent Integration (OpenClaw Plugin)

AnyClaw integrates with the user's existing OpenClaw deployment as a plugin — no separate agent runtime. The plugin provides two components:

#### 4a. MCP Server (Infrastructure Tools)

An MCP server that exposes the AnyClaw infrastructure as tools the agent can call:

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

The MCP server enforces constraints:
- All code changes happen in the dev environment only
- PocketBase is accessed only through its admin API (never direct file edits)
- Validation must pass before promotion to prod
- DB snapshot is mandatory before any schema migration
- A user-facing version description is required for every deployment

#### 4b. Skill Suite

OpenClaw skills that teach the agent *how* to use the MCP tools effectively:

- **anyclaw-build-feature** — High-level skill: given a user request, plan the feature (pages, API routes, collections needed), implement it, test it, deploy it. Orchestrates multiple MCP tool calls.
- **anyclaw-style-guide** — Conventions for the React frontend: component patterns, CSS approach, responsive layout rules. Keeps the UI consistent across agent-generated features.
- **anyclaw-refactor** — Periodic skill: review the codebase for growing complexity, extract shared components, clean up dead code. Run on agent's initiative or user request.
- **anyclaw-describe-version** — Write a clear, non-technical version description that a non-developer can understand and use to decide whether to rollback.

#### Why Both Modes

**Plugin mode** is ideal for existing OpenClaw users:
- Users keep their agent's memory, personality, and capabilities
- No duplicate agent runtime — just add the MCP server and skills
- Compatible with other harnesses that support MCP (not locked to OpenClaw)

**Standalone mode** lowers the barrier for new users:
- One install script, no prerequisites beyond Docker
- Bundles a lightweight agent runtime with AnyClaw pre-configured
- Same capabilities — user can later migrate to a full OpenClaw setup if they want

Both modes produce identical server infrastructure. The MCP server and skills are the same. The only difference is whether the agent harness is pre-existing or bundled.

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
| Agent integration | MCP server + OpenClaw skills | Plugin model — no separate agent runtime, leverages existing OpenClaw |
| Containerization | Docker / docker-compose | PocketBase + Node + Vite + watchdog in one compose file, alongside existing OpenClaw |
| Tunnel (to evaluate) | WireGuard / tsnet / Cloudflare Tunnel | See tunnel options section — prototype all three, pick best |
| Broker | Node.js or Go API server | Lightweight signaling service |

## Monetization

| Tier | What's included | Cost |
|------|----------------|------|
| Free (self-hosted) | Mobile app + connection broker + AnyClaw server (Docker image). User provides hardware + LLM API keys. | Free |
| Cloud-hosted | Everything above, hosted by AnyClaw. One container per user. LLM tokens bundled or BYOK. | Monthly subscription |

## Out of Scope (for now)

- Offline / degraded connectivity support (server down = app shows reconnect screen)
- Multi-user / sharing features (single user per instance)
- Custom domain support for self-hosters
- Native widgets (iOS/Android home screen widgets) — future enhancement
- End-to-end encryption of data at rest on cloud-hosted instances (trust model TBD)
