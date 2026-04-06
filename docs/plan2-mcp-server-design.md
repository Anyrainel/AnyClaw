# Plan 2: MCP Server — Technical Design

## Overview

The AnyClaw MCP server exposes the AnyClaw infrastructure (PocketBase, Node.js logic service, Vite+React frontend, deployment pipeline) as MCP tools that any compatible coding agent can call. This document specifies the protocol details, tool schemas, constraint enforcement, mobile app communication, and error handling.

**Depends on:** Plan 1 (Server Infrastructure) — the MCP server wraps the deploy manager, snapshot manager, version store, and project structure built in Plan 1.

---

## 1. MCP Protocol Details

### SDK and Runtime

- **SDK:** `@modelcontextprotocol/sdk` (v1.x stable branch). The v2 release is pre-alpha as of early 2026; we use v1.x for production stability and upgrade when v2 stabilizes.
- **Schema validation:** `zod` (v3) for tool input/output schemas, as required by the SDK.
- **Runtime:** Node.js 18+ with TypeScript (ESM, `NodeNext` module resolution per SDK requirements).

### Transport: Dual Mode

The MCP server supports two transports to cover both plugin and standalone deployment modes:

**stdio (primary, for local agents):**
Used when the coding agent runs on the same machine as the AnyClaw server. This is the standard integration path for Claude Code, OpenClaw, and other local agents. The agent spawns the MCP server as a child process and communicates over stdin/stdout.

```typescript
// src/mcp-server/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";

const server = new McpServer(
  { name: "anyclaw", version: "1.0.0" },
  {
    instructions: [
      "AnyClaw MCP server. All code changes happen in the dev environment only.",
      "You MUST call anyclaw_deploy to promote changes to production.",
      "A version description is required for every deployment.",
      "Use anyclaw_ask_user to clarify requirements before building.",
      "Use anyclaw_update_progress to keep the user informed.",
    ].join(" "),
  }
);

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Streamable HTTP (secondary, for remote/cloud agents):**
Used when the agent runs remotely (cloud-hosted AnyClaw, or a remote agent connecting over the network). The MCP server exposes an HTTP endpoint that the agent connects to.

```typescript
// src/mcp-server/http.ts
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
    { instructions: "..." }
  );
  registerAllTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.listen(4100, () => {
  console.log("AnyClaw MCP HTTP transport on :4100");
});
```

### Agent Registration

**Claude Code:** Add to `.mcp.json` or `~/.claude/mcp_servers.json`:
```json
{
  "mcpServers": {
    "anyclaw": {
      "command": "node",
      "args": ["<path>/anyclaw-server/packages/mcp-server/dist/index.js"],
      "env": {
        "ANYCLAW_PROJECT_ROOT": "<path>/anyclaw-server"
      }
    }
  }
}
```

**OpenClaw:** Register via the OpenClaw MCP configuration (same stdio pattern — the agent spawns the process).

**Generic agents (HTTP):** Point the agent's MCP client at `http://localhost:4100/mcp`.

---

## 2. Tool Definitions

All tools live under `packages/mcp-server/src/tools/`. Each tool is a separate file exporting a registration function. The `registerAllTools` function wires them all to the `McpServer` instance.

### Environment Configuration

The MCP server reads a single environment variable, `ANYCLAW_PROJECT_ROOT`, which points to the `anyclaw-server/` directory. All paths are derived from this root. The server loads the project config from `packages/deploy/src/config.ts` to get port numbers, PocketBase URLs, and path constants.

```typescript
// src/mcp-server/env.ts
import path from "node:path";

export const PROJECT_ROOT = process.env.ANYCLAW_PROJECT_ROOT
  ?? path.resolve(import.meta.dirname, "../../../");

export const PATHS = {
  devLogic:    path.join(PROJECT_ROOT, "dev/logic"),
  devFrontend: path.join(PROJECT_ROOT, "dev/frontend"),
  prodLogic:   path.join(PROJECT_ROOT, "prod/logic"),
  prodFrontend: path.join(PROJECT_ROOT, "prod/frontend"),
  pbData:      path.join(PROJECT_ROOT, "pocketbase/pb_data"),
  pbMigrations: path.join(PROJECT_ROOT, "pocketbase/pb_migrations"),
} as const;
```

