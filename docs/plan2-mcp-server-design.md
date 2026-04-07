# Plan 2: MCP Server — Technical Design

## 1. Overview

The AnyClaw MCP server is the chokepoint through which a coding agent performs operations that affect production: deploying new code, rolling back, snapshotting the database, managing PocketBase collections, and talking to the user on the mobile app. It runs as a supervised process on the same host as the rest of the AnyClaw infrastructure and exposes its tools over HTTP/SSE on loopback.

The guiding principle is **additive, not duplicative**. The agent (Claude Code, OpenClaw, or any MCP-capable agent) uses its own native file and shell tools inside a git worktree in the `dev/` workspace. The MCP server does not wrap those capabilities. It exposes exactly seven tools, each of which guards an operation that is either (a) failure-prone for agents, (b) requires infrastructure coordination that agents cannot safely perform alone, or (c) cannot be done with a local shell at all (user-facing messaging through the mobile app).

The seven tools are:

| Tool | Purpose |
|------|---------|
| `anyclaw_deploy` | Validate the current worktree, snapshot DB, commit, merge to `main`, promote to prod, restart the prod logic service. |
| `anyclaw_rollback` | Atomically revert code and database to a previous version. |
| `anyclaw_snapshot_db` | Create a labelled compressed SQLite snapshot. |
| `anyclaw_list_versions` | Return deployment history. |
| `anyclaw_create_collection` | Create a PocketBase collection via admin API with a mandatory pre-change snapshot. |
| `anyclaw_ask_user` | Post a clarifying question to the mobile app and wait for the user's answer. |
| `anyclaw_update_progress` | Post a progress update to the mobile app (fire-and-forget). |

There are no scaffolding tools, no `read_file`/`write_file`, and no `run_command`. Those needs are met by the agent's native tools.

**Depends on:** Plan 1 (Server Infrastructure) — the deploy manager, snapshot manager, version store, worktree manager, and project layout are all built in Plan 1. The MCP server wires those into tool handlers.

---

## 2. Architecture

### 2.1 Position in the Process Supervision Model

AnyClaw runs all services as supervised processes under `systemd --user` (primary) or `supervisord` (fallback for minimal containers). The MCP server is one of those supervised processes. Per locked decisions #8, #23, and #25, there is **no three-container split** and **no sandbox container**. Everything runs in one host or one cloud container.

```
Host (or single cloud container)
│
├── [systemd unit, restart=always] pocketbase.service
├── [systemd unit, restart=always] anyclaw-tunnel.service
├── [systemd unit, restart=always] anyclaw-dispatch.service    ← embeds the MCP server
├── [systemd unit, restart=on-failure] anyclaw-logic.service   ← agent-modifiable; deploy restarts this
├── [systemd unit, restart=always] anyclaw-prod-static.service
│
├── [transient, spawned per task] Agent subprocess (claude -p / openclaw / ...)
│       Runs as `anyclaw-agent` OS user inside a git worktree.
│       Talks to MCP server at http://127.0.0.1:4100/mcp with a per-task bearer token.
│
└── [transient, spawned by agent] Vite dev server (per build)
```

