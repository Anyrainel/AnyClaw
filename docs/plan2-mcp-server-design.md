# Plan 2: MCP Server — Technical Design

## Overview

The AnyClaw MCP server exposes the AnyClaw infrastructure (PocketBase, Node.js logic service, Vite+React frontend, deployment pipeline) as MCP tools that any compatible coding agent can call. This document specifies the protocol details, tool schemas, constraint enforcement, mobile app communication, and error handling.

**Depends on:** Plan 1 (Server Infrastructure) — the MCP server wraps the deploy manager, snapshot manager, version store, and project structure built in Plan 1.

**Architecture context:** Per the main spec's "Process Architecture" section and locked decisions #8, #22, #23, AnyClaw is NOT split across multiple containers. All services run as supervised processes on a single host (or inside one cloud container running supervisord). The coding agent is a transient subprocess that runs natively and uses its own built-in file and shell tools. The MCP server adds value only where the agent's native capabilities are insufficient or dangerous — deploy, rollback, DB snapshots, PocketBase collection management, and user communication.

---

## 1. MCP Protocol Details

### SDK and Runtime

- **SDK:** `@modelcontextprotocol/sdk` (v1.x stable branch). The v2 release is pre-alpha as of early 2026; we use v1.x for production stability and upgrade when v2 stabilizes.
- **Schema validation:** `zod` (v3) for tool input/output schemas, as required by the SDK.
- **Runtime:** Node.js 18+ with TypeScript (ESM, `NodeNext` module resolution per SDK requirements).

### Transport: HTTP/SSE on Localhost

The MCP server uses HTTP/SSE (Streamable HTTP) as its sole transport. This is a locked decision — no stdio mode.

**Rationale:** The MCP server runs as an independent supervised process (alongside PocketBase, the tunnel manager, the logic service, etc.). The agent is a transient subprocess spawned per task. HTTP/SSE decouples the agent lifecycle from the MCP server lifecycle — the MCP server keeps running across many agent runs, and the agent simply connects to a stable endpoint at spawn time. This model is also cloud-ready from day one: the same code works whether everything runs on a developer's laptop, a self-hosted VPS, or a per-user cloud container.

**Binding:** The MCP HTTP endpoint binds to `127.0.0.1:4100` by default (loopback only — never exposed on the public network). Cloud deployments may additionally bind a unix domain socket at `/run/anyclaw/mcp.sock` for lower latency and stronger isolation; agents connect via either transport.

```typescript
// src/mcp-server/index.ts
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools } from "./tools/index.js";

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const server = new McpServer(
    { name: "anyclaw", version: "1.0.0" },
    {
      instructions: [
        "AnyClaw MCP server. You already have native file and shell tools — use them freely in the dev workspace.",
        "Use AnyClaw MCP tools for operations that affect production: anyclaw_deploy, anyclaw_rollback, anyclaw_snapshot_db.",
        "Use anyclaw_create_collection for PocketBase schema changes (never edit PocketBase data files directly).",
        "A version description is required for every deployment.",
        "Use anyclaw_ask_user to clarify requirements before building.",
        "Use anyclaw_update_progress to keep the user informed.",
      ].join(" "),
    }
  );
  registerAllTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.listen(4100, "127.0.0.1", () => {
  console.log("AnyClaw MCP HTTP transport on 127.0.0.1:4100");
});
```

### Process Placement

The MCP server runs as a **supervised process** under supervisord / systemd / pm2 (whichever the host uses). Its restart policy is `restart=always` — if it crashes, the supervisor brings it back within seconds. It is part of the stable infrastructure layer alongside PocketBase, the tunnel manager, and the dispatch server. In the minimal deployment the dispatch/MCP server is a single process that exposes both the dispatch REST API (task submission, rollback, version history) and the `/mcp` endpoint; larger deployments may split them but the source tree is the same.

**Critical property:** The MCP server's source files live in `.anyclaw/` (or an equivalent infrastructure directory) on disk, which is **outside the agent's writable path**. The agent's dev workspace is `dev/`. Path guards in the MCP server reject any write to `.anyclaw/`, `prod/`, or `pocketbase/pb_data/`. This means even if the agent tries to break the MCP server or overwrite its code, it cannot — the supervised MCP server keeps running, and the user can always issue an emergency rollback through it.

**cgroup limits on the agent:** The agent subprocess is launched inside a cgroup (Linux) or job object (Windows, via equivalent mechanism) with bounded CPU and memory. A runaway command spawned by the agent cannot starve the MCP server, PocketBase, or the tunnel manager — the kernel enforces the cap. This is what replaces the earlier "sandbox container."

### Agent Registration

The dispatch server configures the agent at spawn time. Because the agent runs on the same host as the MCP server, it connects to the loopback endpoint.

**Claude Code:** The dispatch server writes a project-scoped `.mcp.json` before spawning `claude -p`:
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

**OpenClaw:** The dispatch server sets OpenClaw's MCP config to the same URL before spawning the agent.

**Generic agents:** Any agent that understands Streamable HTTP MCP can point at `http://127.0.0.1:4100/mcp`.

