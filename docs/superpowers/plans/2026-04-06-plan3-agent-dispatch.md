# Plan 3: Agent Dispatch Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for every task below. Each task is a self-contained TDD cycle: write a failing test, run it and confirm it fails for the right reason, implement the minimum code to pass, run the test and confirm it passes, then commit. Do not batch tasks. Do not skip the "confirm fail" step. If a test passes before implementation, the test is wrong — fix it first.

**Goal:** Build the pluggable agent dispatch layer that translates mobile-app task requests into running coding-agent sessions (OpenClaw, Claude Code, or webhook), manages the task lifecycle in isolated git worktrees with exactly-once semantics, and exposes the REST API the mobile app drives.

**Architecture:** A new `dispatch-server` package inside the `anyclaw-server` monorepo hosts a single Node.js process that runs both the MCP HTTP/SSE endpoint (Plan 2) and the mobile REST API (this plan). An `AdapterManager` owns the single active task, creates a per-task git worktree under `dev/.worktrees/`, instantiates the configured `AgentAdapter` (OpenClaw / Claude Code / Webhook), and persists every lifecycle transition to PocketBase so the entire task graph survives a process restart.

**Tech Stack:** Express, ws, simple-git, child_process, zod, vitest
**Dependencies:** Plan 1, Plan 2.
**Plans that depend on this:** Plan 5 (Mobile App).

---

## Product Principles (applied throughout)

1. **Exactly-once, never lost.** Client-generated UUIDs + idempotent upsert + startup sweep. A retried submission is always safe; a dropped submission is always visible to the user as `failed`.
2. **Isolation by default.** Every task runs in its own git worktree. Failure never touches `main`. Future parallelization is a scheduler change, not a rewrite.
3. **Agent-agnostic surface.** The `AgentAdapter` interface is small enough that a new agent (Codex, Aider, Gemini CLI) is a single new file.
4. **Control plane is unkillable.** The dispatch server lives under `.anyclaw/` outside the agent's writable path. Agents cannot edit the process that supervises them.
5. **No silent waits.** Every blocking operation (clarification, dispatch, subprocess wait) has an `AbortSignal` and a persisted state so the mobile app always sees ground truth.

---

## Package Layout

This plan creates `anyclaw-server/packages/dispatch-server/`. It shares a process with the Plan 2 MCP server (same `index.ts` entry point; MCP router mounted on the same Express app).

