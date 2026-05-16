# Plan 1: Server Infrastructure Foundation — Technical Design

## 1. Overview

The server infrastructure is the foundation every other AnyRaven plan builds on. It delivers:

- **`@anyclaw/shared`** — the shared library consumed by all packages: NaCl crypto, gzip SQLite snapshot manager, git-based version store, worktree manager, deploy manager, rollback manager, and the `AnyClawPaths` resolver.
- **`@anyclaw/dispatch`** — a single Express app on `:4100` that Plan 2 mounts MCP routes onto and Plan 3 mounts REST routes and agent adapters onto. Plan 1 scaffolds the app factory and the `/health` endpoint.
- **`@anyclaw/tunnel-manager`** — persistent WSS connection to the broker with an in-memory routing table and exponential-backoff reconnection.
- **`@anyclaw/logic-runner`** — supervises the agent-built logic service from `/data/prod/logic-build/` on `:3000`. Provides a 503 fallback when no logic service is deployed.
- **`@anyclaw/prod-static`** — serves `/data/prod/frontend-build/` on `:5173` with SPA fallback.
- **`@anyclaw/frontend-template`** — a Vite + React + Tailwind v4 seed project copied into `/data/dev/` on first run by `init-data-layout.sh`.
- **Infrastructure** — `supervisord.conf` managing 5 supervised processes, a `Dockerfile` bundling everything, and shell scripts for PocketBase download and `/data` layout initialization.

The guiding principle is **single host, single container**. There is no three-container split, no sandbox container. Everything runs in one cloud VM or one Docker container. This minimizes operational complexity while keeping process boundaries clear through `supervisord`.

**Depends on:** Nothing — this is the foundation.

**Plans that depend on this:** Plan 2 (MCP Server), Plan 3 (Agent Dispatch), Plan 4 (Connection Broker), Plan 6 (Skills + Deployment).

---

## 2. Architecture

### 2.1 Process Supervision Model

All services run as supervised processes under `supervisord` inside a single Docker container (or under `systemd --user` on a bare host). Five supervised programs:

```
Docker container (or single host)
│
├── [supervisord, restart=always]        pocketbase           :8090
├── [supervisord, restart=always]        dispatch             :4100  ← MCP + REST + health
├── [supervisord, restart=always]        tunnel-manager              ← WSS to broker
├── [supervisord, restart=on-failure]    logic-runner         :3000  ← agent-modifiable
└── [supervisord, restart=always]        prod-static          :5173  ← agent-built frontend
```

`logic-runner` uses `restart=on-failure` (not `restart=always`) because the agent replaces the logic service binary during deploy — a deliberate stop is not a failure.

### 2.2 Package Dependency Graph

```
@anyclaw/shared
    ↑           ↑           ↑               ↑
@anyclaw/   @anyclaw/   @anyclaw/       @anyclaw/
dispatch  tunnel-mgr  logic-runner    prod-static
    ↑
@anyclaw/mcp-server   (Plan 2, mounted onto dispatch app)
@anyclaw/dispatch     (Plan 3, REST routes + adapters)
```

`@anyclaw/frontend-template` is a standalone Vite project; it does not import `@anyclaw/shared`.

### 2.3 The Dispatch App is a Shared Express Instance

`@anyclaw/dispatch` exports `createApp()` which returns a plain Express app. It does **not** call `app.listen()` itself — the entry point `packages/dispatch/src/index.ts` calls `createApp()`, then mounts are applied by Plan 2 (`mountMcp`) and Plan 3 (`mountDispatch`), and finally `app.listen(4100)` is called once. This means the MCP server, REST API, and health endpoint all share one HTTP server on `:4100`.

---

## 3. Filesystem Layout

All persistent state is rooted at `/data`. The `ANYCLAW_DATA_ROOT` environment variable overrides this for tests.

```
/data/
├── pocketbase/
│   ├── pb_data/                   PocketBase database and blobs (0700)
│   └── pb_migrations/
│
├── dev/                           agent-writable workspace
│   ├── .git/                      primary git repo for agent code
│   └── .worktrees/                per-task git worktrees
│       └── <taskId>/              created by dispatch, removed after merge
│
├── prod/
│   ├── frontend-build/            promoted Vite build artifacts (served by prod-static)
│   └── logic-build/               promoted logic service artifacts (run by logic-runner)
│
├── snapshots/                     gzip SQLite snapshots
│   └── <iso-timestamp>.sqlite.gz
│
└── .anyclaw/                      secrets and config (0750, owned by anyclaw-infra)
    └── logs/
```

`AnyClawPaths` (in `@anyclaw/shared`) is the single source of truth for these paths. Every package constructs an `AnyClawPaths(process.env.ANYCLAW_DATA_ROOT ?? "/data")` instance rather than hardcoding path strings.

---

## 4. `@anyclaw/shared` — Module Reference

### 4.1 `AnyClawPaths`

Resolves all well-known filesystem paths from a configurable data root. Used by every package to avoid hardcoded strings and to allow test overrides via `ANYCLAW_DATA_ROOT`.

