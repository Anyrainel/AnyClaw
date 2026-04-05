# Plan 1: Server Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side foundation — PocketBase data layer, Node.js logic service with primitives, Vite+React frontend scaffold, dev/prod split with validation gate, and git-based versioning with SQLite snapshots for rollback.

**Architecture:** A monorepo with three server components: PocketBase (data/auth/files, runs as a binary), a Node.js logic service (background jobs, custom APIs, LLM calls), and a Vite+React frontend (agent-built UI). Two copies of the frontend+logic exist: `dev/` (agent workspace) and `prod/` (user-facing). A deployment manager validates dev, commits to git, snapshots the DB, and promotes to prod.

**Tech Stack:** PocketBase, Node.js + TypeScript + Express, Vite + React + TypeScript, node-cron, zod, SQLite, Git, zstd compression, vitest for testing.

---

## File Structure

```
anyclaw-server/
├── package.json                          # Workspace root
├── tsconfig.base.json                    # Shared TS config
├── pocketbase/
│   ├── pb_data/                          # PocketBase data directory (gitignored)
│   └── pb_migrations/                    # PocketBase migrations (tracked)
├── packages/
│   ├── logic/                            # Node.js logic service
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                  # Express server entrypoint
│   │   │   ├── primitives/
│   │   │   │   ├── schedule-job.ts       # node-cron wrapper
│   │   │   │   ├── fetch-url.ts          # HTTP client with timeout/retry
│   │   │   │   ├── call-llm.ts           # LLM provider interface
│   │   │   │   ├── send-notification.ts  # Push notification dispatch
│   │   │   │   └── get-pocketbase.ts     # Typed PocketBase admin client
│   │   │   ├── routes/                   # Custom API route directory (agent writes here)
│   │   │   │   └── _example.ts           # Example route showing pattern
│   │   │   ├── jobs/                     # Background job directory (agent writes here)
│   │   │   │   └── _example.ts           # Example job showing pattern
│   │   │   └── config.ts                 # Environment config (ports, PB URL, API keys)
│   │   └── tests/
│   │       ├── primitives/
│   │       │   ├── schedule-job.test.ts
│   │       │   ├── fetch-url.test.ts
│   │       │   ├── call-llm.test.ts
│   │       │   ├── send-notification.test.ts
│   │       │   └── get-pocketbase.test.ts
│   │       └── deploy/
│   │           ├── deploy-manager.test.ts
│   │           └── snapshot-manager.test.ts
│   ├── frontend/                         # Vite + React frontend scaffold
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx                  # React entrypoint
│   │       ├── App.tsx                   # Root component with router
│   │       ├── pages/                    # Page directory (agent writes here)
│   │       │   └── Home.tsx              # Default home page
│   │       ├── components/               # Shared components (agent writes here)
│   │       │   └── Layout.tsx            # Base layout with responsive shell
│   │       └── lib/
│   │           ├── pocketbase.ts         # PocketBase JS SDK client instance
│   │           └── api.ts                # Logic service API client
│   └── deploy/                           # Deployment manager
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── deploy-manager.ts         # Validate, commit, promote flow
│       │   ├── snapshot-manager.ts       # SQLite DB snapshot/restore
│       │   ├── version-store.ts          # Git-based version metadata
│       │   └── config.ts                 # Paths, retention policy settings
│       └── tests/
│           ├── deploy-manager.test.ts
│           ├── snapshot-manager.test.ts
│           └── version-store.test.ts
├── dev/                                  # Symlink or copy of packages/{logic,frontend} — agent workspace
├── prod/                                 # Built artifacts served to user
│   ├── frontend/                         # Vite build output (static files)
│   └── logic/                            # Compiled JS for logic service
└── .gitignore
```

---

### Task 1: Project Scaffolding & Workspace Setup

**Files:**
- Create: `anyclaw-server/package.json`
- Create: `anyclaw-server/tsconfig.base.json`
- Create: `anyclaw-server/.gitignore`
- Create: `anyclaw-server/packages/logic/package.json`
- Create: `anyclaw-server/packages/logic/tsconfig.json`
- Create: `anyclaw-server/packages/frontend/package.json`
- Create: `anyclaw-server/packages/frontend/tsconfig.json`
- Create: `anyclaw-server/packages/frontend/vite.config.ts`
- Create: `anyclaw-server/packages/deploy/package.json`
- Create: `anyclaw-server/packages/deploy/tsconfig.json`

- [ ] **Step 1: Create the monorepo root**

```bash
cd F:/Codes/AnyClaw
mkdir -p anyclaw-server
cd anyclaw-server
```

Create `package.json`:

```json
{
  "name": "anyclaw-server",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev:logic": "npm run dev --workspace=packages/logic",
    "dev:frontend": "npm run dev --workspace=packages/frontend",
    "build:frontend": "npm run build --workspace=packages/frontend",
    "build:logic": "npm run build --workspace=packages/logic",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist"
  }
}
```

Create `.gitignore`:

```
node_modules/
dist/
prod/
pocketbase/pb_data/
*.db-shm
*.db-wal
snapshots/
.env
.env.local
```

- [ ] **Step 2: Create the logic service package**

Create `packages/logic/package.json`:

```json
{
  "name": "@anyclaw/logic",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^5.0.1",
    "node-cron": "^3.0.3",
    "pocketbase": "^0.25.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.11",
    "eslint": "^9.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Create `packages/logic/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create the frontend package**

Create `packages/frontend/package.json`:

```json
{
  "name": "@anyclaw/frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "pocketbase": "^0.25.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "eslint": "^9.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

Create `packages/frontend/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