```
anyclaw-server/packages/dispatch-server/
├── src/
│   ├── index.ts
│   ├── rest/
│   │   ├── router.ts
│   │   ├── tasks.ts
│   │   ├── adapter.ts
│   │   ├── emergency.ts
│   │   └── webhook-callback.ts
│   ├── adapters/
│   │   ├── types.ts
│   │   ├── manager.ts
│   │   ├── openclaw.ts
│   │   ├── claude-code.ts
│   │   └── webhook.ts
│   ├── worktrees/manager.ts
│   ├── resource-limits/
│   │   ├── types.ts
│   │   └── noop.ts
│   ├── lifecycle/state-machine.ts
│   ├── persistence/
│   │   ├── pocketbase-client.ts
│   │   └── tasks-repo.ts
│   └── util/
│       ├── async-queue.ts
│       └── terminal-states.ts
├── test/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Task 0: Scaffold the dispatch-server package

**Red:** Create `test/unit/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { version } from "../../package.json";
describe("dispatch-server package", () => {
  it("exports a version", () => { expect(version).toBe("0.0.1"); });
});
```
Run `pnpm --filter @anyclaw/dispatch-server test`. Confirm failure (package does not yet exist).

**Green:** Create `package.json` with `name: "@anyclaw/dispatch-server"`, `version: "0.0.1"`, deps on `express`, `ws`, `simple-git`, `zod`, devDeps on `vitest`, `@types/node`, `@types/express`, `@types/ws`, `typescript`. Add `tsconfig.json` extending the monorepo base with `"rootDir": "src"`, `"outDir": "dist"`, `"strict": true`. Add minimal `vitest.config.ts`. Add this package to the root pnpm-workspace.yaml if not already globbed. Re-run test; confirm pass.

**Commit:** `plan3(task0): scaffold dispatch-server package`

---

## Task 1: Core types (`adapters/types.ts`)

**Red:** `test/unit/types.test.ts`:
```ts
import { AdapterError, isTerminal } from "../../src/adapters/types";
describe("TaskState terminal detection", () => {
  it("treats done/failed/cancelled as terminal", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });
  it("treats queued/working/clarifying/deploying as non-terminal", () => {
    for (const s of ["queued","working","clarifying","deploying"] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });
  it("AdapterError preserves code and retryable flag", () => {
    const e = new AdapterError("nope", "AGENT_UNREACHABLE", true);
    expect(e.code).toBe("AGENT_UNREACHABLE");
    expect(e.retryable).toBe(true);
  });
});
```
Confirm fail.

**Green:** Implement `src/adapters/types.ts` with `TaskState`, `TaskStatus`, `TaskHandle`, `ActivityEntry`, `AdapterErrorCode`, `AdapterError`, `AgentAdapter`, `SystemContext`, `DispatchConfig`, and a small `isTerminal(state: TaskState): boolean` helper. Confirm pass.

**Commit:** `plan3(task1): agent-adapter core types`

---

## Task 2: `AsyncQueue` utility

**Red:** `test/unit/async-queue.test.ts`:
```ts
import { AsyncQueue } from "../../src/util/async-queue";
it("yields pushed values in order then closes", async () => {
  const q = new AsyncQueue<number>();
  q.push(1); q.push(2); q.close();
  const out: number[] = [];
  for await (const v of q) out.push(v);
  expect(out).toEqual([1, 2]);
});
it("awaits values pushed after iteration starts", async () => {
  const q = new AsyncQueue<string>();
  const p = (async () => { const out: string[] = []; for await (const v of q) out.push(v); return out; })();
  setTimeout(() => { q.push("a"); q.push("b"); q.close(); }, 10);
  expect(await p).toEqual(["a", "b"]);
});
```
Confirm fail.

**Green:** Implement a minimal promise-based queue exposing `push`, `close`, and `[Symbol.asyncIterator]`. Expose a `lastSeq` field used by Claude Code adapter. Confirm pass.

**Commit:** `plan3(task2): async queue utility`

---

## Task 3: `ResourceLimits` no-op placeholder

**Red:** `test/unit/resource-limits.test.ts`:
```ts
import { NoopResourceLimits } from "../../src/resource-limits/noop";
it("prepare returns null, apply/release are no-ops", async () => {
  const r = new NoopResourceLimits();
  expect(await r.prepare("t1", { cpuQuotaPercent: 200, memoryMaxMb: 2048 })).toBeNull();
  await expect(r.apply(1234, "handle")).resolves.toBeUndefined();
  await expect(r.release("handle")).resolves.toBeUndefined();
});
```
Confirm fail.

**Green:** Create `src/resource-limits/types.ts` with `ResourceLimits` and `ResourceLimitConfig` interfaces. Create `src/resource-limits/noop.ts` with `NoopResourceLimits` class per design §6. Confirm pass.

**Commit:** `plan3(task3): ResourceLimits no-op interface`

---

## Task 4: `WorktreeManager` over a temp git repo

**Red:** `test/unit/worktree-manager.test.ts`:
```ts
import { WorktreeManager } from "../../src/worktrees/manager";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import simpleGit from "simple-git";

let repo: string;
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "wt-"));
  const g = simpleGit(repo);
  await g.init(["--initial-branch=main"]);
  await writeFile(join(repo, "README.md"), "seed\n");
  await g.add(".").commit("seed");
});
afterEach(() => rm(repo, { recursive: true, force: true }));

it("create spawns worktree on branch task/<id>", async () => {
  const m = new WorktreeManager(repo);
  const path = await m.create("abc123");
  expect(path).toContain("task-abc123");
  const branches = await simpleGit(repo).branch();
  expect(branches.all).toContain("task/abc123");
});

it("mergeAndRemove fast-forwards main and deletes branch", async () => {
  const m = new WorktreeManager(repo);
  const path = await m.create("abc123");
  await writeFile(join(path, "f.txt"), "hi");
  const g = simpleGit(path);
  await g.add(".").commit("work");
  await m.mergeAndRemove("abc123");
  const log = await simpleGit(repo).log();
  expect(log.latest?.message).toBe("work");
});