---

### 2.1 anyclaw_create_page

Scaffolds a new React page in the dev frontend with routing.

```typescript
server.registerTool(
  "anyclaw_create_page",
  {
    title: "Create Page",
    description:
      "Scaffold a new React page component in the dev frontend and register it in the router. " +
      "Creates the page file in dev/frontend/src/pages/ and adds a route entry in App.tsx.",
    inputSchema: z.object({
      name: z.string().describe("PascalCase page component name, e.g. 'MoodTracker'"),
      route: z.string().describe("URL path for the page, e.g. '/mood-tracker'"),
      title: z.string().describe("Page title shown in browser tab and navigation"),
      initialContent: z
        .string()
        .optional()
        .describe("Optional initial JSX content for the page body. If omitted, a placeholder is generated."),
    }),
    outputSchema: z.object({
      filePath: z.string(),
      route: z.string(),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async ({ name, route, title, initialContent }) => {
    // 1. Validate name is PascalCase
    // 2. Check page doesn't already exist
    // 3. Write page file to dev/frontend/src/pages/{name}.tsx
    // 4. Add route entry to dev/frontend/src/App.tsx
    // Returns the created file path and registered route
    const filePath = path.join(PATHS.devFrontend, "src/pages", `${name}.tsx`);
    // ... implementation ...
    return {
      content: [{ type: "text", text: `Created page ${name} at route ${route}` }],
      structuredContent: { filePath, route },
    };
  }
);
```

### 2.2 anyclaw_create_api_route

Adds a new Express endpoint to the Node.js logic service.

```typescript
server.registerTool(
  "anyclaw_create_api_route",
  {
    title: "Create API Route",
    description:
      "Add a new Express route handler to the dev logic service. " +
      "Creates a route file in dev/logic/src/routes/ and registers it in the route index.",
    inputSchema: z.object({
      name: z.string().describe("kebab-case route name, e.g. 'get-mood-entries'"),
      method: z.enum(["get", "post", "put", "patch", "delete"]).describe("HTTP method"),
      path: z.string().describe("Express route path, e.g. '/api/mood-entries'"),
      description: z.string().describe("What this endpoint does — used as a code comment"),
      handlerCode: z.string().describe(
        "TypeScript handler function body. Has access to (req, res) and all primitives " +
        "(getPocketBase, callLLM, fetchUrl, sendNotification). Must call res.json() or res.status()."
      ),
    }),
    outputSchema: z.object({
      filePath: z.string(),
      endpoint: z.string(),
    }),
  },
  async ({ name, method, path: routePath, description, handlerCode }) => {
    // 1. Validate route name and path format
    // 2. Write route file to dev/logic/src/routes/{name}.ts
    // 3. Register route in dev/logic/src/routes/index.ts
    const filePath = path.join(PATHS.devLogic, "src/routes", `${name}.ts`);
    return {
      content: [{ type: "text", text: `Created ${method.toUpperCase()} ${routePath}` }],
      structuredContent: { filePath, endpoint: `${method.toUpperCase()} ${routePath}` },
    };
  }
);
```

### 2.3 anyclaw_create_collection

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

### 2.4 anyclaw_create_job

Registers a background scheduled task in the Node.js logic service.