The dispatch server and the MCP server live in the **same source package and same process** (locked decision #8: "the minimal deployment is a single process that exposes both the dispatch REST API and the `/mcp` endpoint"). The code paths are separated into `src/dispatch/` and `src/mcp-server/`, but a single Node.js process hosts both. Larger deployments may split them later without source changes.

### 2.2 What the MCP Server Talks To

| Peer | Direction | Purpose |
|------|-----------|---------|
| Coding agent | inbound HTTP/SSE on `127.0.0.1:4100/mcp` | Tool calls |
| PocketBase | outbound REST on `127.0.0.1:8090` | Collection CRUD, `_tasks` / `_agent_messages` / `_versions` reads/writes, realtime subscriptions |
| Local filesystem | direct | Worktree create/merge, validation, git commits, prod artifact copies |
| systemd (user bus) | `systemctl --user restart anyclaw-logic` via subprocess | Restart prod logic service after deploy (decision #28) |
| Dispatch REST clients (mobile app via tunnel) | inbound HTTP on same port | Emergency rollback, version list, restart-app, task submission |

### 2.3 File Layout on Disk

The MCP/dispatch server source and configuration live under `/data/.anyclaw/`, owned by the `anyclaw-infra` OS user with mode `0750`. The agent runs as `anyclaw-agent` and has no write access to this directory — its source code is safe from agent mistakes.

```
/data/
├── .anyclaw/                            owned by anyclaw-infra, 0750
│   ├── bin/                             compiled dispatch/MCP server
│   ├── systemd/                         unit files
│   ├── master.key                       0600 — AES-256-GCM key (decision #48)
│   ├── pb-token                         0600 — PocketBase API token (decision #47)
│   ├── mcp-tokens/                      per-task bearer tokens (decision #35)
│   │   └── task-<uuid>.token            0640, group: anyclaw-agent
│   └── snapshots/                       SQLite snapshots (gzip)
│
├── dev/                                 owned by anyclaw-agent, group-writable
│   ├── .git/                            primary git repo
│   ├── .worktrees/                      per-task isolation (decision #36)
│   │   └── task-<uuid>/                 worktree created by dispatch, removed after merge
│   ├── logic/                           agent-modifiable Node.js logic service
│   └── frontend/                        agent-modifiable Vite+React frontend
│
├── prod/                                owned by anyclaw-infra, 0755
│   ├── logic/                           promoted logic service artifacts
│   └── frontend/                        promoted frontend build artifacts
│
└── pocketbase/
    ├── pb_data/                         owned by anyclaw-infra, 0700
    └── pb_migrations/
```

The dispatch server spawns each agent subprocess with `cwd` set to `/data/dev/.worktrees/task-<uuid>/` so the agent's native tools operate inside the isolated worktree.

---

## 3. Transport & Authentication

### 3.1 HTTP/SSE on Loopback

Per locked decision #4, HTTP/SSE is the only transport. There is no stdio mode. The MCP server binds to `127.0.0.1:4100` exclusively — never to a public interface.

```typescript
// src/mcp-server/index.ts
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools } from "./tools/index.js";
import { requireBearerToken, resolveTaskFromToken } from "./auth.js";

export function mountMcp(app: express.Express): void {
  app.post("/mcp", requireBearerToken, async (req, res) => {
    const taskId = resolveTaskFromToken(req);

    const server = new McpServer(
      { name: "anyclaw", version: "1.0.0" },
      {
        instructions: [
          "AnyClaw MCP server. Use your own native file and shell tools for everything in the dev worktree.",
          "Use AnyClaw MCP tools only for production operations: anyclaw_deploy, anyclaw_rollback, anyclaw_snapshot_db, anyclaw_create_collection.",
          "Use anyclaw_ask_user to clarify requirements and anyclaw_update_progress to keep the user informed.",
          "A version description of at least 10 characters is required for every deployment.",
        ].join(" "),
      }
    );
    registerAllTools(server, { taskId });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
}
```

### 3.2 Per-Task Bearer Token

Per locked decision #35, the MCP endpoint is authenticated with a **per-task bearer token**. The dispatch server generates a fresh token when it creates a task, writes it to `/data/.anyclaw/mcp-tokens/task-<uuid>.token` with mode `0640` (readable by the `anyclaw-agent` group), and injects it into the agent subprocess as `ANYCLAW_MCP_TOKEN`. The agent's MCP config (e.g., Claude Code's `.mcp.json`) references that env var:

```json
{
  "mcpServers": {
    "anyclaw": {
      "type": "http",
      "url": "http://127.0.0.1:4100/mcp",
      "headers": { "Authorization": "Bearer ${ANYCLAW_MCP_TOKEN}" }
    }
  }
}
```

Token validation and task-ID lookup:

```typescript
// src/mcp-server/auth.ts
import type { Request, Response, NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";

const TOKEN_DIR = "/data/.anyclaw/mcp-tokens";
const tokenToTask = new Map<string, string>();

export function registerTaskToken(taskId: string, token: string): void {
  tokenToTask.set(token, taskId);
  fs.writeFileSync(path.join(TOKEN_DIR, `task-${taskId}.token`), token, { mode: 0o640 });
}

export function revokeTaskToken(taskId: string): void {
  for (const [token, id] of tokenToTask.entries()) {
    if (id === taskId) tokenToTask.delete(token);
  }
  try { fs.unlinkSync(path.join(TOKEN_DIR, `task-${taskId}.token`)); } catch {}
}

export function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match || !tokenToTask.has(match[1])) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  (req as any).anyclawToken = match[1];
  next();
}

export function resolveTaskFromToken(req: Request): string {
  const token = (req as any).anyclawToken as string;
  const taskId = tokenToTask.get(token);
  if (!taskId) throw new Error("token_not_registered");
  return taskId;
}
```

When the task finishes (deploy, rollback, cancel, or fail), the dispatch server calls `revokeTaskToken(taskId)` so the token is no longer accepted. The task ID travels with every tool call via closure capture in `registerAllTools(server, { taskId })` — no separate session-metadata plumbing needed.

---

## 4. PocketBase Integration

### 4.1 Admin Client

PocketBase is reached via its REST admin API (locked decision #20 — API tokens, not email/password). The token is provisioned once by the install script (decision #47) and stored at `/data/.anyclaw/pb-token` mode `0600` owned by `anyclaw-infra`. Supervisord/systemd injects it into the dispatch process as `PB_ADMIN_TOKEN`.

```typescript
// src/mcp-server/pocketbase-client.ts
import PocketBase from "pocketbase";
import fs from "node:fs";

let pbAdmin: PocketBase | null = null;

export function getPocketBaseAdmin(): PocketBase {
  if (!pbAdmin) {
    const url = process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090";
    const token = process.env.PB_ADMIN_TOKEN ?? fs.readFileSync("/data/.anyclaw/pb-token", "utf8").trim();
    pbAdmin = new PocketBase(url);
    pbAdmin.authStore.save(token, null);
  }
  return pbAdmin;
}
```

The agent **never** gets this token. The admin client is only used inside the MCP server process.

### 4.2 Internal Collections

The MCP/dispatch server owns three PocketBase collections. Access rules are admin-only (`listRule: null`, `viewRule: null`, etc.) so the agent-built frontend cannot see or mutate them.

**`_tasks`** — persisted task state (decision #7, #40):

| Field | Type | Notes |
|-------|------|-------|
| `taskId` | text, unique | Client-generated UUID (decision #40 exactly-once) |
| `request` | text | Original user request |
| `state` | select | `queued` \| `clarifying` \| `working` \| `deploying` \| `done` \| `failed` \| `cancelled` |
| `agentType` | text | `claude-code` \| `openclaw` \| `webhook` |
| `checkpoint` | json | `{ lastCompletedStep, filesModified, agentBlob? }` (decision #38) |
| `error` | text, optional | Failure reason |
| `worktreePath` | text, optional | `/data/dev/.worktrees/task-<uuid>` while in progress |
| `startedAt` / `finishedAt` | date | |
| `createdAt` / `updatedAt` | auto | |

**`_agent_messages`** — realtime bus between agent and mobile app:

| Field | Type | Notes |
|-------|------|-------|
| `taskId` | text, required | Groups messages by task |
| `direction` | select | `agent_to_user` \| `user_to_agent` |
| `type` | select | `question` \| `answer` \| `progress` \| `deploy_event` |
| `content` | text, required | |
| `options` | json, optional | Preset answer options for questions |
| `phase` | select, optional | `clarifying` \| `working` \| `deploying` |
| `percent` | number, optional | 0–100 |
| `questionId` | text, optional | On `answer`, references the `question` record id |
| `answeredAt` | date, optional | |
| `createdAt` | auto | |

**`_versions`** — deployment history:

| Field | Type | Notes |
|-------|------|-------|
| `version` | text, unique | `v1.2.3` |
| `description` | text, required, min 10 | User-facing description |
| `gitCommit` | text, required | Full SHA on `main` after merge |
| `gitTag` | text | e.g., `v1.2.3` |
| `dbSnapshotId` | text, nullable | ID in `/data/.anyclaw/snapshots/` |
| `deployedBy` | text | Source taskId |
| `artifacts` | json | `{ frontendPath, logicPath }` in prod |
| `createdAt` | auto | |

The install script creates these three collections via the admin API during first-run setup. They are **not** migrations committed to the agent's workspace — they belong to infrastructure.

---

## 5. Task State Management

### 5.1 Persistence Model

Task state is persisted in `_tasks` so tasks survive MCP server restarts and host reboots (locked decision #7). Every state transition is a PocketBase update. Because the dispatch server and MCP server are the same process, there is no cross-process sync.

The checkpoint field uses the hybrid schema from decision #38:

```typescript
// src/dispatch/task-checkpoint.ts
export type TaskCheckpoint = {
  lastCompletedStep:
    | "queued"
    | "clarifying_pending"
    | "implementation"
    | "validated"
    | "snapshotted"
    | "committed"
    | "merged"
    | "promoted";
  filesModified: string[];
  agentBlob?: unknown;  // Agent-specific resume state (opaque to dispatcher)
};
```

The dispatcher reads `lastCompletedStep` for mobile UI progress; the agent adapter reads/writes `agentBlob` to resume precisely (e.g., Claude Code session history).

### 5.2 Resume Flow on Restart

Per decisions #7, #39, and #40, on startup the dispatch server:

1. **Query** `_tasks` for `state IN ("queued", "clarifying", "working", "deploying")`.
2. **For each record**, atomically move `state = "working"` rows with no matching live process to `state = "failed"` with `error = "server_restart"` (decision #40 — exactly-once with crash recovery).
3. **For rows still in `clarifying` or `queued`**, check `_agent_messages` for any unanswered `question` record. If one is pending:
   - Wait for the `answer` record (respecting the user's clarification timeout mode — decision #2).
   - Update `checkpoint.agentBlob` to include the answer.
4. **Re-spawn** the agent subprocess for rows that can legitimately resume, passing the checkpoint and the original request. The adapter is responsible for deciding what to do with the checkpoint — the generic path simply re-dispatches the original request with the prior `filesModified` listed in the system prompt so the agent can inspect existing work.
5. **Rehydrate** the per-task bearer token (generate a new one if absent on disk) and register it before the agent spawns.

If resume fails for any reason, the task is marked `failed` with reason `"resume_failed: <detail>"` and the user is notified via `_agent_messages`.

---

## 6. Ask User & Update Progress

Locked decision #13: **PocketBase Realtime SSE + REST** is the single communication mechanism. Server-to-client push uses SSE subscriptions; client-to-server responses use REST POST. The MCP server uses the PocketBase Node SDK's subscription API to receive answers.

### 6.1 `anyclaw_ask_user` Protocol

```
Agent                     MCP Server               PocketBase              Mobile App
  │                            │                        │                       │
  │─── tool call ──────────────▶│                        │                       │
  │                            │── create question ────▶│                       │
  │                            │                        │── SSE push ──────────▶│
  │                            │── subscribe(answer) ──▶│                       │
  │                            │                        │                       │── tap option
  │                            │                        │◀── POST answer ───────│
  │                            │◀── SSE push ───────────│                       │
  │◀── { answer, answeredAt } ─│                        │                       │
```

Exact PocketBase record written by `anyclaw_ask_user`:

```json
{
  "taskId": "task-7f4c2...",
  "direction": "agent_to_user",
  "type": "question",
  "content": "Daily check-in or multiple times per day?",
  "options": ["Daily", "Multiple times per day"]
}
```

PocketBase returns a record id (e.g., `rec_abc123`). The tool then subscribes:

```typescript
const pb = getPocketBaseAdmin();
const answer = await new Promise<AnswerRecord>((resolve, reject) => {
  const timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
  pb.collection("_agent_messages").subscribe("*", (e) => {
    if (
      e.action === "create" &&
      e.record.direction === "user_to_agent" &&
      e.record.type === "answer" &&
      e.record.questionId === questionRecord.id
    ) {
      clearTimeout(timer);
      pb.collection("_agent_messages").unsubscribe("*");
      resolve(e.record as AnswerRecord);
    }
  }, { filter: `taskId = "${taskId}"` });
});
```

The mobile app POSTs its answer record with `direction: "user_to_agent"`, `type: "answer"`, `questionId: "rec_abc123"`, `content: "Daily"`. The MCP server's subscription filter matches and the promise resolves.

Timeout behavior (decision #2): default 5 minutes. If the user has selected "pause indefinitely" in settings, the dispatch server passes `timeoutMs: Infinity` into the tool and the promise never rejects on timeout. On server restart while waiting, the resume flow (Section 5.2) picks up the unanswered question from `_agent_messages` and waits again.

### 6.2 `anyclaw_update_progress` Protocol

Fire-and-forget. The tool writes a `progress` record and returns immediately:

```json
{
  "taskId": "task-7f4c2...",
  "direction": "agent_to_user",
  "type": "progress",
  "content": "Creating database collections...",
  "phase": "working",
  "percent": 30
}
```

PocketBase realtime pushes to the mobile app's subscription. The tool returns `{ delivered: true }` synchronously once the PocketBase create call resolves (it does not wait for client acknowledgement).

---

## 7. Tool Reference

All tool handlers live under `src/mcp-server/tools/`. Each tool validates its input with Zod, executes its handler inside the global error wrapper (Section 10), and returns a `content` array plus `structuredContent` where applicable.

### 7.1 `anyclaw_create_collection`

```typescript
server.registerTool(
  "anyclaw_create_collection",
  {
    title: "Create Collection",
    description:
      "Create a new PocketBase collection (database table) via the admin API. " +
      "Automatically snapshots the database before the schema change.",
    inputSchema: z.object({
      name: z.string().regex(/^[a-z][a-z0-9_]*$/).describe("Collection name in snake_case, e.g. 'mood_entries'"),
      type: z.enum(["base", "auth", "view"]).default("base"),
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.enum([
            "text", "number", "bool", "email", "url", "date",
            "select", "json", "file", "relation", "editor",
          ]),
          required: z.boolean().default(false),
          options: z.record(z.unknown()).optional(),
        })
      ).min(1),
      listRule: z.string().nullable().optional(),
      viewRule: z.string().nullable().optional(),
      createRule: z.string().nullable().optional(),
      updateRule: z.string().nullable().optional(),
      deleteRule: z.string().nullable().optional(),
    }),
    outputSchema: z.object({
      collectionId: z.string(),
      collectionName: z.string(),
      fieldsCreated: z.number(),
      snapshotId: z.string(),
    }),
    annotations: { destructiveHint: true, idempotentHint: false },
  },
  withErrorHandling(async (input) => {
    if (input.name.startsWith("_")) {
      throw new ToolError("Collection names starting with '_' are reserved for AnyClaw infrastructure");
    }
    const snapshotId = await snapshotManager.create(`pre-schema-${input.name}-${Date.now()}`);
    const pb = getPocketBaseAdmin();
    const created = await pb.collections.create({
      name: input.name,
      type: input.type,
      schema: input.fields.map(f => ({ name: f.name, type: f.type, required: f.required, options: f.options ?? {} })),
      listRule: input.listRule ?? null,
      viewRule: input.viewRule ?? null,
      createRule: input.createRule ?? null,
      updateRule: input.updateRule ?? null,
      deleteRule: input.deleteRule ?? null,
    });
    return {
      content: [{ type: "text", text: `Created collection '${input.name}' with ${input.fields.length} fields (snapshot: ${snapshotId})` }],
      structuredContent: { collectionId: created.id, collectionName: input.name, fieldsCreated: input.fields.length, snapshotId },
    };
  })
);
```

### 7.2 `anyclaw_deploy`

```typescript
server.registerTool(
  "anyclaw_deploy",
  {
    title: "Deploy to Production",
    description:
      "Validate the current task worktree, snapshot the database, commit, merge to main, " +
      "promote artifacts to prod, and restart the prod logic service. " +
      "REQUIRES a version description a non-technical user can understand.",
    inputSchema: z.object({
      versionDescription: z.string().min(10).describe(
        "User-facing description of what changed. Minimum 10 characters."
      ),
      skipDbSnapshot: z.boolean().default(false).describe(
        "Skip the pre-deploy DB snapshot. Only set true if this deploy has zero schema changes."
      ),
    }),
    outputSchema: z.object({
      version: z.string(),
      gitCommit: z.string(),
      gitTag: z.string(),
      dbSnapshotId: z.string().nullable(),
      validationResults: z.object({
        lint: z.boolean(),
        typecheck: z.boolean(),
        build: z.boolean(),
        smokeTests: z.boolean(),
      }),
    }),
    annotations: { destructiveHint: true, idempotentHint: false },
  },
  withErrorHandling(async ({ versionDescription, skipDbSnapshot }, ctx) => {
    return deployManager.run({ taskId: ctx.taskId, versionDescription, skipDbSnapshot });
  })
);
```

The pipeline is implemented in Plan 1's `DeployManager` but is specified end-to-end in Section 8 below.

### 7.3 `anyclaw_rollback`

```typescript
server.registerTool(
  "anyclaw_rollback",
  {
    title: "Rollback to Version",
    description:
      "Revert production to a specific version. Restores both code (git checkout) and " +
      "database (SQLite snapshot) atomically. The current state is snapshotted first as a safety net.",
    inputSchema: z.object({
      version: z.string().describe("Version identifier, e.g. 'v1.2.0'"),
    }),
    outputSchema: z.object({
      rolledBackTo: z.string(),
      safetySnapshotId: z.string(),
      gitCommit: z.string(),
    }),
    annotations: { destructiveHint: true },
  },
  withErrorHandling(async ({ version }) => rollbackManager.run(version))
);
```

The same rollback logic is reachable via the dispatch server's `POST /rollback` REST endpoint so the mobile app can recover even when no agent is running.

### 7.4 `anyclaw_snapshot_db`

```typescript
server.registerTool(
  "anyclaw_snapshot_db",
  {
    title: "Snapshot Database",
    description:
      "Create a compressed SQLite snapshot. Called automatically before schema migrations, " +
      "and available manually for risky data operations.",
    inputSchema: z.object({
      label: z.string().min(3).describe("Short label, e.g. 'before-mood-data-migration'"),
    }),
    outputSchema: z.object({
      snapshotId: z.string(),
      sizeBytes: z.number(),
      path: z.string(),
    }),
  },
  withErrorHandling(async ({ label }) => {
    const snap = await snapshotManager.create(label);
    return {
      content: [{ type: "text", text: `Snapshot created: ${snap.snapshotId} (${snap.sizeBytes} bytes)` }],
      structuredContent: snap,
    };
  })
);
```

### 7.5 `anyclaw_list_versions`

```typescript
server.registerTool(
  "anyclaw_list_versions",
  {
    title: "List Versions",
    description: "Show deployment history.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(10),
    }),
    outputSchema: z.object({
      versions: z.array(
        z.object({
          version: z.string(),
          description: z.string(),
          timestamp: z.string(),
          gitCommit: z.string(),
          dbSnapshotId: z.string().nullable(),
        })
      ),
    }),
  },
  withErrorHandling(async ({ limit }) => {
    const rows = await getPocketBaseAdmin()
      .collection("_versions")
      .getList(1, limit, { sort: "-created" });
    return {
      content: [{ type: "text", text: `Found ${rows.items.length} versions` }],
      structuredContent: {
        versions: rows.items.map((r) => ({
          version: r.version,
          description: r.description,
          timestamp: r.created,
          gitCommit: r.gitCommit,
          dbSnapshotId: r.dbSnapshotId ?? null,
        })),
      },
    };
  })
);
```

### 7.6 `anyclaw_ask_user`

```typescript
server.registerTool(
  "anyclaw_ask_user",
  {
    title: "Ask User",
    description:
      "Post a clarifying question to the mobile app and wait for the user's answer. " +
      "Blocks until the user responds or the timeout expires.",
    inputSchema: z.object({
      question: z.string().min(1),
      options: z.array(z.string()).max(8).optional(),
      timeoutMs: z.number().int().min(1000).max(600000).default(300000),
    }),
    outputSchema: z.object({
      answer: z.string(),
      answeredAt: z.string(),
      timedOut: z.boolean(),
    }),
  },
  withErrorHandling(async ({ question, options, timeoutMs }, ctx) => {
    return askUserProtocol.run({ taskId: ctx.taskId, question, options, timeoutMs });
  })
);
```

See Section 6.1 for the full protocol.

### 7.7 `anyclaw_update_progress`

```typescript
server.registerTool(
  "anyclaw_update_progress",
  {
    title: "Update Progress",
    description:
      "Post a progress update to the mobile app's task card. Non-blocking. " +
      "Use frequently during long operations.",
    inputSchema: z.object({
      message: z.string().min(1),
      phase: z.enum(["clarifying", "working", "deploying"]).default("working"),
      percent: z.number().min(0).max(100).optional(),
    }),
    outputSchema: z.object({
      delivered: z.boolean(),
    }),
  },
  withErrorHandling(async ({ message, phase, percent }, ctx) => {
    await getPocketBaseAdmin().collection("_agent_messages").create({
      taskId: ctx.taskId,
      direction: "agent_to_user",
      type: "progress",
      content: message,
      phase,
      percent,
    });
    return {
      content: [{ type: "text", text: `Progress: ${message}` }],
      structuredContent: { delivered: true },
    };
  })
);
```

---

## 8. Deploy Pipeline

`anyclaw_deploy` runs the pipeline below. Every step is atomic in isolation; failures at any step leave prod unchanged and surface a detailed `isError` response so the agent can fix and retry. The implementation lives in `packages/deploy/src/deploy-manager.ts` (from Plan 1) and is invoked by the tool handler.

### 8.1 Inputs

- `taskId` — from the per-task bearer token context.
- `versionDescription` — required, min 10 chars.
- `skipDbSnapshot` — default `false`.

Resolved from PocketBase / filesystem:

- `worktreePath = /data/dev/.worktrees/task-<taskId>` (created at task start by dispatcher per decision #36).
- `version` — next semver, computed as `latestVersion + 1 patch` from `_versions`.

### 8.2 Steps

**1. Update state.** Set `_tasks[taskId].state = "deploying"` and post a `deploy_event` progress message.

**2. Validation suite** (in `worktreePath`, sequential):

| Step | Command | Failure behavior |
|------|---------|------------------|
| Lint | `eslint logic/src frontend/src` | Collect stdout, abort pipeline |
| Typecheck | `tsc --noEmit` in both packages | Collect output, abort |
| Frontend build | `vite build` in `frontend/` | Collect output, abort |
| Smoke tests | `vitest run` | Collect output, abort |

On any failure the pipeline aborts and returns:

```typescript
{
  content: [
    { type: "text", text: `Deploy validation failed at step: ${failedStep}` },
    { type: "text", text: stdoutSnippet },
  ],
  isError: true,
  structuredContent: { validationResults: { lint, typecheck, build, smokeTests } },
}
```

No DB snapshot, commit, or merge has happened yet — prod is untouched.

**3. Database snapshot** (unless `skipDbSnapshot`).
`snapshotManager.create(\`pre-deploy-v${version}\`)` copies `pocketbase/pb_data/data.db` through SQLite's `VACUUM INTO` to a temp file, gzips it, moves it into `/data/.anyclaw/snapshots/`, and records it in the snapshot index. Returns `snapshotId`.

**4. Git commit in the worktree.**

```bash
git -C <worktreePath> add -A
git -C <worktreePath> -c user.email=agent@anyclaw -c user.name="AnyClaw Agent" \
    commit -m "<versionDescription>"
git -C <worktreePath> tag "v${version}"
```

Capture the commit SHA. If the worktree has no changes, abort with `ToolError("No changes to deploy")`.

**5. Merge worktree branch to `main`** (decision #36).

```bash
git -C /data/dev fetch .worktrees/task-<taskId>
git -C /data/dev merge --ff-only FETCH_HEAD     # or --no-ff for audit trail
git -C /data/dev tag "v${version}" <commitSha>
```

For MVP tasks are sequential (decision #1), so `--ff-only` always succeeds. If it fails, abort with a structured error and leave the worktree intact for inspection.

**6. Promote artifacts to prod.**

```
cp -a <worktreePath>/frontend/dist/.  /data/prod/frontend/
cp -a <worktreePath>/logic/dist/.     /data/prod/logic/
```

The copy is staged to `/data/prod/<component>.new/` then atomically renamed over the live directory to avoid serving half-written files.

**7. Restart prod logic service** (decision #28).

```bash
systemctl --user restart anyclaw-logic
```

Wait up to 10 seconds for the service to report `active (running)`. If it does not, trigger an automatic rollback to the previous `_versions` entry (Section 9) and return `isError: true` with the health-check output.

**8. Record the version.**

```typescript
await pb.collection("_versions").create({
  version: `v${version}`,
  description: versionDescription,
  gitCommit,
  gitTag: `v${version}`,
  dbSnapshotId: snapshotId ?? null,
  deployedBy: taskId,
  artifacts: { frontendPath: "/data/prod/frontend", logicPath: "/data/prod/logic" },
});
```

**9. Notify mobile app.** Write a `deploy_event` record to `_agent_messages`; PocketBase realtime pushes it and the mobile app reloads the WebView.

**10. Cleanup.**

```bash
git -C /data/dev worktree remove .worktrees/task-<taskId> --force
```

Mark `_tasks[taskId].state = "done"`, revoke the per-task bearer token, and return the success response.

### 8.3 Success Response

```typescript
{
  content: [{ type: "text", text: `Deployed v1.2.3: ${versionDescription}` }],
  structuredContent: {
    version: "v1.2.3",
    gitCommit: "abc1234...",
    gitTag: "v1.2.3",
    dbSnapshotId: "snap_20260405_120000",
    validationResults: { lint: true, typecheck: true, build: true, smokeTests: true },
  },
}
```

---

## 9. Rollback Pipeline

`anyclaw_rollback` (and the dispatch REST endpoint `POST /rollback`) run this pipeline. It is the user's emergency recovery path and must work even when the logic service is broken.

### 9.1 Steps

**1. Resolve target.** Look up the `_versions` row for the requested `version`. If not found, `ToolError("Unknown version")`.

**2. Safety snapshot.** `snapshotManager.create("pre-rollback-to-v${version}")`. If this fails, abort — we never roll back without a safety net.

**3. Git checkout in prod workspace.**

```bash
git -C /data/dev checkout v<version>
```

(We operate on `/data/dev` directly, not a worktree, because rollback is an infrastructure operation, not an agent task. No merge is performed — `HEAD` is left detached until the next successful deploy.)

**4. Restore database snapshot.** `snapshotManager.restore(targetVersion.dbSnapshotId)`:
   - Stop PocketBase (`systemctl --user stop pocketbase`).
   - Move current `pocketbase/pb_data/data.db` to `pocketbase/pb_data/data.db.pre-rollback`.
   - Gunzip the snapshot into `pocketbase/pb_data/data.db`.
   - Start PocketBase (`systemctl --user start pocketbase`) and wait for `/api/health` to return 200.

**5. Rebuild and promote.** Run `vite build` and `tsc` in the checked-out code and copy the artifacts to `/data/prod/frontend/` and `/data/prod/logic/` using the same atomic-rename pattern as deploy step 6.

**6. Restart prod logic service.** `systemctl --user restart anyclaw-logic`.

**7. Record the rollback.** Insert a new row into `_versions` with `description = "Rollback to v${version}"`, `gitCommit = target.gitCommit`, `dbSnapshotId = target.dbSnapshotId`. Rollback is just another version in the history.

**8. Notify mobile app.** Write a `deploy_event` to `_agent_messages`; mobile app reloads WebView.

### 9.2 Atomicity Guarantee

If any step fails, the pipeline halts and attempts to restore the pre-rollback state using the safety snapshot from step 2. The user is notified that rollback failed and the system is at a mixed state — in practice this means the dispatch server surfaces a hard error to the mobile app's emergency UI so the user can intervene manually.

---

## 10. Error Handling

### 10.1 Error Categories

| Category | Example | Handling |
|----------|---------|----------|
| Input validation | Missing field, invalid collection name | Zod rejects before the handler runs; SDK returns structured schema error |
| Authentication | Missing or unknown bearer token | Express middleware returns HTTP 401 before the MCP layer sees the request |
| Constraint violation | `create_collection` name starts with `_` | `ToolError` thrown in handler → `isError: true` |
| Infrastructure failure | PocketBase unreachable, git fails | Caught in wrapper, returned as `isError: true` with diagnostic detail |
| Validation failure | Lint/type/build/test errors in deploy | `anyclaw_deploy` returns `isError: true` with full output so the agent can self-correct |
| Timeout | `anyclaw_ask_user` waits too long | Returns `isError: true` with `timedOut: true` in structuredContent |
| Unknown / unexpected | Unhandled exception | Global wrapper returns `isError: true` with message and (in dev) stack trace |

### 10.2 ToolError Class and Wrapper

```typescript
// src/mcp-server/errors.ts
export class ToolError extends Error {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ToolError";
  }
}
```

```typescript
// src/mcp-server/tools/register.ts
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(handler: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (err) {
      const message = err instanceof ToolError
        ? err.message
        : `Internal error: ${err instanceof Error ? err.message : String(err)}`;
      const details = err instanceof ToolError ? err.details : undefined;
      return {
        content: [
          { type: "text", text: message },
          ...(details ? [{ type: "text", text: JSON.stringify(details, null, 2) }] : []),
        ],
        isError: true,
      };
    }
  }) as T;
}
```

### 10.3 PocketBase Recovery

If PocketBase is unreachable, the admin client retries with exponential backoff (3 attempts at 1s / 2s / 4s). Under supervised PocketBase restarts take ~2 seconds, so most transient failures recover on the first retry. If all retries fail, the tool returns `isError: true` instructing the agent to wait and retry.

### 10.4 Retry Semantics

- `anyclaw_deploy` and `anyclaw_rollback` are **not** idempotent (`idempotentHint: false`). The agent must inspect the error and decide whether to retry.
- `anyclaw_snapshot_db`, `anyclaw_list_versions`, `anyclaw_update_progress` are safe to retry.
- `anyclaw_ask_user` retrying creates a duplicate question — the agent should only retry on explicit timeout, not on other errors.
- `anyclaw_create_collection` is not idempotent; a retry against an existing collection will fail with a PocketBase 400 and be surfaced as `ToolError`.

---

## 11. File Structure

```
packages/mcp-server/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                     # mountMcp(app) — attached by dispatch server
    ├── auth.ts                      # per-task bearer token registry and middleware
    ├── env.ts                       # PROJECT_ROOT and PATHS constants
    ├── pocketbase-client.ts         # admin client singleton
    ├── errors.ts                    # ToolError class
    ├── task-checkpoint.ts           # TaskCheckpoint type
    ├── ask-user-protocol.ts         # anyclaw_ask_user implementation
    └── tools/
        ├── index.ts                 # registerAllTools(server, ctx)
        ├── register.ts              # withErrorHandling wrapper
        ├── create-collection.ts
        ├── deploy.ts
        ├── rollback.ts
        ├── snapshot-db.ts
        ├── list-versions.ts
        ├── ask-user.ts
        └── update-progress.ts

packages/deploy/                     # from Plan 1, consumed by tools
├── src/
│   ├── deploy-manager.ts            # DeployManager.run(...)
│   ├── rollback-manager.ts          # RollbackManager.run(version)
│   ├── snapshot-manager.ts          # create / restore / list
│   ├── version-store.ts             # reads/writes _versions
│   ├── worktree-manager.ts          # create/merge/remove worktrees
│   └── config.ts                    # ports, paths, shell command runners
```

`package.json`:

```json
{
  "name": "@anyclaw/mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "pocketbase": "^0.25.0",
    "zod": "^3.23.0",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "@types/express": "^4.17.0",
    "vitest": "^2.0.0",
    "msw": "^2.4.0"
  }
}
```

---

## 12. Testing Strategy

### 12.1 Unit Tests (vitest)

One file per tool under `src/tools/__tests__/`. Each test:

- Constructs a stub `deployManager` / `snapshotManager` / `PocketBase` client.
- Invokes the tool handler directly (not through MCP transport) with a fabricated `ctx = { taskId: "test-task" }`.
- Asserts on the returned `content`, `structuredContent`, and `isError`.

Representative test matrix:

| Tool | Key cases |
|------|-----------|
| `anyclaw_create_collection` | happy path, reserved name `_foo` rejected, snapshot failure aborts, PocketBase 400 surfaced |
| `anyclaw_deploy` | happy path, lint failure returns isError, typecheck failure, build failure, test failure, logic-service restart failure triggers rollback |
| `anyclaw_rollback` | happy path, unknown version, safety snapshot failure aborts, DB restore failure |
| `anyclaw_snapshot_db` | happy path, label too short, disk-full simulation |
| `anyclaw_list_versions` | empty list, limit bounds, PB unreachable retries then fails |
| `anyclaw_ask_user` | happy path, timeout, answer arrives after unsubscribe, pause-indefinitely (Infinity) |
| `anyclaw_update_progress` | happy path, PB create fails |

Auth middleware tests: valid token, missing header, unknown token, revoked token.

### 12.2 Integration Tests

A dedicated integration suite (`tests/integration/`) spins up the real dependencies:

- A real PocketBase binary in a tmp dir (seeded with `_tasks`, `_agent_messages`, `_versions` via the install script).
- A real git repo and worktree in a tmp dir with dummy `logic/` and `frontend/` packages.
- The real dispatch/MCP server Express app bound to an ephemeral port.
- A real `@modelcontextprotocol/sdk` **client** that issues tool calls over HTTP/SSE.

Scenarios:

1. **Full deploy happy path.** Seed a worktree with a trivial change, call `anyclaw_deploy`, assert `_versions` row exists, prod dirs updated, `_agent_messages` has a `deploy_event`.
2. **Deploy validation failure.** Introduce a type error, call `anyclaw_deploy`, assert `isError: true`, `_versions` untouched, prod untouched.
3. **Rollback round-trip.** Deploy v1, deploy v2, rollback to v1, assert prod artifacts match v1 and the DB snapshot was restored.
4. **ask_user round-trip.** Kick off `anyclaw_ask_user` in a background promise, simulate mobile app by POSTing an `answer` record to `_agent_messages`, assert the promise resolves with the answer.
5. **Task resume after restart.** Start a deploying task, SIGKILL the dispatch process, restart, assert the task moves to `failed` with `error: "server_restart"` (decision #40).
6. **Bearer token auth.** Call `/mcp` without a token (401), with a wrong token (401), with a revoked token (401), with a valid token (200).

### 12.3 What Is Mocked vs Real

| Dependency | Unit | Integration |
|------------|------|-------------|
| PocketBase | mocked (in-memory fake) | real binary |
| Filesystem / git | mocked via `memfs` + stub git runner | real tmp dir |
| `systemctl --user` | mocked | mocked (stub script on `$PATH`) — we do not want tests to touch real systemd |
| Agent subprocess | not invoked | not invoked — tests call MCP tools directly as a client |
| Vite / eslint / tsc / vitest | mocked command runner | real commands against a minimal fixture project |

### 12.4 CI Enforcement

- `npm run test` runs unit + integration suites.
- Coverage threshold: 85% lines for `src/tools/`.
- A smoke test exercises `POST /mcp` with the `tools/list` JSON-RPC call and asserts the seven expected tool names are present, guarding against accidental tool removal.