Create `packages/frontend/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/pb": {
        target: "http://localhost:8090",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pb/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: Create the deploy package**

Create `packages/deploy/package.json`:

```json
{
  "name": "@anyclaw/deploy",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "simple-git": "^3.27.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Create `packages/deploy/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Install dependencies and verify workspace**

```bash
cd F:/Codes/AnyClaw/anyclaw-server
npm install
```

Expected: all three workspaces resolve, node_modules created.

```bash
npm run typecheck
```

Expected: no errors (no source files yet, but config is valid).

- [ ] **Step 6: Commit**

```bash
git add anyclaw-server/
git commit -m "feat: scaffold monorepo with logic, frontend, and deploy packages"
```

---

### Task 2: Environment Config

**Files:**
- Create: `anyclaw-server/packages/logic/src/config.ts`
- Create: `anyclaw-server/packages/deploy/src/config.ts`
- Create: `anyclaw-server/.env.example`

- [ ] **Step 1: Create the logic service config**

Create `packages/logic/src/config.ts`:

```typescript
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  POCKETBASE_URL: z.string().default("http://localhost:8090"),
  POCKETBASE_ADMIN_EMAIL: z.string().email(),
  POCKETBASE_ADMIN_PASSWORD: z.string().min(1),
  LLM_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().default("gpt-4o"),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment config:\n${missing}`);
  }
  return result.data;
}
```

- [ ] **Step 2: Create the deploy config**

Create `packages/deploy/src/config.ts`:

```typescript
import { z } from "zod";
import path from "node:path";

const configSchema = z.object({
  /** Root of the anyclaw-server monorepo */
  serverRoot: z.string(),
  /** Path to PocketBase data directory (contains the SQLite DB) */
  pbDataDir: z.string(),
  /** Path to the dev workspace (agent writes code here) */
  devDir: z.string(),
  /** Path to the prod output (user-facing built artifacts) */
  prodDir: z.string(),
  /** Path to store DB snapshots */
  snapshotDir: z.string(),
  /** Maximum number of snapshots to retain */
  maxSnapshots: z.number().int().min(1).default(20),
  /** Name of the PocketBase SQLite database file */
  dbFilename: z.string().default("data.db"),
});

export type DeployConfig = z.infer<typeof configSchema>;

export function createDeployConfig(serverRoot: string): DeployConfig {
  return configSchema.parse({
    serverRoot,
    pbDataDir: path.join(serverRoot, "pocketbase", "pb_data"),
    devDir: path.join(serverRoot, "packages"),
    prodDir: path.join(serverRoot, "prod"),
    snapshotDir: path.join(serverRoot, "snapshots"),
    maxSnapshots: 20,
    dbFilename: "data.db",
  });
}
```

- [ ] **Step 3: Create `.env.example`**

Create `anyclaw-server/.env.example`:

```
PORT=3001
POCKETBASE_URL=http://localhost:8090
POCKETBASE_ADMIN_EMAIL=admin@anyclaw.local
POCKETBASE_ADMIN_PASSWORD=changeme
LLM_PROVIDER=openai
LLM_API_KEY=sk-your-key-here
LLM_MODEL=gpt-4o
NODE_ENV=development
```

- [ ] **Step 4: Commit**

```bash
git add anyclaw-server/packages/logic/src/config.ts anyclaw-server/packages/deploy/src/config.ts anyclaw-server/.env.example
git commit -m "feat: add environment config with zod validation for logic and deploy"
```

---

### Task 3: PocketBase Admin Client Primitive

**Files:**
- Create: `anyclaw-server/packages/logic/src/primitives/get-pocketbase.ts`
- Create: `anyclaw-server/packages/logic/tests/primitives/get-pocketbase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/logic/tests/primitives/get-pocketbase.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPocketBase, resetPocketBaseClient } from "../../src/primitives/get-pocketbase.js";
import PocketBase from "pocketbase";

vi.mock("pocketbase", () => {
  const MockPB = vi.fn().mockImplementation((url: string) => ({
    url,
    collection: vi.fn().mockReturnValue({
      authWithPassword: vi.fn().mockResolvedValue({ token: "mock-token" }),
    }),
    authStore: { isValid: false, token: "" },
  }));
  return { default: MockPB };
});

describe("getPocketBase", () => {
  beforeEach(() => {
    resetPocketBaseClient();
    vi.clearAllMocks();
  });

  it("creates a PocketBase client with the configured URL", async () => {
    const pb = await getPocketBase({
      url: "http://localhost:8090",
      adminEmail: "admin@test.com",
      adminPassword: "testpass",
    });

    expect(PocketBase).toHaveBeenCalledWith("http://localhost:8090");
    expect(pb).toBeDefined();
    expect(pb.url).toBe("http://localhost:8090");
  });

  it("authenticates as superuser on first call", async () => {
    const pb = await getPocketBase({
      url: "http://localhost:8090",
      adminEmail: "admin@test.com",
      adminPassword: "testpass",
    });

    expect(pb.collection).toHaveBeenCalledWith("_superusers");
    const superusersCollection = pb.collection("_superusers");
    expect(superusersCollection.authWithPassword).toHaveBeenCalledWith(
      "admin@test.com",
      "testpass"
    );
  });

  it("returns the same instance on subsequent calls (singleton)", async () => {
    const opts = {
      url: "http://localhost:8090",
      adminEmail: "admin@test.com",
      adminPassword: "testpass",
    };
    const pb1 = await getPocketBase(opts);
    const pb2 = await getPocketBase(opts);
    expect(pb1).toBe(pb2);
    expect(PocketBase).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd F:/Codes/AnyClaw/anyclaw-server
npx vitest run packages/logic/tests/primitives/get-pocketbase.test.ts
```

Expected: FAIL — module `../../src/primitives/get-pocketbase.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/logic/src/primitives/get-pocketbase.ts`:

```typescript
import PocketBase from "pocketbase";

interface PocketBaseOptions {
  url: string;
  adminEmail: string;
  adminPassword: string;
}

let clientInstance: PocketBase | null = null;

export async function getPocketBase(
  opts: PocketBaseOptions
): Promise<PocketBase> {
  if (clientInstance) {
    return clientInstance;
  }

  const pb = new PocketBase(opts.url);
  await pb.collection("_superusers").authWithPassword(
    opts.adminEmail,
    opts.adminPassword
  );

  clientInstance = pb;
  return pb;
}

export function resetPocketBaseClient(): void {
  clientInstance = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd F:/Codes/AnyClaw/anyclaw-server
npx vitest run packages/logic/tests/primitives/get-pocketbase.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add anyclaw-server/packages/logic/src/primitives/get-pocketbase.ts anyclaw-server/packages/logic/tests/primitives/get-pocketbase.test.ts
git commit -m "feat: add PocketBase admin client primitive with singleton pattern"
```

---

### Task 4: Schedule Job Primitive

**Files:**
- Create: `anyclaw-server/packages/logic/src/primitives/schedule-job.ts`
- Create: `anyclaw-server/packages/logic/tests/primitives/schedule-job.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/logic/tests/primitives/schedule-job.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleJob,
  cancelJob,
  listJobs,
  cancelAllJobs,
} from "../../src/primitives/schedule-job.js";

// Mock node-cron
vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn().mockReturnValue({
      stop: vi.fn(),
    }),
    validate: vi.fn().mockReturnValue(true),
  },
}));