it("discard removes worktree and branch even with uncommitted changes", async () => {
  const m = new WorktreeManager(repo);
  const path = await m.create("xyz");
  await writeFile(join(path, "dirty.txt"), "dirty");
  await m.discard("xyz");
  const branches = await simpleGit(repo).branch();
  expect(branches.all).not.toContain("task/xyz");
});
```
Confirm fail.

**Green:** Implement `WorktreeManager` using `simple-git` (not raw `exec`) for cross-platform reliability. Methods: `create(taskId)`, `mergeAndRemove(taskId)`, `discard(taskId)`. `discard` swallows errors and force-removes. Confirm all three tests pass.

**Commit:** `plan3(task4): WorktreeManager with merge/discard`

---

## Task 5: Task lifecycle state machine

**Red:** `test/unit/state-machine.test.ts`:
```ts
import { transition, TransitionError } from "../../src/lifecycle/state-machine";
it("queued -> working on scheduler_pick", () => {
  expect(transition("queued", "scheduler_pick")).toBe("working");
});
it("working -> clarifying on ask_user", () => {
  expect(transition("working", "ask_user")).toBe("clarifying");
});
it("clarifying -> working on answer", () => {
  expect(transition("clarifying", "answer")).toBe("working");
});
it("working -> deploying on deploy_called", () => {
  expect(transition("working", "deploy_called")).toBe("deploying");
});
it("deploying -> done on validation_pass", () => {
  expect(transition("deploying", "validation_pass")).toBe("done");
});
it("any non-terminal -> cancelled on cancel", () => {
  for (const s of ["queued","working","clarifying","deploying"] as const) {
    expect(transition(s, "cancel")).toBe("cancelled");
  }
});
it("rejects terminal -> anything", () => {
  expect(() => transition("done", "cancel")).toThrow(TransitionError);
  expect(() => transition("failed", "answer")).toThrow(TransitionError);
});
it("rejects nonsense transitions", () => {
  expect(() => transition("queued", "answer")).toThrow(TransitionError);
});
```
Confirm fail.

**Green:** Implement `src/lifecycle/state-machine.ts` as a pure function over a transition table derived from design §4.2. Export `TransitionError`. Confirm pass.

**Commit:** `plan3(task5): task lifecycle state machine`

---

## Task 6: `TasksRepo` against in-memory PocketBase client

**Red:** `test/unit/tasks-repo.test.ts`. Use a **mock PocketBase** — a tiny handwritten object exposing `collection(name).create/getFirstListItem/update/getFullList` backed by `Map`s. No network. Tests:
```ts
it("createIfAbsent returns existing row without duplicating", async () => {
  const repo = new TasksRepo(fakePb);
  const a = await repo.createIfAbsent({ taskId: "u1", request: "r", adapterType: "claude-code", systemContext: "{}", worktreePath: "/w" });
  const b = await repo.createIfAbsent({ taskId: "u1", request: "r", adapterType: "claude-code", systemContext: "{}", worktreePath: "/w" });
  expect(a.id).toBe(b.id);
  expect(fakePb.collection("tasks").count()).toBe(1);
});

it("applyTransition validates against state machine and bumps seq", async () => {
  const repo = new TasksRepo(fakePb);
  await repo.createIfAbsent({ taskId: "u2", request: "r", adapterType: "claude-code", systemContext: "{}", worktreePath: "/w" });
  await repo.applyTransition("u2", "scheduler_pick", {});
  const row = await repo.getByTaskId("u2");
  expect(row.state).toBe("working");
  expect(row.seq).toBe(1);
});

