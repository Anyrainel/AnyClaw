# anyclaw-server

Server-side monorepo for AnyRaven. Runs per-user, inside a single Docker container (or bare Linux host). Manages the agent's working environment, coordinates deployments, and exposes the MCP tool suite and REST API to the mobile app.

See [docs/plan1-server-infrastructure-design.md](../docs/plan1-server-infrastructure-design.md) for architecture details.

## Packages

| Package | Port | Description |
|---|---|---|
| [`shared`](packages/shared/README.md) | — | Crypto, paths, snapshot manager, version store, worktrees, deploy/rollback managers |
| [`dispatch`](packages/dispatch/README.md) | 4100 | Task orchestration, REST API, and MCP mount point |
| [`mcp-server`](packages/mcp-server/README.md) | 4100/mcp | MCP tools for coding agents (deploy, rollback, ask user, etc.) |
| [`tunnel-manager`](packages/tunnel-manager/README.md) | — | Persistent WSS tunnel to the broker |
| [`app-backend`](packages/app-backend/README.md) | 3000 | Supervises agent-built app backend |
| [`app-frontend`](packages/app-frontend/README.md) | 5173 | Serves agent-built frontend (SPA) |
| [`frontend-template`](packages/frontend-template/README.md) | — | Vite+React+Tailwind v4 seed copied to `/data/dev/` on first run |

## Process Model

All services are supervised by `supervisord` (5 programs):

```
pocketbase        :8090   restart=always
dispatch          :4100   restart=always   (embeds MCP + REST)
tunnel-manager            restart=always
app-backend      :3000   restart=on-failure
app-frontend       :5173   restart=always
```

## Monorepo Commands

Run from `anyclaw-server/`:

```bash
npm install                      # Install all workspaces
npm run build                    # tsc -b all packages
npm test                         # Vitest across all packages
npm run typecheck                # Type-check without emit
```

Run a single package:

```bash
npm run -w @anyclaw/shared test
npm run -w @anyclaw/dispatch build
```

## Filesystem Layout

All persistent runtime state lives under `/data` (override with `ANYCLAW_DATA_ROOT` in tests):

```
/data/
├── pocketbase/pb_data/          PocketBase database
├── dev/                         Agent's git repo + worktrees
│   └── .worktrees/<taskId>/     Per-task isolated worktrees
├── prod/
│   ├── app-frontend/          Promoted Vite build
│   └── app-backend/             Promoted app backend
├── snapshots/                   Gzip SQLite snapshots (pre-deploy)
└── .anyclaw/                    Secrets: pb-token, mcp-tokens/, logs/
```

## Infrastructure

- `infra/Dockerfile` — single-stage `node:20-slim` image; installs supervisord, builds all packages, downloads PocketBase binary.
- `infra/supervisord.conf` — process definitions for all 5 services.
- `infra/scripts/download-pocketbase.sh` — fetches pinned PocketBase 0.25 binary.
- `infra/scripts/init-data-layout.sh` — creates `/data` tree and seeds `/data/dev/` from `frontend-template` on first run.

## Tech Stack

Node.js 20 · TypeScript 5.x · npm workspaces · Vitest · Express · libsodium-wrappers · simple-git · PocketBase 0.25 · supervisord · Docker
