# @anyclaw/mcp-server

MCP (Model Context Protocol) server exposing production-operation tools to coding agents. Mounted onto the dispatch Express app at `/mcp`. Agents authenticate with a per-task bearer token and call these tools to deploy, rollback, snapshot the database, interact with PocketBase schema, and communicate with the user via the mobile app.

See [docs/plan2-mcp-server-design.md](../../../docs/plan2-mcp-server-design.md) for architecture details.

## Tools

| Tool | Description |
|---|---|
| `anyclaw_deploy` | Validate worktree, snapshot DB, merge to main, promote to prod, restart logic service |
| `anyclaw_rollback` | Restore DB snapshot and revert code to a prior version tag |
| `anyclaw_snapshot_db` | Create a labelled gzip SQLite snapshot |
| `anyclaw_list_versions` | Return deployment history |
| `anyclaw_create_collection` | Create a PocketBase collection (auto-snapshots first) |
| `anyclaw_ask_user` | Post a clarifying question to the mobile app; block until answered |
| `anyclaw_update_progress` | Fire-and-forget progress update to the mobile app |

There are no file or shell tools — agents use their own native tools for code work.

## API

```typescript
import { mountMcp, registerTaskToken, revokeTaskToken } from "@anyclaw/mcp-server";

// In dispatch setup:
mountMcp(app, ctx);                          // attach /mcp routes to Express app
const token = registerTaskToken(taskId);     // issue bearer token when spawning agent
revokeTaskToken(taskId);                     // revoke on task completion/failure
```

## Authentication

Each task gets a unique bearer token issued by `registerTaskToken`. The agent passes it as `Authorization: Bearer <token>`. The token is tied to a `taskId`; every tool call resolves which task it belongs to before executing.

## Transport

HTTP/SSE only (no stdio). Binds exclusively on loopback through the shared dispatch Express app (`127.0.0.1:4100/mcp`). Implements the MCP Streamable HTTP transport.

## Build & Test

```bash
npm run build          # tsc -b
npm test               # vitest run
```

## Dependencies

- `@anyclaw/shared` — paths, deploy/rollback managers, snapshot manager, version store
- `@modelcontextprotocol/sdk` — MCP server + Streamable HTTP transport
- `pocketbase` — collection management, task/message writes
- `express` — HTTP (shared with dispatch)
- `zod` — tool input validation