it("sweepOnStartup moves working/deploying to failed", async () => {
  // seed two rows directly in fakePb
  await seedTask(fakePb, "a", "working");
  await seedTask(fakePb, "b", "deploying");
  await seedTask(fakePb, "c", "clarifying");
  const repo = new TasksRepo(fakePb);
  const swept = await repo.sweepOnStartup();
  expect(swept.map(s => s.taskId).sort()).toEqual(["a","b"]);
  expect((await repo.getByTaskId("c")).state).toBe("clarifying");
});
```
Confirm fail.

**Green:** Implement `src/persistence/tasks-repo.ts`. It wraps the PocketBase client (`src/persistence/pocketbase-client.ts` exports a type + a getter so tests can inject a fake). `createIfAbsent` first tries `getFirstListItem` by `taskId` then `create` on 404. `applyTransition` reads, runs `transition()`, writes the new state + side fields + `seq++`. `sweepOnStartup` calls `getFullList({ filter: 'state = "working" || state = "deploying"' })`, updates each to `failed` with `error = "server_restart"`, returns them. Confirm all three tests pass.

**Commit:** `plan3(task6): TasksRepo with idempotent insert and startup sweep`

---

## Task 7: `OpenClawAdapter` against a mock WebSocket server

**Red:** `test/unit/openclaw-adapter.test.ts`. Spin up a real `ws` server on `127.0.0.1:0`, capturing frames and scripting replies:
```ts
import { WebSocketServer } from "ws";
import { OpenClawAdapter } from "../../src/adapters/openclaw";

let wss: WebSocketServer, url: string;
beforeEach((done) => {
  wss = new WebSocketServer({ port: 0 }, () => {
    const port = (wss.address() as any).port;
    url = `ws://127.0.0.1:${port}`;
    done();
  });
  wss.on("connection", (sock) => {
    sock.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n", ts: 1 } }));
    sock.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.method === "connect") {
        sock.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { hello: true } }));
      } else if (frame.method === "chat.send") {
        expect(frame.params.idempotencyKey).toBe("task-1");
        expect(frame.params.metadata.anyClawTaskId).toBe("task-1");
        sock.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { runId: "run-xyz" } }));
      }
    });
  });
});
afterEach(() => wss.close());

it("dispatch handshakes, sends chat.send with idempotencyKey, returns runId", async () => {
  const a = new OpenClawAdapter({ gatewayUrl: url, token: "t", workspace: "ws" });
  const h = await a.dispatch("task-1", "add mood tracker", ctxStub(), AbortSignal.timeout(5000));
  expect(h.adapterRef).toBe("run-xyz");
  await a.dispose();
});

it("subscribe yields clarifying when session.tool event references anyclaw_ask_user", async () => {
  wss.on("connection", (sock) => {
    // after handshake + chat.send already handled above, push a tool event
    setTimeout(() => {
      sock.send(JSON.stringify({ type: "event", event: "session.tool",
        payload: { type: "tool_call", tool: "anyclaw_ask_user", args: { question: "Which DB?" } } }));
      sock.send(JSON.stringify({ type: "event", event: "session.message",
        payload: { type: "run_complete", status: "success", summary: "Added" } }));
    }, 50);
  });
  // ...dispatch, then iterate subscribe until terminal, assert states observed
});
```
Confirm fail.

**Green:** Implement `src/adapters/openclaw.ts` per design §7.2. Use real `ws` client. Handshake waits for `connect.challenge` event then RPC `connect`. `dispatch` calls `chat.send` with `idempotencyKey: taskId`. `subscribe` wires events through `AsyncQueue`, maps them via `mapEventToStatus`, closes on terminal. `cancel` sends `sessions.abort`. Confirm both tests pass.

**Commit:** `plan3(task7): OpenClaw adapter with mock gateway tests`

---

## Task 8: `ClaudeCodeAdapter` against a mock `claude` binary

**Red:** `test/unit/claude-code-adapter.test.ts`. Create a mock binary in `test/fixtures/mock-claude.mjs` that reads argv, emits `stream-json` lines, then exits:
```js
#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "system", session_id: "sess-42" }) + "\n");
process.stdout.write(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "anyclaw_ask_user", input: { question: "DB?" } }] }
}) + "\n");
process.stdout.write(JSON.stringify({ type: "result", result: "done description" }) + "\n");
process.exit(0);
```
Test:
```ts
it("dispatch writes mcp-config file and spawns claude with --mcp-config", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "cc-"));
  const a = new ClaudeCodeAdapter({
    executablePath: process.execPath,      // run node
    maxBudgetUsd: 1,
    applyResourceLimits: async () => {},
    getApiKey: async () => "fake",
  });
  // Wrap the args so node runs mock-claude.mjs: we do this by pointing
  // executablePath at node and prefixing args in a subclass hook under test.
  const ctx: SystemContext = {
    cwd: tmp,
    mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
    mcpBearerToken: "tok",
    mcpConfigPath: join(tmp, "mcp.json"),
    systemPrompt: "",
    allowedTools: ["Read","Write","Bash"],
  };
  const h = await a.dispatch("t1", "build it", ctx, AbortSignal.timeout(10_000));
  const cfg = JSON.parse(await readFile(ctx.mcpConfigPath, "utf8"));
  expect(cfg.mcpServers.anyclaw.url).toBe(ctx.mcpEndpointUrl);
  expect(cfg.mcpServers.anyclaw.headers["x-anyclaw-task-id"]).toBe("t1");
  expect(h.taskId).toBe("t1");
});