```typescript
server.registerTool(
  "anyclaw_create_job",
  {
    title: "Create Background Job",
    description:
      "Register a background scheduled task (node-cron) in the dev logic service. " +
      "Creates a job file in dev/logic/src/jobs/ and registers it in the job index.",
    inputSchema: z.object({
      name: z.string().describe("kebab-case job name, e.g. 'daily-news-scout'"),
      cron: z.string().describe("Cron expression, e.g. '0 8 * * *' for daily at 8am"),
      description: z.string().describe("What this job does — used as a code comment"),
      handlerCode: z.string().describe(
        "TypeScript async function body. Has access to all primitives " +
        "(getPocketBase, callLLM, fetchUrl, sendNotification). No return value needed."
      ),
    }),
    outputSchema: z.object({
      filePath: z.string(),
      schedule: z.string(),
    }),
  },
  async ({ name, cron, description, handlerCode }) => {
    const filePath = path.join(PATHS.devLogic, "src/jobs", `${name}.ts`);
    return {
      content: [{ type: "text", text: `Created job '${name}' scheduled at '${cron}'` }],
      structuredContent: { filePath, schedule: cron },
    };
  }
);
```

### 2.5 anyclaw_deploy

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
    // 1. Run validation suite in dev/:
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
    //    - Restart the prod logic service process
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

### 2.6 anyclaw_rollback

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
    // 5. Notify mobile app to reload
    return {
      content: [{ type: "text", text: `Rolled back to ${version}` }],
      structuredContent: { rolledBackTo: version, safetySnapshotId: "snap_safety_..." },
    };
  }
);
```

### 2.7 anyclaw_snapshot_db

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

### 2.8 anyclaw_list_versions

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

### 2.9 anyclaw_read_file

Reads a source file from the dev environment.

```typescript
server.registerTool(
  "anyclaw_read_file",
  {
    title: "Read File",
    description:
      "Read the contents of a source file in the dev environment. " +
      "Path is relative to the dev workspace root (dev/). Cannot read files outside dev/.",
    inputSchema: z.object({
      path: z.string().describe(
        "Relative file path within the dev workspace, e.g. 'frontend/src/pages/Home.tsx' or 'logic/src/routes/index.ts'"
      ),
    }),
    outputSchema: z.object({
      content: z.string(),
      sizeBytes: z.number(),
      exists: z.boolean(),
    }),
  },
  async ({ path: relPath }) => {
    // 1. Resolve path under dev/ root
    // 2. Validate path doesn't escape dev/ (path traversal protection)
    // 3. Read file and return content
    const absPath = path.resolve(PROJECT_ROOT, "dev", relPath);
    if (!absPath.startsWith(path.resolve(PROJECT_ROOT, "dev"))) {
      return {
        content: [{ type: "text", text: "Error: path traversal blocked — path must be within dev/" }],
        isError: true,
      };
    }
    // ... read file ...
    return {
      content: [{ type: "text", text: "file contents here..." }],
      structuredContent: { content: "...", sizeBytes: 0, exists: true },
    };
  }
);
```

### 2.10 anyclaw_write_file

Writes a source file in the dev environment.

```typescript
server.registerTool(
  "anyclaw_write_file",
  {
    title: "Write File",
    description:
      "Write or overwrite a source file in the dev environment. " +
      "Path is relative to the dev workspace root (dev/). Cannot write outside dev/. " +
      "Parent directories are created automatically.",
    inputSchema: z.object({
      path: z.string().describe("Relative file path within dev workspace"),
      content: z.string().describe("File content to write"),
      createOnly: z.boolean().default(false).describe(
        "If true, fails when the file already exists (prevents accidental overwrites)"
      ),
    }),
    outputSchema: z.object({
      filePath: z.string(),
      bytesWritten: z.number(),
      created: z.boolean(),
    }),
  },
  async ({ path: relPath, content: fileContent, createOnly }) => {
    // 1. Resolve and validate path (same traversal protection as read_file)
    // 2. If createOnly and file exists, return error
    // 3. mkdirp parent directories
    // 4. Write file
    return {
      content: [{ type: "text", text: `Wrote ${relPath}` }],
      structuredContent: { filePath: relPath, bytesWritten: fileContent.length, created: true },
    };
  }
);
```

### 2.11 anyclaw_run_dev

Executes a command in the dev environment for testing/debugging.

```typescript
server.registerTool(
  "anyclaw_run_dev",
  {
    title: "Run in Dev",
    description:
      "Execute a shell command in the dev environment. For testing, debugging, and running dev scripts. " +
      "Commands run with cwd set to the dev workspace root. " +
      "BLOCKED commands: rm -rf, anything touching prod/, anything touching pocketbase/pb_data/.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute, e.g. 'npm test' or 'npx tsc --noEmit'"),
      timeoutMs: z.number().default(30000).describe("Command timeout in milliseconds (max 120000)"),
    }),
    outputSchema: z.object({
      exitCode: z.number(),
      stdout: z.string(),
      stderr: z.string(),
    }),
  },
  async ({ command, timeoutMs }) => {
    // 1. Validate command against blocklist (see Section 3)
    // 2. Spawn child process with cwd = dev/, timeout
    // 3. Capture stdout/stderr
    // 4. Return exit code and output
    return {
      content: [{ type: "text", text: `Exit code 0\n<stdout>...</stdout>` }],
      structuredContent: { exitCode: 0, stdout: "...", stderr: "" },
    };
  }
);
```

### 2.12 anyclaw_ask_user

Posts a clarifying question to the mobile app and waits for the user's answer. This is the bridge between the agent and the user during task execution.

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
    // 3. Poll `_agent_messages` for the user's reply (with backoff)
    // 4. Return answer or timeout
    return {
      content: [{ type: "text", text: `User answered: "..."` }],
      structuredContent: { answer: "...", answeredAt: "2026-04-05T12:00:00Z", timedOut: false },
    };
  }
);
```