---

## 2. Tool Definitions

All tools live under `packages/mcp-server/src/tools/`. Each tool is a separate file exporting a registration function. The `registerAllTools` function wires them all to the `McpServer` instance.

### Environment Configuration

The MCP server reads a single environment variable, `ANYCLAW_PROJECT_ROOT`, which points to the AnyClaw server directory. All paths are derived from this root. The server loads the project config from `packages/deploy/src/config.ts` to get port numbers, PocketBase URLs, and path constants.

```typescript
// src/mcp-server/env.ts
import path from "node:path";

export const PROJECT_ROOT = process.env.ANYCLAW_PROJECT_ROOT
  ?? path.resolve(import.meta.dirname, "../../../");

export const PATHS = {
  anyclawInfra: path.join(PROJECT_ROOT, ".anyclaw"),   // MCP server, dispatch, supervisor configs
  devLogic:     path.join(PROJECT_ROOT, "dev/logic"),
  devFrontend:  path.join(PROJECT_ROOT, "dev/frontend"),
  prodLogic:    path.join(PROJECT_ROOT, "prod/logic"),
  prodFrontend: path.join(PROJECT_ROOT, "prod/frontend"),
  pbData:       path.join(PROJECT_ROOT, "pocketbase/pb_data"),
  pbMigrations: path.join(PROJECT_ROOT, "pocketbase/pb_migrations"),
} as const;
```

---

### Tool Philosophy: Additive, Not Duplicative

Per locked decisions #5 and #23, the MCP server does **not** duplicate capabilities the agent already has natively:

- **No `anyclaw_read_file` / `anyclaw_write_file`** — the agent's own file tools are perfectly capable of operating in the `dev/` workspace. cgroup limits and filesystem path guards (enforced at the OS level via unix permissions on `.anyclaw/`, `prod/`, and `pocketbase/pb_data/`) prevent writes outside the dev workspace.
- **No `anyclaw_run_command`** — the agent already spawns subprocesses. cgroup limits cap resource usage. The dispatch server tails the agent's stdout/stderr for activity logging.
- **No scaffolding tools** (`create_page`, `create_api_route`, `create_job`) — agents create files with high success rates using their built-in tools. Convention enforcement is via the skill suite, not MCP.

The MCP server exists for operations agents tend to get wrong or that require infrastructure coordination:

- `anyclaw_deploy` — validation + commit + promote pipeline
- `anyclaw_rollback` — atomic code + DB revert
- `anyclaw_snapshot_db` — manual DB backup
- `anyclaw_list_versions` — deployment history
- `anyclaw_create_collection` — PocketBase collection management (the PocketBase admin API is error-prone for agents; this tool adds validation and a mandatory pre-change snapshot)
- `anyclaw_ask_user` — clarifying question to the mobile app (cannot be done with a native shell tool)
- `anyclaw_update_progress` — progress update to the mobile app (cannot be done with a native shell tool)

Each tool is a chokepoint where safety is enforced: mandatory DB snapshots, mandatory validation, mandatory version descriptions, mandatory path guards inside `create_collection`.

### 2.1 anyclaw_create_collection

Defines a new PocketBase collection (database table) via the PocketBase admin API. The agent never touches PocketBase files directly.

```typescript
server.registerTool(
  "anyclaw_create_collection",
  {
    title: "Create Collection",
    description:
      "Create a new PocketBase collection (database table) via the admin API. " +
      "Automatically snapshots the database before schema changes.",
    inputSchema: z.object({
      name: z.string().describe("Collection name in snake_case, e.g. 'mood_entries'"),
      type: z.enum(["base", "auth", "view"]).default("base").describe("Collection type"),
      fields: z.array(
        z.object({
          name: z.string().describe("Field name"),
          type: z.enum([
            "text", "number", "bool", "email", "url", "date",
            "select", "json", "file", "relation", "editor",
          ]).describe("PocketBase field type"),
          required: z.boolean().default(false),
          options: z.record(z.unknown()).optional().describe(
            "Type-specific options, e.g. { maxSelect: 1, values: ['low','med','high'] } for select fields"
          ),
        })
      ).describe("Array of field definitions"),
      listRule: z.string().nullable().optional().describe("PocketBase list rule (null = admin only, '' = public)"),
      viewRule: z.string().nullable().optional().describe("PocketBase view rule"),
      createRule: z.string().nullable().optional().describe("PocketBase create rule"),
      updateRule: z.string().nullable().optional().describe("PocketBase update rule"),
      deleteRule: z.string().nullable().optional().describe("PocketBase delete rule"),
    }),
    outputSchema: z.object({
      collectionId: z.string(),
      collectionName: z.string(),
      fieldsCreated: z.number(),
    }),
  },
  async ({ name, type, fields, ...rules }) => {
    // 1. Snapshot DB before schema change (mandatory)
    // 2. POST to PocketBase admin API: POST /api/collections
    // 3. Return the created collection metadata
    return {
      content: [{ type: "text", text: `Created collection '${name}' with ${fields.length} fields` }],
      structuredContent: { collectionId: "...", collectionName: name, fieldsCreated: fields.length },
    };
  }
);
```