import cron from "node-cron";

describe("scheduleJob", () => {
  beforeEach(() => {
    cancelAllJobs();
    vi.clearAllMocks();
  });

  it("registers a job with a valid cron expression", () => {
    const handler = vi.fn();
    scheduleJob("test-job", "*/5 * * * *", handler);

    expect(cron.schedule).toHaveBeenCalledWith(
      "*/5 * * * *",
      expect.any(Function)
    );
    expect(listJobs()).toContain("test-job");
  });

  it("throws if the same job name is registered twice", () => {
    scheduleJob("dup-job", "* * * * *", vi.fn());
    expect(() => scheduleJob("dup-job", "* * * * *", vi.fn())).toThrowError(
      /already registered/
    );
  });

  it("cancels a job by name", () => {
    scheduleJob("cancel-me", "* * * * *", vi.fn());
    cancelJob("cancel-me");
    expect(listJobs()).not.toContain("cancel-me");
  });

  it("throws when cancelling a non-existent job", () => {
    expect(() => cancelJob("ghost")).toThrowError(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/logic/tests/primitives/schedule-job.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/logic/src/primitives/schedule-job.ts`:

```typescript
import cron from "node-cron";

interface ScheduledJob {
  name: string;
  cronExpression: string;
  task: cron.ScheduledTask;
}

const jobs = new Map<string, ScheduledJob>();

export function scheduleJob(
  name: string,
  cronExpression: string,
  handler: () => Promise<void>
): void {
  if (jobs.has(name)) {
    throw new Error(`Job "${name}" is already registered`);
  }

  const task = cron.schedule(cronExpression, async () => {
    try {
      await handler();
    } catch (error) {
      console.error(`[job:${name}] Error:`, error);
    }
  });

  jobs.set(name, { name, cronExpression, task });
}

export function cancelJob(name: string): void {
  const job = jobs.get(name);
  if (!job) {
    throw new Error(`Job "${name}" not found`);
  }
  job.task.stop();
  jobs.delete(name);
}

export function listJobs(): string[] {
  return Array.from(jobs.keys());
}

export function cancelAllJobs(): void {
  for (const job of jobs.values()) {
    job.task.stop();
  }
  jobs.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/logic/tests/primitives/schedule-job.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add anyclaw-server/packages/logic/src/primitives/schedule-job.ts anyclaw-server/packages/logic/tests/primitives/schedule-job.test.ts
git commit -m "feat: add schedule-job primitive with cron-based job registry"
```

---

### Task 5: Fetch URL Primitive

**Files:**
- Create: `anyclaw-server/packages/logic/src/primitives/fetch-url.ts`
- Create: `anyclaw-server/packages/logic/tests/primitives/fetch-url.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/logic/tests/primitives/fetch-url.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchUrl } from "../../src/primitives/fetch-url.js";

// Use Node's built-in fetch — mock it globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("fetchUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches a URL and returns the response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const response = await fetchUrl("https://example.com/api");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
    expect(response.status).toBe(200);
  });

  it("applies a custom timeout", async () => {
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 10000))
    );

    await expect(
      fetchUrl("https://slow.example.com", { timeoutMs: 50 })
    ).rejects.toThrow();
  });

  it("passes custom headers", async () => {
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await fetchUrl("https://example.com", {
      headers: { Authorization: "Bearer token123" },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token123",
        }),
      })
    );
  });

  it("supports POST method with body", async () => {
    mockFetch.mockResolvedValueOnce(new Response("created", { status: 201 }));

    await fetchUrl("https://example.com/data", {
      method: "POST",
      body: JSON.stringify({ key: "value" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/data",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ key: "value" }),
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/logic/tests/primitives/fetch-url.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/logic/src/primitives/fetch-url.ts`:

```typescript
export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchUrl(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { method = "GET", headers, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/logic/tests/primitives/fetch-url.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add anyclaw-server/packages/logic/src/primitives/fetch-url.ts anyclaw-server/packages/logic/tests/primitives/fetch-url.test.ts
git commit -m "feat: add fetch-url primitive with timeout and custom headers"
```

---

### Task 6: Call LLM Primitive

**Files:**
- Create: `anyclaw-server/packages/logic/src/primitives/call-llm.ts`
- Create: `anyclaw-server/packages/logic/tests/primitives/call-llm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/logic/tests/primitives/call-llm.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { callLLM } from "../../src/primitives/call-llm.js";
import * as fetchMod from "../../src/primitives/fetch-url.js";

vi.mock("../../src/primitives/fetch-url.js", () => ({
  fetchUrl: vi.fn(),
}));

const mockFetchUrl = vi.mocked(fetchMod.fetchUrl);

describe("callLLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls OpenAI-compatible endpoint and returns content", async () => {
    mockFetchUrl.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hello from LLM" } }],
      }),
    } as unknown as Response);

    const result = await callLLM("Say hello", {
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o",
    });

    expect(result).toBe("Hello from LLM");
    expect(mockFetchUrl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Say hello"),
      })
    );
  });

  it("calls Anthropic endpoint and returns content", async () => {
    mockFetchUrl.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Hello from Claude" }],
      }),
    } as unknown as Response);

    const result = await callLLM("Say hello", {
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-20250514",
    });

    expect(result).toBe("Hello from Claude");
    expect(mockFetchUrl).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("throws on non-ok response", async () => {
    mockFetchUrl.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    } as unknown as Response);

    await expect(
      callLLM("test", {
        provider: "openai",
        apiKey: "sk-test",
        model: "gpt-4o",
      })
    ).rejects.toThrow(/LLM request failed.*429/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/logic/tests/primitives/call-llm.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/logic/src/primitives/call-llm.ts`:

```typescript
import { fetchUrl } from "./fetch-url.js";

export interface LLMOptions {
  provider: "openai" | "anthropic";
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

const ENDPOINTS = {
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
} as const;

export async function callLLM(
  prompt: string,
  options: LLMOptions
): Promise<string> {
  const { provider, apiKey, model, maxTokens = 4096, temperature = 0.7 } = options;

  const url = ENDPOINTS[provider];

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  let body: string;

  if (provider === "openai") {
    headers["Authorization"] = `Bearer ${apiKey}`;
    body = JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature,
    });
  } else {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: "user", content: prompt }],
    });
  }

  const response = await fetchUrl(url, {
    method: "POST",
    headers,
    body,
    timeoutMs: 120_000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM request failed with status ${response.status}: ${errorText}`
    );
  }

  const data = await response.json();

  if (provider === "openai") {
    return data.choices[0].message.content;
  } else {
    return data.content[0].text;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/logic/tests/primitives/call-llm.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add anyclaw-server/packages/logic/src/primitives/call-llm.ts anyclaw-server/packages/logic/tests/primitives/call-llm.test.ts
git commit -m "feat: add call-llm primitive with OpenAI and Anthropic support"
```

---

### Task 7: Send Notification Primitive (Stub)

**Files:**
- Create: `anyclaw-server/packages/logic/src/primitives/send-notification.ts`
- Create: `anyclaw-server/packages/logic/tests/primitives/send-notification.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/logic/tests/primitives/send-notification.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendNotification,
  setNotificationHandler,
  resetNotificationHandler,
} from "../../src/primitives/send-notification.js";

describe("sendNotification", () => {
  beforeEach(() => {
    resetNotificationHandler();
  });

  it("logs to console when no handler is set", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendNotification("Test Title", "Test Body");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Test Title"),
      expect.stringContaining("Test Body")
    );
    consoleSpy.mockRestore();
  });

  it("calls the registered handler when set", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    setNotificationHandler(handler);

    await sendNotification("Alert", "Something happened");
    expect(handler).toHaveBeenCalledWith("Alert", "Something happened");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/logic/tests/primitives/send-notification.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/logic/src/primitives/send-notification.ts`:

```typescript
type NotificationHandler = (title: string, body: string) => Promise<void>;

let handler: NotificationHandler | null = null;

export async function sendNotification(
  title: string,
  body: string
): Promise<void> {
  if (handler) {
    await handler(title, body);
  } else {
    console.log(`[notification] ${title}: ${body}`);
  }
}

export function setNotificationHandler(h: NotificationHandler): void {
  handler = h;
}

export function resetNotificationHandler(): void {
  handler = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/logic/tests/primitives/send-notification.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add anyclaw-server/packages/logic/src/primitives/send-notification.ts anyclaw-server/packages/logic/tests/primitives/send-notification.test.ts
git commit -m "feat: add send-notification primitive with pluggable handler"
```

---

### Task 8: Express Server Entrypoint with Route Loader

**Files:**
- Create: `anyclaw-server/packages/logic/src/index.ts`
- Create: `anyclaw-server/packages/logic/src/routes/_example.ts`

- [ ] **Step 1: Create the Express server entrypoint**

Create `packages/logic/src/index.ts`:

```typescript
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = express();

app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Dynamic route loader: loads all .js files from routes/ directory
async function loadRoutes(routesDir: string): Promise<void> {
  if (!fs.existsSync(routesDir)) return;

  const files = fs.readdirSync(routesDir).filter(
    (f) => f.endsWith(".ts") || f.endsWith(".js")
  );

  for (const file of files) {
    if (file.startsWith("_")) continue; // Skip example/template files
    const routeModule = await import(path.join(routesDir, file));
    if (typeof routeModule.register === "function") {
      routeModule.register(app);
      console.log(`[routes] Loaded: ${file}`);
    }
  }
}

// Dynamic job loader: loads all .js files from jobs/ directory
async function loadJobs(jobsDir: string): Promise<void> {
  if (!fs.existsSync(jobsDir)) return;

  const files = fs.readdirSync(jobsDir).filter(
    (f) => f.endsWith(".ts") || f.endsWith(".js")
  );

  for (const file of files) {
    if (file.startsWith("_")) continue;
    const jobModule = await import(path.join(jobsDir, file));
    if (typeof jobModule.register === "function") {
      jobModule.register();
      console.log(`[jobs] Loaded: ${file}`);
    }
  }
}

async function start(): Promise<void> {
  const srcDir = path.dirname(new URL(import.meta.url).pathname);
  await loadRoutes(path.join(srcDir, "routes"));
  await loadJobs(path.join(srcDir, "jobs"));

  app.listen(config.PORT, () => {
    console.log(`[logic] Server running on port ${config.PORT}`);
  });
}

start().catch((err) => {
  console.error("[logic] Failed to start:", err);
  process.exit(1);
});

export { app };
```

- [ ] **Step 2: Create the example route template**

Create `packages/logic/src/routes/_example.ts`:

```typescript
/**
 * Example route template.
 * The agent copies this pattern when creating new routes.
 * Files starting with _ are ignored by the route loader.
 *
 * Each route module exports a `register` function that receives
 * the Express app and adds its endpoints.
 */
import type { Express } from "express";

export function register(app: Express): void {
  app.get("/api/example", (_req, res) => {
    res.json({ message: "This is an example route" });
  });
}
```

- [ ] **Step 3: Create the example job template**

Create `packages/logic/src/jobs/_example.ts`:

```typescript
/**
 * Example job template.
 * The agent copies this pattern when creating new background jobs.
 * Files starting with _ are ignored by the job loader.
 *
 * Each job module exports a `register` function that sets up
 * the scheduled task using the scheduleJob primitive.
 */
import { scheduleJob } from "../primitives/schedule-job.js";

export function register(): void {
  scheduleJob("example-job", "0 * * * *", async () => {
    console.log("[example-job] Running hourly task");
  });
}
```

- [ ] **Step 4: Verify typecheck passes**

```bash
cd F:/Codes/AnyClaw/anyclaw-server
npx tsc --noEmit --project packages/logic/tsconfig.json
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add anyclaw-server/packages/logic/src/index.ts anyclaw-server/packages/logic/src/routes/_example.ts anyclaw-server/packages/logic/src/jobs/_example.ts
git commit -m "feat: add Express server with dynamic route and job loaders"
```

---

### Task 9: React Frontend Scaffold

**Files:**
- Create: `anyclaw-server/packages/frontend/index.html`
- Create: `anyclaw-server/packages/frontend/src/main.tsx`
- Create: `anyclaw-server/packages/frontend/src/App.tsx`
- Create: `anyclaw-server/packages/frontend/src/pages/Home.tsx`
- Create: `anyclaw-server/packages/frontend/src/components/Layout.tsx`
- Create: `anyclaw-server/packages/frontend/src/lib/pocketbase.ts`
- Create: `anyclaw-server/packages/frontend/src/lib/api.ts`

- [ ] **Step 1: Create `index.html`**

Create `packages/frontend/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AnyClaw</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create React entrypoint and App shell**

Create `packages/frontend/src/main.tsx`:

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

Create `packages/frontend/src/App.tsx`:

```typescript
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Home } from "./pages/Home.js";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </Layout>
  );
}
```

- [ ] **Step 3: Create Layout and Home page**

Create `packages/frontend/src/components/Layout.tsx`:

```typescript
import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <main style={{ flex: 1, padding: "1rem" }}>
        {children}
      </main>
    </div>
  );
}
```

Create `packages/frontend/src/pages/Home.tsx`:

```typescript
export function Home() {
  return (
    <div>
      <h1>AnyClaw</h1>
      <p>Your personal AI-built dashboard. Ask your agent to create something.</p>
    </div>
  );
}
```

- [ ] **Step 4: Create PocketBase and API client libraries**

Create `packages/frontend/src/lib/pocketbase.ts`:

```typescript
import PocketBase from "pocketbase";