### 2.13 anyclaw_update_progress

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

The MCP server is the single chokepoint between the agent and the infrastructure. It enforces all safety constraints listed in the main spec. Constraints are checked at the tool handler level before any side effects occur.

### 3.1 Dev-Only Writes

**Rule:** The agent can only modify files in the `dev/` workspace. It cannot touch `prod/`, `pocketbase/pb_data/`, or any file outside the project root.

**Implementation:**

```typescript
// src/mcp-server/guards.ts
import path from "node:path";
import { PATHS, PROJECT_ROOT } from "./env.js";

const BLOCKED_WRITE_PREFIXES = [
  path.resolve(PATHS.prodLogic),
  path.resolve(PATHS.prodFrontend),
  path.resolve(PATHS.pbData),
];

export function assertDevPath(relPath: string): string {
  const abs = path.resolve(PROJECT_ROOT, "dev", relPath);
  // Block path traversal (e.g., ../../etc/passwd)
  if (!abs.startsWith(path.resolve(PROJECT_ROOT, "dev") + path.sep)) {
    throw new ToolError("Path must be within the dev/ workspace");
  }
  // Block writes to prod or PocketBase data
  for (const prefix of BLOCKED_WRITE_PREFIXES) {
    if (abs.startsWith(prefix)) {
      throw new ToolError(`Cannot write to ${prefix} — production and PocketBase data are read-only`);
    }
  }
  return abs;
}
```

Applied in: `anyclaw_write_file`, `anyclaw_read_file`, `anyclaw_create_page`, `anyclaw_create_api_route`, `anyclaw_create_job`.

### 3.2 PocketBase Admin API Only

**Rule:** PocketBase is accessed exclusively through its admin REST API. The agent never reads or writes PocketBase files directly.

**Implementation:**

```typescript
// src/mcp-server/pocketbase-client.ts
import PocketBase from "pocketbase";

let pbAdmin: PocketBase | null = null;

export async function getPocketBaseAdmin(): Promise<PocketBase> {
  if (!pbAdmin) {
    pbAdmin = new PocketBase(process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090");
    await pbAdmin.admins.authWithPassword(
      process.env.PB_ADMIN_EMAIL!,
      process.env.PB_ADMIN_PASSWORD!
    );
  }
  return pbAdmin;
}
```

The `anyclaw_create_collection` tool uses this client exclusively. The `anyclaw_write_file` guard blocks any path under `pocketbase/`. The `anyclaw_run_dev` command blocklist prevents direct SQLite access (see below).

### 3.3 Command Blocklist for anyclaw_run_dev

**Rule:** Shell commands are restricted to prevent the agent from bypassing safety rails.