### 2.2 anyclaw_deploy

The most critical tool. Runs the full validation-commit-promote pipeline.

```typescript
server.registerTool(
  "anyclaw_deploy",
  {
    title: "Deploy to Production",
    description:
      "Validate dev environment (lint, typecheck, build, smoke tests), commit to git, " +
      "snapshot the database, and promote to production. The user's WebView reloads automatically. " +
      "REQUIRES a version description that a non-technical user can understand.",
    inputSchema: z.object({
      versionDescription: z.string().min(10).describe(
        "User-facing description of what changed, e.g. 'Added a mood tracker with daily check-ins and trend charts'. " +
        "Must be understandable by a non-developer. Minimum 10 characters."
      ),
      skipDbSnapshot: z.boolean().default(false).describe(
        "Skip the pre-deploy database snapshot. Only set true if this deploy has zero schema changes."
      ),
    }),
    outputSchema: z.object({
      version: z.string(),
      gitCommit: z.string(),
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
  async ({ versionDescription, skipDbSnapshot }) => {
    // Implementation delegates to the deploy manager from Plan 1:
    //
    // 1. Run validation suite in dev/ (the MCP server shells out directly — it
    //    lives in the same filesystem as the agent's dev workspace):
    //    - eslint (packages/logic/src + packages/frontend/src)
    //    - tsc --noEmit (both packages)
    //    - vite build (frontend)
    //    - smoke tests (vitest run)
    //    If ANY step fails, return isError with details.
    //
    // 2. Snapshot DB (unless skipDbSnapshot):
    //    - Call snapshotManager.create(versionDescription)
    //
    // 3. Git commit:
    //    - git add -A in dev/
    //    - git commit with versionDescription
    //    - git tag with version number
    //
    // 4. Promote to prod:
    //    - Copy frontend build artifacts to prod/frontend/
    //    - Copy compiled logic service to prod/logic/
    //    - Signal supervisor to restart the prod logic service process
    //
    // 5. Notify mobile app:
    //    - Write a record to PocketBase `_deployments` collection
    //    - PocketBase realtime subscription pushes the event to the mobile app
    //    - Mobile app reloads WebView
    //
    // Return version metadata
    return {
      content: [{ type: "text", text: `Deployed v1.2.3: ${versionDescription}` }],
      structuredContent: {
        version: "1.2.3",
        gitCommit: "abc1234",
        dbSnapshotId: "snap_20260405_120000",
        validationResults: { lint: true, typecheck: true, build: true, smokeTests: true },
      },
    };
  }
);
```

### 2.3 anyclaw_rollback

Reverts to a specific version (code + database atomically).

```typescript
server.registerTool(
  "anyclaw_rollback",
  {
    title: "Rollback to Version",
    description:
      "Revert production to a specific version. Restores both code (git checkout) and database " +
      "(SQLite snapshot) atomically. The current state is snapshotted first as a safety net.",
    inputSchema: z.object({
      version: z.string().describe("Version identifier to rollback to, e.g. 'v1.2.0' or a git tag"),
    }),
    outputSchema: z.object({
      rolledBackTo: z.string(),
      safetySnapshotId: z.string(),
    }),
    annotations: { destructiveHint: true },
  },
  async ({ version }) => {
    // 1. Snapshot current state (safety net before rollback)
    // 2. git checkout <version> in dev/
    // 3. Restore DB snapshot associated with that version
    // 4. Re-promote to prod (copy build artifacts)
    // 5. Signal supervisor to restart the prod logic service process
    // 6. Notify mobile app to reload
    return {
      content: [{ type: "text", text: `Rolled back to ${version}` }],
      structuredContent: { rolledBackTo: version, safetySnapshotId: "snap_safety_..." },
    };
  }
);
```

Note: the same rollback logic is reachable via the dispatch server's `POST /rollback` REST endpoint so the mobile app can always recover even if no agent is running.

### 2.4 anyclaw_snapshot_db

Creates a manual database backup.

```typescript
server.registerTool(
  "anyclaw_snapshot_db",
  {
    title: "Snapshot Database",
    description:
      "Create a compressed SQLite database snapshot. Called automatically before schema migrations, " +
      "but also available manually for risky operations like bulk data changes.",
    inputSchema: z.object({
      label: z.string().describe("Short label for this snapshot, e.g. 'before-mood-data-migration'"),
    }),
    outputSchema: z.object({
      snapshotId: z.string(),
      sizeBytes: z.number(),
      path: z.string(),
    }),
  },
  async ({ label }) => {
    // Delegates to snapshotManager.create(label) from Plan 1
    return {
      content: [{ type: "text", text: `Snapshot created: ${label}` }],
      structuredContent: { snapshotId: "snap_...", sizeBytes: 102400, path: "..." },
    };
  }
);
```

### 2.5 anyclaw_list_versions

Shows deployment history with descriptions.