/**
 * PocketBase client for the frontend.
 * In dev, Vite proxies /pb/* to the PocketBase server.
 * In prod, the reverse proxy handles routing.
 */
export const pb = new PocketBase(
  import.meta.env.VITE_POCKETBASE_URL || "/pb"
);
```

Create `packages/frontend/src/lib/api.ts`:

```typescript
/**
 * API client for the Node.js logic service.
 * In dev, Vite proxies /api/* to the logic server.
 * In prod, the reverse proxy handles routing.
 */
const BASE_URL = import.meta.env.VITE_API_URL || "/api";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`API GET ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`API POST ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
```

- [ ] **Step 5: Verify the frontend builds**

```bash
cd F:/Codes/AnyClaw/anyclaw-server
npx --workspace=packages/frontend tsc --noEmit
npx --workspace=packages/frontend vite build
```

Expected: typecheck passes, vite build produces `packages/frontend/dist/` with bundled output.

- [ ] **Step 6: Commit**

```bash
git add anyclaw-server/packages/frontend/
git commit -m "feat: scaffold React frontend with routing, PocketBase client, and API client"
```

---

### Task 10: Snapshot Manager

**Files:**
- Create: `anyclaw-server/packages/deploy/src/snapshot-manager.ts`
- Create: `anyclaw-server/packages/deploy/tests/snapshot-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/deploy/tests/snapshot-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createSnapshot,
  restoreSnapshot,
  listSnapshots,
  pruneSnapshots,
} from "../src/snapshot-manager.js";