it("subscribe yields clarifying then done from stream-json", async () => {
  // spawn with mock-claude.mjs that emits the scripted events
  // iterate subscribe, collect states, assert ["working","clarifying","done"]
});

it("persists sessionId from the system event", async () => {
  // after dispatch + iteration, a persistSessionId stub is called with "sess-42"
});
```
Confirm fail.

**Green:** Implement `src/adapters/claude-code.ts` per design §8.2. Key points:
- `dispatch` writes `mcpConfigPath` before spawn.
- Spawn uses `child_process.spawn(executablePath, args, { cwd, env, signal })`.
- `consumeOutput` reads stdout line-by-line via `readline.createInterface`, JSON-parses each line, feeds `updateStatusFromEvent`, persists `session_id` on first `system` event.
- Expose `persistSessionId` and `persistTaskStatus` as injectable dependencies (constructor options) so tests can spy.
- `subscribe` uses an `AsyncQueue` driven by a 500ms watcher (matches design); on abort, cleans up.
- `cancel` = SIGTERM then SIGKILL after 5s.
- To let tests run `node mock-claude.mjs`, accept `executableArgs?: string[]` in constructor that are prepended to the arg list. Production leaves this undefined.

Confirm all three tests pass.

**Commit:** `plan3(task8): Claude Code adapter with stream-json parsing`

---

## Task 9: `WebhookAdapter` against a mock HTTP server

**Red:** `test/unit/webhook-adapter.test.ts`. Use Node's `http.createServer` on ephemeral port:
```ts
it("dispatch POSTs taskId/callback/mcp URL and returns adapterRef from response", async () => {
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      const b = JSON.parse(body);
      expect(b.taskId).toBe("t1");
      expect(b.callbackUrl).toBe("http://cb/api/webhook/callback");
      expect(b.mcpBearerToken).toBe("mtoken");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ externalId: "ext-9" }));
    });
  });
  await new Promise<void>(r => server.listen(0, r));
  const port = (server.address() as any).port;
  const a = new WebhookAdapter({
    dispatchUrl: `http://127.0.0.1:${port}/dispatch`,
    callbackBaseUrl: "http://cb",
  });
  const h = await a.dispatch("t1", "req", ctxStub({ mcpBearerToken: "mtoken" }), AbortSignal.timeout(2000));
  expect(h.adapterRef).toBe("ext-9");
  server.close();
});

it("dispatch on 401 throws AdapterError AUTH_FAILED non-retryable", async () => { /* 401 server */ });
it("dispatch on 502 throws AdapterError INTERNAL retryable", async () => { /* 502 server */ });
```
Confirm fail.

**Green:** Implement `src/adapters/webhook.ts` per design §9. `subscribe` is left as a thin adapter over a PocketBase realtime stub helper (`subscribeToPocketBaseTaskStatus`) which we implement as a `TasksRepo.streamStatus(taskId, signal)` method — add this method now, driven by the existing tests' needs. Confirm tests pass.

**Commit:** `plan3(task9): Webhook adapter with HTTP mock tests`

---

## Task 10: `AdapterManager` — queue, dispatch wiring, cancel

**Red:** `test/unit/adapter-manager.test.ts` using a **mock adapter**:
```ts
class MockAdapter implements AgentAdapter {
  readonly name = "Mock";
  script: TaskStatus[] = [];
  dispatched: string[] = [];
  async healthCheck() { return { ok: true }; }
  async dispatch(taskId: string) { this.dispatched.push(taskId); return { taskId, adapterRef: "a" }; }
  async *subscribe() { for (const s of this.script) yield s; }
  async answerQuestion() {}
  async cancel() {}
  async dispose() {}
}