```typescript
server.registerTool(
  "anyclaw_list_versions",
  {
    title: "List Versions",
    description: "Show deployment history with version descriptions, timestamps, and snapshot references.",
    inputSchema: z.object({
      limit: z.number().default(10).describe("Max number of versions to return"),
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
  async ({ limit }) => {
    // Delegates to versionStore.list(limit) from Plan 1
    return {
      content: [{ type: "text", text: "Listing last N versions..." }],
      structuredContent: { versions: [] },
    };
  }
);
```

### 2.6 anyclaw_ask_user

Posts a clarifying question to the mobile app and waits for the user's answer. This is the bridge between the agent and the user during task execution. It cannot be replaced by a native shell tool because it requires access to the PocketBase message bus and the task-session context held by the MCP server.

```typescript
server.registerTool(
  "anyclaw_ask_user",
  {
    title: "Ask User",
    description:
      "Post a clarifying question to the mobile app and wait for the user's answer. " +
      "Use this when requirements are ambiguous. The tool blocks until the user responds " +
      "or the timeout expires.",
    inputSchema: z.object({
      question: z.string().describe("The question to ask the user"),
      options: z.array(z.string()).optional().describe(
        "Optional preset answer options for the user to choose from, e.g. ['Daily', 'Multiple times per day']"
      ),
      timeoutMs: z.number().default(300000).describe("How long to wait for a response (default 5 minutes, max 10 minutes)"),
    }),
    outputSchema: z.object({
      answer: z.string(),
      answeredAt: z.string(),
      timedOut: z.boolean(),
    }),
  },
  async ({ question, options, timeoutMs }) => {
    // See Section 4 for communication protocol details
    // 1. Write question record to PocketBase `_agent_messages` collection
    // 2. PocketBase realtime pushes notification to mobile app
    // 3. Subscribe (or poll) `_agent_messages` for the user's reply
    // 4. Return answer or timeout
    return {
      content: [{ type: "text", text: `User answered: "..."` }],
      structuredContent: { answer: "...", answeredAt: "2026-04-05T12:00:00Z", timedOut: false },
    };
  }
);
```

### 2.7 anyclaw_update_progress

Posts a progress update to the mobile app's task card.

```typescript
server.registerTool(
  "anyclaw_update_progress",
  {
    title: "Update Progress",
    description:
      "Post a progress update to the mobile app's task card. Non-blocking — fires and returns immediately. " +
      "Use frequently during long operations to keep the user informed.",
    inputSchema: z.object({
      message: z.string().describe("Progress message, e.g. 'Creating database collections...'"),
      phase: z.enum(["clarifying", "working", "deploying"]).default("working").describe(
        "Current task phase — determines the UI state of the task card"
      ),
      percent: z.number().min(0).max(100).optional().describe("Optional progress percentage"),
    }),
    outputSchema: z.object({
      delivered: z.boolean(),
    }),
  },
  async ({ message, phase, percent }) => {
    // 1. Write progress record to PocketBase `_agent_messages` collection
    // 2. PocketBase realtime pushes to mobile app immediately
    // 3. Return without blocking
    return {
      content: [{ type: "text", text: `Progress: ${message}` }],
      structuredContent: { delivered: true },
    };
  }
);
```

---

## 3. Constraint Enforcement

The MCP server is the chokepoint for operations that require infrastructure coordination. It enforces the following safety constraints; complementary constraints are enforced by the operating system (unix permissions, cgroups) because the agent's native tools run outside the MCP server's visibility.

### 3.1 Dev-Only Writes (OS-Enforced)

**Rule:** The agent can only modify files in the `dev/` workspace. It cannot touch `.anyclaw/`, `prod/`, `pocketbase/pb_data/`, or any file outside the project root.

**Implementation:** Because the agent uses its own native file tools (not an MCP-provided wrapper), this rule is enforced at the **filesystem permission** level, not in MCP guard code:

- The agent subprocess runs as an unprivileged OS user (e.g., `anyclaw-agent`).
- `.anyclaw/`, `prod/`, and `pocketbase/pb_data/` are owned by a different user (e.g., `anyclaw-infra`) with `750` permissions — the agent user has no write access.
- `dev/` is group-writable by the `anyclaw-agent` user.
- On Windows, equivalent ACLs are applied.

This gives stronger guarantees than the old path-check approach because it also protects against traversal via symlinks, relative paths inside shell scripts, or any other workaround the agent might discover. The MCP tools that DO touch `prod/` or `.anyclaw/` (e.g., `anyclaw_deploy` promoting build artifacts) run in the MCP server process, which is owned by `anyclaw-infra` and has the necessary permissions.

### 3.2 PocketBase Admin API Only

**Rule:** PocketBase is accessed exclusively through its admin REST API. The agent never reads or writes PocketBase data files directly.

**Implementation:** Two layers:

1. `pocketbase/pb_data/` is not writable by the agent user (see 3.1), so direct file access is blocked by the kernel.
2. The `anyclaw_create_collection` tool provides a safe, snapshotted path for schema changes. The tool uses an API-token-authenticated admin client.