describe("SnapshotManager", () => {
  let tmpDir: string;
  let dbPath: string;
  let snapshotDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anyclaw-snap-"));
    dbPath = path.join(tmpDir, "data.db");
    snapshotDir = path.join(tmpDir, "snapshots");
    fs.mkdirSync(snapshotDir);
    // Create a fake SQLite DB file
    fs.writeFileSync(dbPath, "SQLite format 3\x00 -- fake db content v1");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a compressed snapshot of the database", async () => {
    const snapshotId = await createSnapshot(dbPath, snapshotDir, "v1-initial");
    expect(snapshotId).toMatch(/^v1-initial-/);

    const files = fs.readdirSync(snapshotDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.gz$/);
  });

  it("restores a snapshot to the original path", async () => {
    const snapshotId = await createSnapshot(dbPath, snapshotDir, "v1-initial");

    // Modify the DB
    fs.writeFileSync(dbPath, "SQLite format 3\x00 -- modified content");

    await restoreSnapshot(snapshotId, snapshotDir, dbPath);

    const content = fs.readFileSync(dbPath, "utf-8");
    expect(content).toBe("SQLite format 3\x00 -- fake db content v1");
  });

  it("lists snapshots in reverse chronological order", async () => {
    await createSnapshot(dbPath, snapshotDir, "v1");
    // Modify to make a different snapshot
    fs.writeFileSync(dbPath, "SQLite format 3\x00 -- v2");
    await createSnapshot(dbPath, snapshotDir, "v2");

    const snapshots = listSnapshots(snapshotDir);
    expect(snapshots.length).toBe(2);
    // Most recent first
    expect(snapshots[0].label).toBe("v2");
    expect(snapshots[1].label).toBe("v1");
  });

  it("prunes old snapshots beyond the retention limit", async () => {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(dbPath, `SQLite format 3\x00 -- v${i}`);
      await createSnapshot(dbPath, snapshotDir, `v${i}`);
    }

    pruneSnapshots(snapshotDir, 3);

    const snapshots = listSnapshots(snapshotDir);
    expect(snapshots.length).toBe(3);
    // Should keep the 3 most recent
    expect(snapshots[0].label).toBe("v4");
    expect(snapshots[2].label).toBe("v2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/deploy/tests/snapshot-manager.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/deploy/src/snapshot-manager.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

export interface SnapshotMeta {
  id: string;
  label: string;
  filename: string;
  createdAt: number;
  sizeBytes: number;
}

/**
 * Creates a gzip-compressed copy of the database file.
 * Returns a snapshot ID (label + timestamp).
 */
export async function createSnapshot(
  dbPath: string,
  snapshotDir: string,
  label: string
): Promise<string> {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  const timestamp = Date.now();
  const sanitizedLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
  const snapshotId = `${sanitizedLabel}-${timestamp}`;
  const filename = `${snapshotId}.db.gz`;
  const snapshotPath = path.join(snapshotDir, filename);

  const source = fs.createReadStream(dbPath);
  const gzip = createGzip({ level: 6 });
  const destination = fs.createWriteStream(snapshotPath);

  await pipeline(source, gzip, destination);

  return snapshotId;
}

/**
 * Restores a snapshot by decompressing it back to the target path.
 */
export async function restoreSnapshot(
  snapshotId: string,
  snapshotDir: string,
  targetPath: string
): Promise<void> {
  const filename = `${snapshotId}.db.gz`;
  const snapshotPath = path.join(snapshotDir, filename);

  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const source = fs.createReadStream(snapshotPath);
  const gunzip = createGunzip();
  const destination = fs.createWriteStream(targetPath);

  await pipeline(source, gunzip, destination);
}

/**
 * Lists all snapshots in the directory, most recent first.
 */
export function listSnapshots(snapshotDir: string): SnapshotMeta[] {
  if (!fs.existsSync(snapshotDir)) return [];

  const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".db.gz"));

  return files
    .map((filename) => {
      const stats = fs.statSync(path.join(snapshotDir, filename));
      // Parse: label-timestamp.db.gz
      const withoutExt = filename.replace(/\.db\.gz$/, "");
      const lastDash = withoutExt.lastIndexOf("-");
      const label = withoutExt.substring(0, lastDash);
      const timestamp = parseInt(withoutExt.substring(lastDash + 1), 10);

      return {
        id: withoutExt,
        label,
        filename,
        createdAt: timestamp,
        sizeBytes: stats.size,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Removes the oldest snapshots beyond the retention limit.
 */
export function pruneSnapshots(
  snapshotDir: string,
  maxSnapshots: number
): void {
  const snapshots = listSnapshots(snapshotDir);
  const toRemove = snapshots.slice(maxSnapshots);

  for (const snap of toRemove) {
    fs.unlinkSync(path.join(snapshotDir, snap.filename));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/deploy/tests/snapshot-manager.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add anyclaw-server/packages/deploy/src/snapshot-manager.ts anyclaw-server/packages/deploy/tests/snapshot-manager.test.ts
git commit -m "feat: add snapshot manager for SQLite DB backup and restore"
```

---

### Task 11: Version Store (Git-Based)

**Files:**
- Create: `anyclaw-server/packages/deploy/src/version-store.ts`
- Create: `anyclaw-server/packages/deploy/tests/version-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/deploy/tests/version-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  commitVersion,
  listVersions,
  checkoutVersion,
} from "../src/version-store.js";

describe("VersionStore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anyclaw-git-"));
    execSync("git init", { cwd: tmpDir });
    execSync('git config user.email "test@anyclaw.local"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    // Create initial file and commit
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# AnyClaw");
    execSync("git add . && git commit -m 'initial'", { cwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("commits a new version with a tag and description", async () => {
    fs.writeFileSync(path.join(tmpDir, "app.txt"), "version 1");
    const version = await commitVersion(tmpDir, {
      description: "Added the first feature",
    });

    expect(version.tag).toMatch(/^v\d+\.\d+\.\d+-/);
    expect(version.description).toBe("Added the first feature");

    // Verify git tag exists
    const tags = execSync("git tag", { cwd: tmpDir, encoding: "utf-8" });
    expect(tags).toContain(version.tag);
  });

  it("lists versions in reverse chronological order", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
    await commitVersion(tmpDir, { description: "Feature A" });

    fs.writeFileSync(path.join(tmpDir, "b.txt"), "b");
    await commitVersion(tmpDir, { description: "Feature B" });

    const versions = await listVersions(tmpDir);
    expect(versions.length).toBe(2);
    expect(versions[0].description).toBe("Feature B");
    expect(versions[1].description).toBe("Feature A");
  });

  it("checks out a previous version by tag", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "v1 content");
    const v1 = await commitVersion(tmpDir, { description: "Version 1" });

    fs.writeFileSync(path.join(tmpDir, "file.txt"), "v2 content");
    await commitVersion(tmpDir, { description: "Version 2" });

    await checkoutVersion(tmpDir, v1.tag);

    const content = fs.readFileSync(path.join(tmpDir, "file.txt"), "utf-8");
    expect(content).toBe("v1 content");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/deploy/tests/version-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/deploy/src/version-store.ts`:

```typescript
import { simpleGit, type SimpleGit } from "simple-git";

export interface VersionInfo {
  tag: string;
  description: string;
  commitHash: string;
  createdAt: string;
}

interface CommitOptions {
  description: string;
}

function createTag(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  return `v${date}-${time}`;
}

export async function commitVersion(
  repoPath: string,
  options: CommitOptions
): Promise<VersionInfo> {
  const git: SimpleGit = simpleGit(repoPath);

  // Stage all changes
  await git.add(".");

  // Commit with the description
  const commitMessage = `deploy: ${options.description}`;
  const commitResult = await git.commit(commitMessage);

  const tag = createTag();
  // Annotated tag with the description as the tag message
  await git.addAnnotatedTag(tag, options.description);

  return {
    tag,
    description: options.description,
    commitHash: commitResult.commit,
    createdAt: new Date().toISOString(),
  };
}

export async function listVersions(repoPath: string): Promise<VersionInfo[]> {
  const git: SimpleGit = simpleGit(repoPath);

  const tags = await git.tags(["--sort=-creatordate"]);
  const versions: VersionInfo[] = [];

  for (const tag of tags.all) {
    try {
      // Get the tag message (which is the description)
      const tagMessage = await git.raw(["tag", "-l", "--format=%(contents)", tag]);
      // Get the commit hash the tag points to
      const commitHash = await git.raw(["rev-list", "-1", tag]);

      versions.push({
        tag,
        description: tagMessage.trim(),
        commitHash: commitHash.trim(),
        createdAt: tag, // The tag name encodes the timestamp
      });
    } catch {
      // Skip malformed tags
    }
  }

  return versions;
}

export async function checkoutVersion(
  repoPath: string,
  tag: string
): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  await git.checkout(tag);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/deploy/tests/version-store.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add anyclaw-server/packages/deploy/src/version-store.ts anyclaw-server/packages/deploy/tests/version-store.test.ts
git commit -m "feat: add git-based version store with tagging and checkout"
```

---

### Task 12: Deploy Manager (Validate → Commit → Snapshot → Promote)

**Files:**
- Create: `anyclaw-server/packages/deploy/src/deploy-manager.ts`
- Create: `anyclaw-server/packages/deploy/tests/deploy-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/deploy/tests/deploy-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DeployManager,
  type DeployResult,
  type ValidationResult,
} from "../src/deploy-manager.js";
import * as snapshotMgr from "../src/snapshot-manager.js";
import * as versionStore from "../src/version-store.js";
import type { DeployConfig } from "../src/config.js";

vi.mock("../src/snapshot-manager.js", () => ({
  createSnapshot: vi.fn().mockResolvedValue("snap-123"),
  pruneSnapshots: vi.fn(),
}));

vi.mock("../src/version-store.js", () => ({
  commitVersion: vi.fn().mockResolvedValue({
    tag: "v20260405-120000",
    description: "test deploy",
    commitHash: "abc123",
    createdAt: "2026-04-05T12:00:00Z",
  }),
}));

describe("DeployManager", () => {
  let manager: DeployManager;
  let mockConfig: DeployConfig;
  let mockRunCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      serverRoot: "/tmp/anyclaw",
      pbDataDir: "/tmp/anyclaw/pocketbase/pb_data",
      devDir: "/tmp/anyclaw/packages",
      prodDir: "/tmp/anyclaw/prod",
      snapshotDir: "/tmp/anyclaw/snapshots",
      maxSnapshots: 20,
      dbFilename: "data.db",
    };

    mockRunCommand = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    manager = new DeployManager(mockConfig, mockRunCommand);
  });

  it("runs validation suite and returns pass result", async () => {
    const result: ValidationResult = await manager.validate();

    expect(result.passed).toBe(true);
    expect(mockRunCommand).toHaveBeenCalledWith(
      expect.stringContaining("eslint"),
      expect.any(String)
    );
    expect(mockRunCommand).toHaveBeenCalledWith(
      expect.stringContaining("tsc"),
      expect.any(String)
    );
    expect(mockRunCommand).toHaveBeenCalledWith(
      expect.stringContaining("vite build"),
      expect.any(String)
    );
  });

  it("returns fail result when a validation step fails", async () => {
    mockRunCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }) // lint ok
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "Type error" }); // typecheck fails

    const result = await manager.validate();
    expect(result.passed).toBe(false);
    expect(result.failedStep).toBe("typecheck");
    expect(result.error).toContain("Type error");
  });

  it("deploy runs validate → snapshot → commit → promote", async () => {
    const copySpy = vi.fn().mockResolvedValue(undefined);
    manager.setCopyToProduction(copySpy);

    const result: DeployResult = await manager.deploy("Added mood tracker");

    expect(result.success).toBe(true);
    // Verify order: validate first
    expect(mockRunCommand).toHaveBeenCalled();
    // Then snapshot
    expect(snapshotMgr.createSnapshot).toHaveBeenCalled();
    // Then commit
    expect(versionStore.commitVersion).toHaveBeenCalledWith(
      expect.any(String),
      { description: "Added mood tracker" }
    );
    // Then promote
    expect(copySpy).toHaveBeenCalled();
    // Then prune
    expect(snapshotMgr.pruneSnapshots).toHaveBeenCalled();
  });

  it("deploy fails without promoting when validation fails", async () => {
    mockRunCommand.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "Lint error",
    });

    const copySpy = vi.fn();
    manager.setCopyToProduction(copySpy);

    const result = await manager.deploy("Bad deploy");

    expect(result.success).toBe(false);
    expect(copySpy).not.toHaveBeenCalled();
    expect(versionStore.commitVersion).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/deploy/tests/deploy-manager.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/deploy/src/deploy-manager.ts`:

```typescript
import path from "node:path";
import { createSnapshot, pruneSnapshots } from "./snapshot-manager.js";
import { commitVersion, type VersionInfo } from "./version-store.js";
import type { DeployConfig } from "./config.js";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type RunCommand = (
  command: string,
  cwd: string
) => Promise<CommandResult>;