it("processQueue dispatches one queued task, transitions to working then done", async () => {
  const adapter = new MockAdapter();
  adapter.script = [
    { state: "working", seq: 1, updatedAt: now() },
    { state: "done", versionDescription: "v1", seq: 2, updatedAt: now() },
  ];
  const mgr = new AdapterManager({ adapter, repo, worktrees, resourceLimits: new NoopResourceLimits() });
  await repo.createIfAbsent({ taskId: "t1", ... });
  await repo.enqueue("t1");
  await mgr.processQueue();
  expect(adapter.dispatched).toEqual(["t1"]);
  expect((await repo.getByTaskId("t1")).state).toBe("done");
});

it("cancel on working task calls adapter.cancel and transitions to cancelled", async () => { ... });

it("only one task runs at a time", async () => {
  // enqueue two tasks, make the first adapter.subscribe block on a manual release
  // assert the second is still 'queued' while the first is 'working'
});
```
Confirm fail.

**Green:** Implement `src/adapters/manager.ts`:
- Constructor takes `{ adapter, repo, worktrees, resourceLimits, config: DispatchConfig }`.
- `processQueue()` is a re-entrant, single-flight function: if a task is currently running, return; otherwise pop the next queued task, create worktree if not already present (idempotent), call `adapter.dispatch`, then drive `subscribe` into `repo.applyTransition` calls.
- `cancel(taskId)` creates an `AbortController` stored per task; calls `adapter.cancel`; applies `cancel` transition.
- `buildSystemContext(taskId)` constructs `SystemContext` with loopback MCP URL, a fresh per-task bearer token, and an `mcpConfigPath` under a temp dir.
- On terminal `done`, call `worktrees.mergeAndRemove`. On terminal `failed`/`cancelled`, call `worktrees.discard`.
- Wire `maxTaskDurationMs` timeout via `AbortSignal.timeout` combined with the per-task controller.

Confirm all three tests pass.

**Commit:** `plan3(task10): AdapterManager single-flight queue with cancel`

---

## Task 11: Startup sweep + resume for `clarifying` tasks

**Red:** `test/unit/adapter-manager-resume.test.ts`:
```ts
it("onStartup moves working/deploying to failed and discards their worktrees", async () => {
  await seedTask(fakePb, "old-working", "working", { worktreePath: "/tmp/x1" });
  const mgr = makeManager();
  await mgr.onStartup();
  expect((await repo.getByTaskId("old-working")).state).toBe("failed");
  expect(worktrees.discarded).toContain("old-working");
});

it("onStartup resumes clarifying tasks whose answer landed during downtime", async () => {
  await seedTask(fakePb, "c1", "clarifying", { sessionId: "sess-1" });
  await seedClarification(fakePb, "c1", { status: "answered", answer: "sqlite" });
  const adapter = new MockAdapter();  // implements resumeTask
  const mgr = makeManager(adapter);
  await mgr.onStartup();
  expect(adapter.resumed).toContain("c1");
});