```typescript
// src/mcp-server/pocketbase-client.ts
import PocketBase from "pocketbase";

let pbAdmin: PocketBase | null = null;

export async function getPocketBaseAdmin(): Promise<PocketBase> {
  if (!pbAdmin) {
    pbAdmin = new PocketBase(process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090");
    // Use API token auth (not email/password) — more secure for programmatic access
    pbAdmin.authStore.save(process.env.PB_ADMIN_TOKEN!);
  }
  return pbAdmin;
}
```

The PocketBase admin token is stored in `.anyclaw/` (not readable by the agent user) and injected into the MCP server via environment variable by supervisord.

### 3.3 Runaway Command Containment

**Rule:** Commands the agent spawns (compilation, tests, dev servers, etc.) cannot starve the supervised infrastructure processes.

**Implementation:** cgroup limits (Linux) on the agent subprocess:

- **CPU:** configurable, default ~75% of available cores.
- **Memory:** configurable, default 2 GB hard limit. OOM-kill on excess.
- **PIDs:** capped to prevent fork bombs.
- **I/O:** optional blkio weight to prioritize PocketBase and tunnel manager.

The dispatch server creates the cgroup (via systemd slice, `cgcreate`, or the equivalent) before `execve`-ing the agent binary so all descendants inherit the limits. On Windows, Job Objects provide equivalent capabilities.

There is no MCP-level command blocklist — the agent's native shell tool is not routed through MCP. Observability comes from the dispatch server tailing the agent's stdout/stderr into the activity log.

### 3.4 Validation Before Deploy

**Rule:** `anyclaw_deploy` MUST run the full validation suite. No shortcut.

The deploy tool delegates to `DeployManager.validate()` from Plan 1, which runs in sequence:
1. `eslint` on `dev/logic/src` and `dev/frontend/src`
2. `tsc --noEmit` on both packages
3. `vite build` for the frontend
4. `vitest run` for smoke tests

If any step fails, the tool returns `isError: true` with the validation output. The agent can read the errors and fix them, then try again. No code reaches production without all four checks passing.

### 3.5 Mandatory DB Snapshot Before Schema Migration

**Rule:** Any tool that modifies the PocketBase schema must snapshot the database first.

`anyclaw_create_collection` calls `snapshotManager.create()` unconditionally before issuing the admin API call. The snapshot label is auto-generated: `pre-schema-{collectionName}-{timestamp}`.

`anyclaw_deploy` takes a snapshot by default (controlled by `skipDbSnapshot` flag, which the agent can set to `true` only for deploys with no schema changes).

### 3.6 Required Version Description

**Rule:** Every deployment must have a user-facing version description.

Enforced by the Zod schema: `versionDescription: z.string().min(10)`. The SDK validates inputs before the handler runs, so a missing or too-short description is rejected at the protocol level with a schema validation error. The description in the `anyclaw_deploy` tool definition instructs the agent to write a non-technical description. The `anyclaw-describe-version` skill (from the skill suite) provides additional guidance.

---

## 4. Communication with Mobile App

The MCP server communicates with the mobile app through PocketBase as the message bus. PocketBase provides realtime SSE subscriptions out of the box, which the mobile app already uses for data. This avoids adding a separate WebSocket server.

### Message Collection Schema

A PocketBase collection `_agent_messages` stores all agent-to-user and user-to-agent messages:

```
Collection: _agent_messages
Fields:
  - taskId      (text, required)      — groups messages by task
  - direction   (select: "agent_to_user" | "user_to_agent", required)
  - type        (select: "question" | "answer" | "progress" | "deploy_event", required)
  - content     (text, required)      — message text
  - options     (json, optional)      — answer options for questions
  - phase       (select: "clarifying" | "working" | "deploying", optional)
  - percent     (number, optional)    — progress percentage
  - answeredAt  (date, optional)      — when the user answered
  - createdAt   (auto)
```

Access rules: the `_agent_messages` collection is readable/writable by authenticated users only (the mobile app authenticates with PocketBase).

### Communication Flow

**anyclaw_ask_user (question and answer):**

```
Agent calls anyclaw_ask_user("Daily check-in or multiple times?", ["Daily", "Multiple"])
  │
  ▼
MCP Server writes to _agent_messages:
  { taskId, direction: "agent_to_user", type: "question",
    content: "Daily check-in or multiple times?", options: ["Daily", "Multiple"] }
  │
  ▼
PocketBase realtime pushes SSE event to mobile app
  │
  ▼
Mobile app shows question card with option buttons
  │
  ▼
User taps "Daily"
  │
  ▼
Mobile app writes to _agent_messages:
  { taskId, direction: "user_to_agent", type: "answer", content: "Daily" }
  │
  ▼
MCP Server subscribes to _agent_messages via PocketBase SDK and receives the answer
  │
  ▼
MCP Server returns { answer: "Daily", timedOut: false } to agent
```

**anyclaw_update_progress (fire-and-forget):**