export interface ValidationResult {
  passed: boolean;
  failedStep?: string;
  error?: string;
}

export interface DeployResult {
  success: boolean;
  version?: VersionInfo;
  snapshotId?: string;
  validation?: ValidationResult;
  error?: string;
}

type CopyFn = () => Promise<void>;

const VALIDATION_STEPS = [
  { name: "lint", command: "npx eslint src/" },
  { name: "typecheck", command: "npx tsc --noEmit" },
  { name: "build", command: "npx vite build" },
] as const;

export class DeployManager {
  private config: DeployConfig;
  private runCommand: RunCommand;
  private copyToProduction: CopyFn = async () => {};

  constructor(config: DeployConfig, runCommand: RunCommand) {
    this.config = config;
    this.runCommand = runCommand;
  }

  setCopyToProduction(fn: CopyFn): void {
    this.copyToProduction = fn;
  }

  async validate(): Promise<ValidationResult> {
    const frontendDir = path.join(this.config.devDir, "frontend");

    for (const step of VALIDATION_STEPS) {
      const result = await this.runCommand(step.command, frontendDir);
      if (result.exitCode !== 0) {
        return {
          passed: false,
          failedStep: step.name,
          error: result.stderr || result.stdout,
        };
      }
    }

    return { passed: true };
  }