it("onStartup leaves clarifying tasks with pending clarifications alone", async () => {
  await seedTask(fakePb, "c2", "clarifying");
  await seedClarification(fakePb, "c2", { status: "pending" });
  const adapter = new MockAdapter();
  await makeManager(adapter).onStartup();
  expect(adapter.resumed).not.toContain("c2");
  expect((await repo.getByTaskId("c2")).state).toBe("clarifying");
});
```
Confirm fail.

**Green:** Implement `AdapterManager.onStartup()` per design §11.3: run `repo.sweepOnStartup()`, `worktrees.discard` each swept task, list `clarifying` tasks, for each check `task_clarifications` by taskId — if none pending, call `adapter.resumeTask` (if supported) else `markFailed("Adapter does not support resume")`. Confirm tests pass.

**Commit:** `plan3(task11): startup sweep and clarifying-task resume`

---

## Task 12: Clarification relay + timeout modes

**Red:** `test/unit/clarification-relay.test.ts`:
```ts
it("best_judgment mode resolves with fallback after timeout", async () => {
  const fake = new FakePb();
  const p = waitForAnswer(fake, "cl-1", 50, "best_judgment");
  await expect(p).resolves.toMatch(/best judgment/);
});
it("pause_indefinitely never times out until an answer lands", async () => {
  const fake = new FakePb();
  const p = waitForAnswer(fake, "cl-2", 1, "pause_indefinitely");
  // wait well past any timeout, then write answer
  await sleep(100);
  fake.emit("task_clarifications", { action: "update", record: { id: "cl-2", status: "answered", answer: "yes" } });
  expect(await p).toBe("yes");
});
it("answer arriving before timeout resolves with the answer", async () => { ... });
```
Confirm fail.

**Green:** Add `src/lifecycle/clarification.ts` exporting `waitForAnswer(pb, clarificationId, timeoutMs, mode)` per design §10.1. PocketBase is passed in so tests use a fake that implements `collection(name).subscribe(id, cb)` and an `emit` helper. Confirm pass.

**Commit:** `plan3(task12): clarification relay with configurable timeout`

---

## Task 13: REST API — tasks submit/answer/cancel + exactly-once

**Red:** `test/integration/rest-tasks.test.ts` using `supertest` against an Express app built by `buildApp({ pb, manager })`:
```ts
it("POST /api/tasks with new UUID returns queued status", async () => {
  const r = await request(app).post("/api/tasks").set("authorization","Bearer t").send({ taskId: uuid(), request: "build it" });
  expect(r.status).toBe(200);
  expect(r.body.state).toBe("queued");
});
it("POST /api/tasks with existing UUID is idempotent", async () => {
  const id = uuid();
  const a = await request(app).post("/api/tasks").set("authorization","Bearer t").send({ taskId: id, request: "build it" });
  const b = await request(app).post("/api/tasks").set("authorization","Bearer t").send({ taskId: id, request: "build it" });
  expect(a.body.seq).toBe(b.body.seq);
  expect(countTasks()).toBe(1);
});
it("POST /api/tasks rejects malformed taskId", async () => {
  const r = await request(app).post("/api/tasks").set("authorization","Bearer t").send({ taskId: "not-a-uuid", request: "x" });
  expect(r.status).toBe(400);
});
it("POST /api/tasks/:id/answer writes answer and returns 204", async () => { ... });
it("POST /api/tasks/:id/cancel calls manager.cancel and returns current status", async () => { ... });
it("missing auth returns 401", async () => { ... });
```
Confirm fail.

**Green:** Implement:
- `src/rest/router.ts` assembling sub-routers with an `authRequired` middleware that checks `Authorization: Bearer` against PocketBase auth (injectable for tests).
- `src/rest/tasks.ts` with `POST /api/tasks` implementing idempotent upsert per design §12.1 (including `buildSystemContext` + worktree create inline when inserting new), `POST /api/tasks/:taskId/answer` (writes `task_clarifications` row via repo), `POST /api/tasks/:taskId/cancel` (calls `manager.cancel`), `GET /api/tasks/:taskId`, `GET /api/tasks/:taskId/activity`, `GET /api/tasks`.
- zod schema for request body validation. UUID regex validation.

Confirm all six tests pass.

**Commit:** `plan3(task13): REST /api/tasks endpoints with idempotent upsert`

---

## Task 14: REST API — emergency, adapter config, webhook callback, versions, health

**Red:** `test/integration/rest-ops.test.ts`:
```ts
it("POST /api/rollback calls versionStore.rollback and deployManager.promote", async () => { ... });
it("POST /api/restart-app invokes the injected restartFn", async () => { ... });
it("GET /api/versions returns the version list from versionStore", async () => { ... });
it("GET /api/health returns { ok: true, adapter: { ok: true } }", async () => { ... });
it("PUT /api/adapter/config reinstantiates the adapter via manager.reloadConfig", async () => { ... });
it("POST /api/webhook/callback maps event payload to TaskStatus via repo.applyTransition", async () => { ... });
```
Confirm fail.

**Green:** Implement `src/rest/emergency.ts` (`/api/rollback`, `/api/restart-app`, `/api/versions`, `/api/health`), `src/rest/adapter.ts` (`GET/PUT /api/adapter/config`, `GET /api/adapter/health`), and `src/rest/webhook-callback.ts`. `rollback` and `restart-app` take injected `versionStore`, `deployManager`, and `restartFn` so they're testable without real systemd. The webhook callback validates `taskId` and maps the `event` field:
- `"progress"` → `applyTransition(id, "progress", { progressSummary })` (no state change; store progressSummary and bump seq).
- `"clarifying"` → `ask_user` transition + write clarification row.
- `"deploying"` → `deploy_called`.
- `"done"` → `validation_pass` with `versionDescription`.
- `"failed"` → `validation_fail` with `error`.

Confirm all tests pass.

**Commit:** `plan3(task14): emergency, adapter config, webhook callback endpoints`

---

## Task 15: End-to-end lifecycle integration test

**Red:** `test/integration/task-lifecycle.test.ts`:
```ts
it("queued -> working -> clarifying -> working -> deploying -> done walks the full state machine", async () => {
  // Uses MockAdapter that drives the lifecycle via a controllable script.
  // Real WorktreeManager over a temp git repo.
  // Real TasksRepo over the fake PB.
  // Asserts:
  //  - worktree is created after dispatch
  //  - clarifying state surfaces the question from the mock tool_call
  //  - POST /api/tasks/:id/answer unblocks the adapter (mock reads back from repo)
  //  - on done, worktree branch is merged into main
  //  - on done, worktree directory is removed
});