```
Agent calls anyclaw_update_progress("Creating database collections...", "working", 30)
  │
  ▼
MCP Server writes to _agent_messages:
  { taskId, direction: "agent_to_user", type: "progress",
    content: "Creating database collections...", phase: "working", percent: 30 }
  │
  ▼
PocketBase realtime pushes SSE event to mobile app
  │
  ▼
Mobile app updates task card progress spinner and message
  │
  ▼
MCP Server returns { delivered: true } immediately (non-blocking)
```

### Why PocketBase Realtime SSE + REST

This is a locked decision. PocketBase Realtime SSE handles server-to-client push (progress updates, clarifying questions), and REST POST handles client-to-server responses (answers, commands). This applies to both `anyclaw_ask_user` and `anyclaw_update_progress`.

1. **Already exists.** PocketBase runs as part of the infrastructure. No additional server to maintain.
2. **SSE is firewall-friendly.** Works through HTTP proxies, no special port needed.
3. **Single source of truth.** Messages are persisted in the database. If the mobile app disconnects and reconnects, it can query for missed messages. Task state survives app close/reopen.
4. **The mobile app already uses PocketBase** for data fetching. Adding a subscription is a single SDK call:

```typescript
// Mobile app (React Native)
const pb = new PocketBase("https://server-url");

// Subscribe to agent messages for the current task
pb.collection("_agent_messages").subscribe("*", (event) => {
  if (event.record.taskId === currentTaskId && event.record.direction === "agent_to_user") {
    if (event.record.type === "question") {
      showQuestionCard(event.record.content, event.record.options);
    } else if (event.record.type === "progress") {
      updateProgressCard(event.record.content, event.record.phase, event.record.percent);
    }
  }
}, { filter: `taskId = "${currentTaskId}" && direction = "agent_to_user"` });
```

### Task ID Propagation

Since the MCP server uses HTTP/SSE transport (not stdio), the task ID is passed per-session rather than as a process environment variable. The dispatch server (which spawns the agent) establishes the MCP session with the task ID in the session metadata before handing control to the agent. The MCP server extracts it from the session context and makes it available to all tool handlers.

```typescript
// src/mcp-server/task-context.ts

// Task ID is extracted from the MCP session metadata set when the dispatch server
// pre-creates the session on behalf of the agent.
const sessionTaskMap = new Map<string, string>();

export function setTaskIdForSession(sessionId: string, taskId: string): void {
  sessionTaskMap.set(sessionId, taskId);
}

export function getTaskId(sessionId: string): string {
  const taskId = sessionTaskMap.get(sessionId);
  if (!taskId) {
    throw new ToolError(
      "No task context for this session. The dispatch server must provide a taskId."
    );
  }
  return taskId;
}
```

### Task State Persistence and Resume

Task state is persisted in PocketBase so that tasks survive MCP server restarts and host reboots. The dispatch server writes task state transitions (queued, clarifying, working, deploying, done, failed) to a `_tasks` collection. When the dispatch server starts, it checks for any task in an incomplete state and resumes it.

```
Collection: _tasks
Fields:
  - taskId       (text, required, unique)  — task identifier
  - request      (text, required)          — original user request
  - state        (select: "queued" | "clarifying" | "working" | "deploying" | "done" | "failed", required)
  - agentType    (text, required)          — which adapter dispatched this task
  - checkpoint   (json, optional)          — agent-specific resume data (e.g., conversation history, last completed step)
  - error        (text, optional)          — failure reason if state is "failed"
  - createdAt    (auto)
  - updatedAt    (auto)
```

**Resume flow:**
1. On startup, the dispatch server queries `_tasks` for records where `state` is not "done" or "failed".
2. For each incomplete task, the adapter re-spawns the agent subprocess with the original request and checkpoint data.
3. The agent uses the checkpoint to skip already-completed work (e.g., if collections were already created, it proceeds to implementation).
4. If resume fails, the task is marked "failed" with a reason, and the user is notified.

---

## 5. Error Handling

### Error Categories

| Category | Example | Handling |
|----------|---------|----------|
| **Input validation** | Missing required field, invalid collection name | Zod schema rejects before handler runs. SDK returns structured error to agent. |
| **Constraint violation** | create_collection called without snapshot permissions | `ToolError` thrown in guard. Returned as `isError: true` with explanation. |
| **Infrastructure failure** | PocketBase unreachable, git command fails | Caught in handler, returned as `isError: true` with diagnostic info. |
| **Validation failure** | Lint errors, type errors, failed tests | `anyclaw_deploy` returns `isError: true` with the full validation output so the agent can fix issues. |
| **Timeout** | `anyclaw_ask_user` waits too long | Returns `isError: true` with timeout message. Agent can retry or proceed without user input. |
| **Unknown/unexpected** | Unhandled exception in tool handler | Global catch wrapper returns `isError: true` with error message and stack trace. |

### ToolError Class

A custom error class that produces clean `isError` responses:

```typescript
// src/mcp-server/errors.ts
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ToolError";
  }
}
```

### Global Error Wrapper

Every tool handler is wrapped to catch unhandled exceptions:

```typescript
// src/mcp-server/tools/register.ts
import { ToolError } from "../errors.js";

type ToolHandler = (...args: any[]) => Promise<any>;

export function withErrorHandling(handler: ToolHandler): ToolHandler {
  return async (...args) => {
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
  };
}
```