  async deploy(description: string): Promise<DeployResult> {
    // Step 1: Validate
    const validation = await this.validate();
    if (!validation.passed) {
      return { success: false, validation, error: `Validation failed at step: ${validation.failedStep}` };
    }

    // Step 2: Snapshot DB
    const dbPath = path.join(this.config.pbDataDir, this.config.dbFilename);
    let snapshotId: string | undefined;
    try {
      snapshotId = await createSnapshot(
        dbPath,
        this.config.snapshotDir,
        description.slice(0, 40).replace(/\s+/g, "-")
      );
    } catch (err) {
      // DB might not exist yet (first deploy). That's OK.
      console.warn("[deploy] DB snapshot skipped:", err);
    }

    // Step 3: Commit to git
    const version = await commitVersion(this.config.serverRoot, {
      description,
    });

    // Step 4: Promote to production
    await this.copyToProduction();

    // Step 5: Prune old snapshots
    pruneSnapshots(this.config.snapshotDir, this.config.maxSnapshots);

    return { success: true, version, snapshotId, validation };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/deploy/tests/deploy-manager.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add anyclaw-server/packages/deploy/src/deploy-manager.ts anyclaw-server/packages/deploy/tests/deploy-manager.test.ts
git commit -m "feat: add deploy manager with validate → snapshot → commit → promote pipeline"
```

---

### Task 13: Primitives Barrel Export & Run All Tests

**Files:**
- Create: `anyclaw-server/packages/logic/src/primitives/index.ts`
- Create: `anyclaw-server/packages/deploy/src/index.ts`

- [ ] **Step 1: Create barrel exports**

Create `packages/logic/src/primitives/index.ts`:

```typescript
export { getPocketBase, resetPocketBaseClient } from "./get-pocketbase.js";
export { scheduleJob, cancelJob, listJobs, cancelAllJobs } from "./schedule-job.js";
export { fetchUrl, type FetchOptions } from "./fetch-url.js";
export { callLLM, type LLMOptions } from "./call-llm.js";
export {
  sendNotification,
  setNotificationHandler,
  resetNotificationHandler,
} from "./send-notification.js";
```

Create `packages/deploy/src/index.ts`:

```typescript
export { DeployManager, type DeployResult, type ValidationResult } from "./deploy-manager.js";
export {
  createSnapshot,
  restoreSnapshot,
  listSnapshots,
  pruneSnapshots,
  type SnapshotMeta,
} from "./snapshot-manager.js";
export {
  commitVersion,
  listVersions,
  checkoutVersion,
  type VersionInfo,
} from "./version-store.js";
export { createDeployConfig, type DeployConfig } from "./config.js";
```

- [ ] **Step 2: Run all tests across all packages**

```bash
cd F:/Codes/AnyClaw/anyclaw-server
npm test
```

Expected: all tests pass across logic and deploy packages.

- [ ] **Step 3: Run typecheck across all packages**

```bash
npm run typecheck
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add anyclaw-server/packages/logic/src/primitives/index.ts anyclaw-server/packages/deploy/src/index.ts
git commit -m "feat: add barrel exports for logic primitives and deploy package"
```

---

## Summary

| Task | What it builds | Key files |
|------|---------------|-----------|
| 1 | Monorepo scaffold | `package.json`, workspace configs |
| 2 | Environment config | `config.ts` (logic + deploy) |
| 3 | PocketBase admin client | `get-pocketbase.ts` |
| 4 | Job scheduler | `schedule-job.ts` |
| 5 | HTTP client | `fetch-url.ts` |
| 6 | LLM caller | `call-llm.ts` |
| 7 | Notification sender | `send-notification.ts` |
| 8 | Express server + loaders | `index.ts`, route/job patterns |
| 9 | React frontend scaffold | Pages, layout, API clients |
| 10 | DB snapshot manager | `snapshot-manager.ts` |
| 11 | Git version store | `version-store.ts` |
| 12 | Deploy pipeline | `deploy-manager.ts` |
| 13 | Barrel exports + full test | `index.ts` for both packages |

After completing this plan, the server infrastructure is fully operational and testable. **Plan 2 (MCP Server)** builds on top of this by exposing these primitives and the deploy manager as MCP tools.