it("failure path discards worktree and leaves main untouched", async () => { ... });

it("cancel mid-working kills adapter, applies cancelled state, discards worktree", async () => { ... });
```
Confirm fail.

**Green:** Wire the pieces together in `src/index.ts`'s `buildApp` factory (adapter, manager, repo, worktrees, router) so the integration test can construct the whole thing with one call. Confirm all three tests pass.

**Commit:** `plan3(task15): end-to-end lifecycle integration tests`

---

## Task 16: Process entry point `src/index.ts`

**Red:** `test/integration/boot.test.ts`:
```ts
it("buildServer returns an http.Server that responds to GET /api/health", async () => {
  const server = await buildServer({ config: testConfig });
  const addr = await new Promise<AddressInfo>(r => server.listen(0, () => r(server.address() as any)));
  const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  server.close();
});

it("buildServer runs AdapterManager.onStartup (sweep) before accepting traffic", async () => {
  await seedTask(testPb, "stranded", "working");
  await buildServer({ config: testConfig, pb: testPb });
  expect((await testPb.collection("tasks").getFirstListItem('taskId = "stranded"')).state).toBe("failed");
});
```
Confirm fail.

**Green:** Implement `src/index.ts`:
- Export `buildApp(deps)` — returns Express app.
- Export `buildServer(options)` — wires PocketBase client, `TasksRepo`, `WorktreeManager`, `NoopResourceLimits`, `AdapterManager`, instantiates the configured adapter, awaits `manager.onStartup()`, mounts REST router, **also mounts the MCP router from Plan 2 on the same app**, returns `http.createServer(app)`.
- Export `main()` — the production entry point that calls `buildServer` with env/config and listens on a loopback port.

Confirm both tests pass.

**Commit:** `plan3(task16): dispatch-server process entry and boot sweep`

---

## Done criteria

- All 16 tasks committed, each with its test(s) passing.
- `pnpm --filter @anyclaw/dispatch-server test` runs green end-to-end.
- The dispatch server boots, runs the startup sweep, exposes `/api/health`, and can be driven by a mock adapter through the full `queued → working → clarifying → working → deploying → done` cycle.
- Worktree isolation verified: a failed task never modifies `main` in the integration test's temp repo.
- Exactly-once verified: duplicate `POST /api/tasks` with the same UUID never creates a second row.
- The MCP endpoint from Plan 2 is mounted in the same process so the per-task bearer token and loopback URL handed to adapters are actually reachable by a spawned agent.