```typescript
// src/mcp-server/guards.ts
const COMMAND_BLOCKLIST = [
  /rm\s+(-rf?|--recursive)\s/,         // destructive deletes
  /\bprod\b/,                           // anything referencing prod/
  /pb_data/,                            // direct PocketBase data access
  /sqlite3?\s/,                         // direct SQLite CLI access
  /\bgit\s+(push|reset|rebase)\b/,     // dangerous git operations (deploy manager handles git)
  /\bcurl\b.*localhost:8090/,           // direct PocketBase API bypass
];

export function assertSafeCommand(command: string): void {
  for (const pattern of COMMAND_BLOCKLIST) {
    if (pattern.test(command)) {
      throw new ToolError(
        `Blocked command pattern: ${pattern}. Use the appropriate MCP tool instead.`
      );
    }
  }
}
```

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
MCP Server polls _agent_messages for answer (250ms interval, exponential backoff to 2s)
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

### Why PocketBase Realtime (Not a Separate WebSocket)

1. **Already exists.** PocketBase runs as part of the infrastructure. No additional server to maintain.
2. **SSE is firewall-friendly.** Works through HTTP proxies, no special port needed.
3. **Single source of truth.** Messages are persisted in the database. If the mobile app disconnects and reconnects, it can query for missed messages.
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

The MCP server receives the `taskId` from the agent adapter layer. When the adapter dispatches a task, it generates a `taskId` and passes it as an environment variable (`ANYCLAW_TASK_ID`) to the MCP server process. All tools that communicate with the mobile app use this task ID to associate messages with the correct task card.

```typescript
// src/mcp-server/task-context.ts
export function getTaskId(): string {
  const taskId = process.env.ANYCLAW_TASK_ID;
  if (!taskId) {
    throw new ToolError(
      "ANYCLAW_TASK_ID not set. The MCP server must be launched with a task context."
    );
  }
  return taskId;
}
```

---

## 5. Error Handling

### Error Categories

| Category | Example | Handling |
|----------|---------|----------|
| **Input validation** | Missing required field, invalid path | Zod schema rejects before handler runs. SDK returns structured error to agent. |
| **Constraint violation** | Write to prod/, blocked command | `ToolError` thrown in guard. Returned as `isError: true` with explanation. |
| **Infrastructure failure** | PocketBase unreachable, git command fails | Caught in handler, returned as `isError: true` with diagnostic info. |
| **Validation failure** | Lint errors, type errors, failed tests | `anyclaw_deploy` returns `isError: true` with the full validation output so the agent can fix issues. |
| **Timeout** | `anyclaw_ask_user` waits too long, `anyclaw_run_dev` hangs | Returns `isError: true` with timeout message. Agent can retry or proceed without user input. |
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

If PocketBase is unreachable (e.g., the process crashed), the MCP server retries with exponential backoff (3 attempts, 1s/2s/4s delays). If all retries fail, the tool returns an `isError` response instructing the agent to check server health.

---

## 6. Package Structure

The MCP server lives as a new package in the monorepo established by Plan 1:

```
anyclaw-server/
├── packages/
│   ├── mcp-server/                    # NEW — this plan
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # stdio entrypoint
│   │       ├── http.ts                # Streamable HTTP entrypoint
│   │       ├── env.ts                 # Project paths and config
│   │       ├── task-context.ts        # Task ID management
│   │       ├── errors.ts             # ToolError class
│   │       ├── pocketbase-client.ts  # PB admin client singleton
│   │       ├── guards.ts            # Path validation, command blocklist
│   │       └── tools/
│   │           ├── index.ts           # registerAllTools()
│   │           ├── create-page.ts
│   │           ├── create-api-route.ts
│   │           ├── create-collection.ts
│   │           ├── create-job.ts
│   │           ├── deploy.ts
│   │           ├── rollback.ts
│   │           ├── snapshot-db.ts
│   │           ├── list-versions.ts
│   │           ├── read-file.ts
│   │           ├── write-file.ts
│   │           ├── run-dev.ts
│   │           ├── ask-user.ts
│   │           └── update-progress.ts
│   ├── deploy/                        # From Plan 1 — imported by deploy.ts, rollback.ts, etc.
│   ├── logic/                         # From Plan 1 — agent writes code here
│   └── frontend/                      # From Plan 1 — agent writes code here
```