### Validation Failure Detail

When `anyclaw_deploy` fails validation, the error response includes the full output from each failing step so the agent can self-correct:

```typescript
// Example isError response from a failed deploy
{
  content: [
    {
      type: "text",
      text: "Deploy validation failed at step: typecheck"
    },
    {
      type: "text",
      text: "dev/frontend/src/pages/MoodTracker.tsx(14,5): error TS2322: " +
            "Type 'string' is not assignable to type 'number'."
    }
  ],
  isError: true
}
```

### PocketBase Connection Recovery

If PocketBase is unreachable (e.g., the process crashed and supervisord is restarting it), the MCP server retries with exponential backoff (3 attempts, 1s/2s/4s delays). If all retries fail, the tool returns an `isError` response instructing the agent to wait and retry. In practice PocketBase restarts in ~2 seconds under supervisord, so most transient failures recover on the first retry.

---

## 6. Package Structure

The MCP server lives as a new package in the monorepo established by Plan 1:

```
anyclaw-server/
├── .anyclaw/                          # infrastructure, NOT in agent's writable path
│   ├── supervisord.conf               # process supervision config
│   ├── mcp-token                       # bearer token for MCP auth
│   └── pb-admin-token                  # PocketBase admin API token
├── packages/
│   ├── mcp-server/                    # THIS PLAN
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # HTTP/SSE entrypoint (loopback bind)
│   │       ├── env.ts                 # Project paths and config
│   │       ├── task-context.ts        # Task ID management (per-session)
│   │       ├── errors.ts              # ToolError class
│   │       ├── pocketbase-client.ts   # PB admin client singleton (API token auth)
│   │       └── tools/
│   │           ├── index.ts           # registerAllTools()
│   │           ├── create-collection.ts
│   │           ├── deploy.ts
│   │           ├── rollback.ts
│   │           ├── snapshot-db.ts
│   │           ├── list-versions.ts
│   │           ├── ask-user.ts
│   │           └── update-progress.ts
│   ├── deploy/                        # From Plan 1 — imported by deploy.ts, rollback.ts, etc.
│   ├── logic/                         # From Plan 1 — agent writes code here
│   └── frontend/                      # From Plan 1 — agent writes code here
```

Note that there are no `read-file.ts`, `write-file.ts`, or `run-dev.ts` tool files — those capabilities are provided by the agent's native tools.

**package.json:**
```json
{
  "name": "@anyclaw/mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js"
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
    "vitest": "^2.0.0"
  }
}
```

---

## 7. Resolved Questions

The following questions from earlier revisions are now resolved:

- **Q1 (Task ID lifecycle):** Resolved. HTTP/SSE is the only transport. Task ID is passed via MCP session metadata set by the dispatch server (see Section 4, Task ID Propagation).
- **Q2 (ask_user polling vs. realtime):** Resolved. PocketBase Realtime SSE + REST is the locked communication mechanism. The MCP server uses the PocketBase Node SDK's subscription API to receive the user's answer.
- **Q3 (Scaffold vs. raw file tools):** Resolved. No scaffold tools and no raw file tools. Agents use their own built-in file tools in the `dev/` workspace. Convention enforcement is via the skill suite; write-scope enforcement is via OS permissions.
- **Q4 (Command blocklist):** Resolved / obsolete. The MCP server does not execute shell commands on the agent's behalf — the agent uses its native shell tool. Resource starvation is prevented by cgroup limits instead.
- **Q5 (PocketBase credentials):** Resolved. PocketBase API tokens (not email/password). Stored in `.anyclaw/` and injected via environment variable `PB_ADMIN_TOKEN`.
- **Q6 (Sandbox container exec API):** Resolved / obsolete. There is no sandbox container and no exec API. The earlier three-container architecture has been replaced with supervised processes on a single host.
- **Q7 (Cross-container volume sharing):** Resolved / obsolete. All processes share the same filesystem because they share the same host.
- **Q8 (Docker socket access for exec):** Resolved / obsolete. No container-to-container exec; no Docker socket is needed by the MCP server.

---

## 8. New Gaps

Technical decisions that remain open under the new supervised-process architecture. Each needs resolution before implementation.

### G1: MCP Authentication on the Loopback Endpoint

Even though the MCP server binds to `127.0.0.1`, any process on the host can reach it. On a single-user self-hosted machine this is usually fine, but in a cloud container running multiple services (dispatch, tunnel manager, prod logic service, etc.) we want defense in depth: the logic service should not be able to reach the MCP endpoint, even accidentally.

**Question:** How does the agent authenticate to the MCP endpoint?

**Options:**
- **(A)** Bearer token in `Authorization` header. The token is generated on MCP server start, written to `.anyclaw/mcp-token` (readable only by `anyclaw-infra` and the dispatch server), and injected into the agent subprocess environment by the dispatch server at spawn time. Simple, sufficient for both self-hosted and cloud.
- **(B)** Unix domain socket at `/run/anyclaw/mcp.sock` with filesystem permissions (mode `660`, group `anyclaw-agent`). No token needed — the kernel enforces access. Works on Linux and macOS; Windows support is messier.
- **(C)** Hybrid: loopback HTTP with bearer token by default; unix socket enabled via config for stricter deployments.