```typescript
const paths = new AnyClawPaths("/data");
paths.dev           // "/data/dev"
paths.devWorktrees  // "/data/dev/.worktrees"
paths.prod          // "/data/prod"
paths.prodFrontend  // "/data/prod/frontend-build"
paths.prodLogic     // "/data/prod/logic-build"
paths.snapshots     // "/data/snapshots"
paths.secrets       // "/data/.anyclaw"
paths.worktreeFor(taskId)           // "/data/dev/.worktrees/<taskId>"
paths.snapshotFile(isoStamp)        // "/data/snapshots/<isoStamp>.sqlite.gz"
```

### 4.2 Crypto (`crypto.ts`)

NaCl box (X25519 + XSalsa20-Poly1305) via `libsodium-wrappers` (pinned to `0.7.15` — `0.7.16` ships a broken ESM build). Used for end-to-end encrypted envelope exchange between server and mobile app via the broker.

Key exports: `generateKeyPair()`, `encryptJSON(payload, recipientPublicKey, senderSecretKey)`, `decryptJSON(envelope, senderPublicKey, recipientSecretKey)`.

### 4.3 Snapshot Manager (`snapshots.ts`)

Creates and restores gzip-compressed SQLite snapshots. Snapshots are taken before every deploy and before any schema-mutating PocketBase operation, providing the rollback data source.

Key exports: `SnapshotManager` — `create(label)`, `restore(isoStamp)`, `list()`.

### 4.4 Version Store (`versionStore.ts`)

Git-based version history. Each deploy commits the agent's worktree to the `main` branch and writes a lightweight tag (`v<n>`). Rollback checks out a prior tag. The version list is the deployment history shown in the mobile app.

Key exports: `VersionStore` — `commit(message)`, `tag(label)`, `list()`, `checkout(tag)`.

### 4.5 Worktree Manager (`worktrees.ts`)

Creates and deletes git worktrees under `/data/dev/.worktrees/<taskId>/`. Each agent task gets an isolated worktree so concurrent tasks don't conflict. The dispatch server creates the worktree at task start and removes it after merge or failure.

Key exports: `WorktreeManager` — `create(taskId)`, `remove(taskId)`, `list()`.

### 4.6 Deploy Manager (`deployManager.ts`)

Orchestrates a full deployment: validate the worktree (lint + typecheck + build + tests), snapshot the DB, merge the worktree into `main`, copy artifacts to `prod/`, and signal `logic-runner` to restart. Returns a discriminated union `{ ok: true, version } | { ok: false, error }`.

Key exports: `DeployManager` — `deploy(taskId, message)`.

### 4.7 Rollback Manager (`rollbackManager.ts`)

Symmetric to deploy: restore the DB snapshot for a given version tag, check out that tag in the prod directories, and restart `logic-runner`. Atomic — if any step fails, the prior state is preserved.

Key exports: `RollbackManager` — `rollback(versionTag)`.

---

## 5. Infrastructure

### 5.1 `supervisord.conf`

Manages 5 programs. Key settings:

| Program | Command | Restart | Notes |
|---|---|---|---|
| `pocketbase` | `pocketbase serve --http=127.0.0.1:8090` | `always` | PocketBase 0.25 binary |
| `dispatch` | `node packages/dispatch/dist/index.js` | `always` | Port 4100 |
| `tunnel-manager` | `node packages/tunnel-manager/dist/index.js` | `always` | WSS to broker |
| `logic-runner` | `node packages/logic-runner/dist/index.js` | `on-failure` | Restartable by deploy |
| `prod-static` | `node packages/prod-static/dist/index.js` | `always` | Port 5173 |

### 5.2 Dockerfile

Single-stage build on `node:20-slim`. Steps:

1. Install `supervisord` and `curl` via apt.
2. Copy monorepo source, run `npm ci --workspaces`.
3. Run `npm run build --workspaces` to compile all TypeScript.
4. Run `download-pocketbase.sh` to fetch the PocketBase 0.25 binary.
5. `ENTRYPOINT ["supervisord", "-c", "infra/supervisord.conf"]`

The container exposes ports `4100` (dispatch), `5173` (prod-static), and `8090` (PocketBase, loopback only inside container).

### 5.3 `init-data-layout.sh`

Creates the `/data` directory tree and copies `@anyclaw/frontend-template` into `/data/dev/` on first run. Initializes the git repo in `/data/dev/` with an initial commit. Idempotent — safe to run again if `/data` already exists.

---

## 6. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 20 | LTS |
| Language | TypeScript 5.x (npm resolves ~5.9) | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Monorepo | npm workspaces | No build tool; plain `tsc -b` per package |
| Tests | Vitest 2.x | All packages |
| Crypto | libsodium-wrappers 0.7.15 | Pinned; 0.7.16 ESM build is broken |
| Git operations | simple-git | Worktrees, commit, tag, checkout |
| HTTP | Express 4.x | Dispatch scaffold; prod-static |
| WebSockets | ws | Tunnel manager |
| File watching | chokidar | Logic runner |
| PocketBase | 0.25 binary + JS SDK 0.25 | Database + realtime |
| Frontend seed | Vite 5 + React 18 + Tailwind v4 + lucide-react | frontend-template only |
| Process supervision | supervisord | Inside Docker |
| Container | Docker (single-stage, node:20-slim) | |