**package.json:**
```json
{
  "name": "@anyclaw/mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "anyclaw-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start:http": "tsx src/http.ts"
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

## 7. Open Questions Requiring Human Input

### Q1: Task ID Lifecycle — Per-Process or Per-Session?

The current design passes `ANYCLAW_TASK_ID` as an environment variable, which means one MCP server process handles one task. This is natural for stdio transport (agent spawns a fresh process per task). But for HTTP transport, the server is long-lived and handles multiple tasks.

**Options:**
- **(A)** For HTTP transport, pass `taskId` as a field in each tool call's input schema (adding it to every tool).
- **(B)** For HTTP transport, use the MCP session ID to look up the task ID from a mapping maintained by the agent adapter.
- **(C)** Always use stdio (one process per task) and skip HTTP for MVP.

**Recommendation:** Option C for MVP, migrate to B when HTTP transport is needed for cloud hosting.

### Q2: anyclaw_ask_user Polling vs. PocketBase Realtime in the MCP Server

The MCP server currently polls `_agent_messages` for the user's answer. An alternative is to use PocketBase's realtime subscription inside the MCP server process (Node.js SSE client). This would be more responsive but requires an EventSource polyfill for Node.js.

**Options:**
- **(A)** Polling with exponential backoff (250ms to 2s). Simple, no extra dependencies.
- **(B)** PocketBase realtime subscription in Node.js using `eventsource` polyfill. More responsive, slightly more complex.

**Recommendation:** Start with A (polling). The 250ms-2s latency range is imperceptible since the user is typing a response. Revisit if latency becomes an issue.

### Q3: Scaffold Tools vs. Raw File Tools

The current design has both scaffold tools (`anyclaw_create_page`, `anyclaw_create_api_route`, `anyclaw_create_job`) and raw file tools (`anyclaw_read_file`, `anyclaw_write_file`). Sophisticated agents (Claude Code, OpenClaw) may prefer to write files directly rather than using scaffolders.

**Question:** Should the scaffold tools be mandatory, or should agents be allowed to use `anyclaw_write_file` to create pages/routes/jobs directly? If scaffold tools are optional, they become convenience tools that enforce conventions but are not the only path.

**Recommendation:** Make scaffold tools optional conveniences. Enforce conventions via the skill suite (prompts) rather than hard tool requirements. The constraint enforcement (dev-only writes, validation gate) still applies regardless of which tool creates the file.

### Q4: anyclaw_run_dev — Allowlist vs. Blocklist

The current design uses a blocklist (block known-dangerous commands). An allowlist (only allow known-safe commands like `npm test`, `npx tsc`, `npx eslint`) would be more restrictive but might break agent workflows that need flexibility.

**Options:**
- **(A)** Blocklist (current design). More flexible, risk of missing dangerous patterns.
- **(B)** Allowlist of known-safe prefixes (`npm`, `npx`, `node`, `cat`, `ls`, `grep`). Safer, but agents may need escape hatches.
- **(C)** Blocklist for MVP, migrate to allowlist after observing real agent behavior for a few weeks.

**Recommendation:** Option C. Ship with the blocklist, log all commands for audit, then tighten to an allowlist once the common command patterns are understood.

### Q5: PocketBase Admin Credentials — Storage and Rotation

The MCP server needs PocketBase admin credentials to create collections and manage data. Where do these credentials live, and how are they rotated?

**Options:**
- **(A)** Environment variables (`PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`). Simple, standard.
- **(B)** Auto-generated on first run and stored in an encrypted config file.
- **(C)** PocketBase API key (if supported in the PocketBase version being used) instead of email/password.

**Recommendation:** Option A for MVP. The MCP server runs on the same machine as PocketBase, so environment variables are secure enough. Auto-rotation can be added later.