### G2: Task Checkpoint Schema for Resume

Task persistence requires saving enough state to resume after restart. The `checkpoint` field in `_tasks` is typed as JSON, but the actual schema depends on what agents need.

**Question:** What goes in the checkpoint? How agent-specific is it?

**Options:**
- **(A)** Agent-agnostic minimal checkpoint: `{ lastCompletedStep: "collections_created" | "implementation" | "testing" | "deploying", filesModified: string[] }`. The agent uses this as a hint to skip work but re-reads the actual file state on resume.
- **(B)** Agent-specific opaque blob: the adapter serializes whatever the agent needs (e.g., Claude Code conversation history, OpenClaw session state). The dispatch server stores it but does not interpret it.
- **(C)** Hybrid: agent-agnostic step tracking (A) plus an optional agent-specific blob (B). The dispatch server uses the step tracking for UI, the agent uses the blob for internal state.

### G3: cgroup Configuration Across Host Operating Systems

The agent subprocess needs resource limits, but the mechanism differs by OS: cgroup v2 on modern Linux, cgroup v1 on older Linux, Job Objects on Windows, resource limits via `launchd` on macOS (less granular). The self-hosted install target includes all three OSes.

**Question:** How do we abstract resource limits across OSes, and what is the MVP target?

**Options:**
- **(A)** Linux-only MVP. Self-hosted install requires Linux (or WSL2 on Windows, or a Linux VM on macOS). Cloud containers are Linux by definition. Ship fast, expand later.
- **(B)** Cross-platform abstraction layer (`@anyclaw/resource-limits`) with Linux (cgroup v2), macOS (rlimits + taskpolicy), Windows (Job Objects) backends. More work upfront.
- **(C)** Linux via cgroup v2 for all deployments; on non-Linux hosts, fall back to "advisory limits" — the dispatch server monitors `ps` output and kills the agent if it exceeds the caps. Less precise, but portable.

### G4: anyclaw_ask_user Behavior on Timeout with Task Persistence

The locked decision says clarification timeout is user-configurable: either "agent proceeds with best judgment" (default 5 min) or "pause indefinitely." With task persistence, "pause indefinitely" means the task survives a restart and the question re-appears when the user opens the app.

**Question:** When the user has configured "pause indefinitely" and the MCP server (or the whole host) restarts, how does the resumed agent know it was waiting for a user answer?

**Options:**
- **(A)** The `_agent_messages` collection already has the unanswered question. On resume, the dispatch server checks for pending questions before re-spawning the agent. If a question is pending, it waits for the answer first, then re-dispatches with the answer included in the checkpoint.
- **(B)** The checkpoint stores `waitingForAnswer: true` and the question ID. On resume, the dispatch server polls for the answer before re-spawning the agent.
- **(C)** The agent is re-spawned with the full conversation history (including the unanswered question). The agent re-asks if needed, which may create a duplicate question in the mobile app. Simpler but worse UX.

### G5: Prod Logic Service Restart on Deploy

When `anyclaw_deploy` promotes new logic service code to `prod/logic/`, the running prod logic service process needs to restart to pick up the new code. Under supervised processes this means signalling the supervisor rather than directly killing the process.

**Question:** What is the restart mechanism?

**Options:**
- **(A)** The MCP server runs `supervisorctl restart anyclaw-logic` (or `systemctl restart anyclaw-logic`). Works but couples the MCP server to a specific supervisor.
- **(B)** The MCP server writes a "restart-requested" marker file; the logic service watches for the marker and self-restarts (re-execs) when it sees it. Supervisor-agnostic but more moving parts.
- **(C)** Zero-downtime swap: the MCP server starts a new logic service process on a different port, waits for health, flips a reverse-proxy upstream, then stops the old one. More complex but no downtime. Probably overkill for MVP.

### G6: Filesystem Permission Bootstrapping

The permission scheme in Section 3.1 requires two OS users (`anyclaw-infra`, `anyclaw-agent`) and specific ownership of `dev/`, `prod/`, `.anyclaw/`, and `pocketbase/pb_data/`. Setting this up correctly on every install (self-hosted Linux, self-hosted macOS, cloud container) is non-trivial.

**Question:** How does the installer bootstrap the user accounts and directory ownership reliably?

**Options:**
- **(A)** A dedicated install script (`anyclaw-install.sh`) that runs as root, creates the users, and sets ownership. Simple, requires root.
- **(B)** The Docker image ships with the users pre-created; the install process is just `docker run`. Works cleanly for cloud and for self-hosted Docker users, but native installs still need the script.
- **(C)** Skip multi-user isolation for MVP; rely on cgroups + path guards inside the MCP server for constraint enforcement. Weaker isolation but dramatically simpler install. Revisit when moving to true cloud multi-tenancy (which is already handled by container-per-user, so arguably OS user separation is redundant there anyway).
