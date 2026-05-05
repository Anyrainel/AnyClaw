# @anyclaw/dispatch

Task orchestration service and REST API. A single Express app on `:4100` that accepts work requests from the mobile app, spawns coding agent subprocesses in isolated git worktrees, tracks task state in PocketBase, and exposes the MCP and REST endpoints that agents and mobile clients use.

See [docs/plan3-agent-dispatch-design.md](../../../docs/plan3-agent-dispatch-design.md) for architecture details.

## Responsibilities

- Accept task requests from the mobile app (via broker tunnel).
- Spawn agent subprocesses (`claude -p`, `openclaw`, etc.) in per-task git worktrees.
- Enforce resource limits: budget, duration, CPU/memory.
- Route agent clarification questions to the mobile app and return answers.
- Expose REST endpoints for task CRUD, settings, device management, version list, and emergency rollback.
- Mount the MCP server (`@anyclaw/mcp-server`) at `/mcp`.

## REST API Summary

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (also returns version) |
| `GET` | `/version` | Server version info |
| `POST` | `/tasks` | Submit a new task |
| `GET` | `/tasks/:id` | Get task status |
| `DELETE` | `/tasks/:id` | Cancel a task |
| `POST` | `/tasks/:id/answer` | Answer a clarification question |
| `GET` | `/versions` | List deployed versions |
| `POST` | `/emergency/rollback` | Emergency rollback to a prior version |
| `GET/PUT` | `/settings` | Server configuration |
| `GET/POST/DELETE` | `/devices` | Registered device management |
| `POST/DELETE` | `/mcp` | MCP tool calls (mounted from mcp-server) |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4100` | HTTP listen port |
| `ADAPTER` | `claude-code` | Agent adapter to use |
| `MAX_TASK_DURATION_MS` | `600000` | Task timeout (10 min) |
| `CLARIFICATION_TIMEOUT_MS` | `300000` | Q&A timeout (5 min) |
| `CLARIFICATION_TIMEOUT_MODE` | `best_judgment` | `best_judgment` or `abort` on timeout |
| `MAX_BUDGET_USD` | `5` | Max spend per task |
| `ANYCLAW_DATA_ROOT` | `/data` | Override data directory (tests) |

## Build & Run

```bash
npm run build          # tsc -b
npm start              # node dist/index.js
npm test               # vitest run
```

## Dependencies

- `@anyclaw/mcp-server` — MCP tools, mounted at `/mcp`
- `@anyclaw/shared` — paths, deploy/rollback managers, worktrees
- `express` — HTTP framework
- `zod` — request validation
- `ws` — WebSocket (clarification channel)
- `semver` — version comparison
- `simple-git` — git operations
