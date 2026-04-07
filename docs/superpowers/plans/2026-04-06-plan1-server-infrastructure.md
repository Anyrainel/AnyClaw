# Plan 1: Server Infrastructure Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the AnyClaw server monorepo as the comprehensive foundation for every other plan. Plan 1 delivers: the shared library (`@anyclaw/shared` — NaCl crypto, snapshot manager, git-based version store, worktree manager, deploy manager, rollback manager), the dispatch scaffold (`@anyclaw/dispatch` — the single Express app on port 4100 that Plan 2 mounts MCP routes onto and Plan 3 mounts REST routes + adapters onto), the tunnel manager package (`@anyclaw/tunnel-manager` — routing table + reconnection stub for Plan 4), the logic runner (`@anyclaw/logic-runner` — supervises the agent-built logic service), the prod-static server (`@anyclaw/prod-static` — serves built frontend), the frontend template (`@anyclaw/frontend-template` — seed project copied into `/data/dev/` on first run), the `/data` filesystem layout scripts, the pinned PocketBase 0.25 binary, the full 5-process `supervisord` config, and the Dockerfile bundling all of it.

**Architecture:** TypeScript monorepo under `anyclaw-server/` using npm workspaces. All shared code lives in `packages/shared/` (imported as `@anyclaw/shared`) and is consumed by every other package. `packages/dispatch/` is a single Express app listening on port 4100 — Plan 1 creates the scaffold (app factory + `/health`), Plan 2 mounts MCP routes, Plan 3 mounts REST routes and agent adapters. `packages/tunnel-manager/`, `packages/logic-runner/`, `packages/prod-static/` are independently supervised Node services. `packages/frontend-template/` is a Vite + React + TS + Tailwind v4 source tree that is copied into `/data/dev/` by `init-data-layout.sh` on first run. All persistent state is rooted at `/data` (PocketBase, dev, prod, snapshots, `.anyclaw`). Process supervision runs via `supervisord` inside a single Docker container with 5 supervised programs: `pocketbase`, `dispatch`, `tunnel-manager`, `logic-runner`, `prod-static`.

**Tech Stack:** Node.js 20, TypeScript 5.4, npm workspaces, vitest, libsodium-wrappers, better-sqlite3 (schema-inspection only for snapshot tests), simple-git, express (dispatch scaffold + prod-static), ws (tunnel-manager), chokidar (logic-runner file watch), Vite 5 + React 18 + Tailwind v4 + lucide-react + pocketbase JS SDK 0.25 (frontend-template), supervisord, PocketBase 0.25 binary.

**Dependencies:** None — this is the foundation.

**Plans that depend on this:** Plan 2 (MCP), Plan 3 (Dispatch/REST), Plan 4 (Tunnel), Plan 6 (Skills + Install).

---

## File Structure

```
anyclaw-server/
  package.json                       # root workspace
  tsconfig.base.json                 # shared compiler options
  .gitignore
  vitest.config.ts
  packages/
    shared/
      package.json
      tsconfig.json
      src/
        index.ts                     # barrel
        paths.ts                     # AnyClawPaths resolver
        crypto.ts                    # NaCl box wrapper
        snapshots.ts                 # gzip SQLite snapshot mgr
        versionStore.ts              # git commit / tag / list / checkout
        worktrees.ts                 # git worktree create/delete/list
        deployManager.ts             # validate → snapshot → merge → restart
        rollbackManager.ts           # symmetric to deployManager
      test/
        crypto.test.ts
        snapshots.test.ts
        versionStore.test.ts
        worktrees.test.ts
        deployManager.test.ts
        rollbackManager.test.ts
        paths.test.ts
    dispatch/
      package.json
      tsconfig.json
      src/
        index.ts                     # createApp() scaffold + /health (Plan 2/3 extend)
      test/
        health.test.ts
    tunnel-manager/
      package.json
      tsconfig.json
      src/
        index.ts
        config.ts                    # loads /data/.anyclaw/server-token + device-keys.json
        router.ts                    # in-envelope service -> local port map
        reconnect.ts                 # exp-backoff loop (logging stub in Plan 1)
      test/
        router.test.ts
        config.test.ts
    logic-runner/
      package.json
      tsconfig.json
      src/
        index.ts                     # spawn + watch /data/prod/logic-build
        fallback.ts                  # 503 no_logic_deployed server
      test/
        fallback.test.ts
        runner.test.ts
    prod-static/
      package.json
      tsconfig.json
      src/
        index.ts                     # express static server on :5173
        placeholder.ts               # fallback HTML
      test/
        server.test.ts
    frontend-template/
      package.json
      tsconfig.json
      vite.config.ts
      index.html
      src/
        main.tsx
        App.tsx
        app.css
        lib/
          usePreferences.ts
      test/
        usePreferences.test.ts
        build.test.ts
  infra/
    supervisord.conf
    Dockerfile
    scripts/
      download-pocketbase.sh
      init-data-layout.sh
```

---

### Task 1: Initialize monorepo root

**Files:**
- Create: `anyclaw-server/package.json`
- Create: `anyclaw-server/tsconfig.base.json`
- Create: `anyclaw-server/.gitignore`
- Create: `anyclaw-server/vitest.config.ts`
- Create: `anyclaw-server/README.md`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "anyclaw-server",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b packages/shared packages/dispatch packages/tunnel-manager packages/logic-runner packages/prod-static packages/frontend-template",
    "lint": "echo \"(lint wired in later plans)\""
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.tsbuildinfo
.env
.env.*
coverage/
tmp-test-*/
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
```

- [ ] **Step 5: Create minimal `README.md`**

```md
# anyclaw-server

Server-side monorepo for AnyClaw. See docs/superpowers/specs/2026-04-04-anyclaw-design.md.

Packages:
- `shared` — crypto, snapshots, version store, worktrees, deploy manager, rollback manager
- `dispatch` — single Express app on :4100 (scaffold in Plan 1, MCP routes in Plan 2, REST + adapters in Plan 3)
- `tunnel-manager` — persistent WSS connection to broker (routing logic in Plan 1, real WSS in Plan 4)
- `logic-runner` — supervises agent-built logic service from `/data/prod/logic-build/` on :3000
- `prod-static` — serves `/data/prod/frontend-build/` on :5173 with SPA fallback
- `frontend-template` — Vite + React + Tailwind v4 seed copied into `/data/dev/` on first run
```

- [ ] **Step 6: Install and verify**

Run: `cd anyclaw-server && npm install`
Expected: creates `node_modules/`, no errors.

Run: `cd anyclaw-server && npx tsc --version`
Expected: `Version 5.4.x`

- [ ] **Step 7: Commit**

```bash
git add anyclaw-server/package.json anyclaw-server/tsconfig.base.json \
        anyclaw-server/.gitignore anyclaw-server/vitest.config.ts \
        anyclaw-server/README.md
git commit -m "feat(plan1): init anyclaw-server monorepo root"
```

---

### Task 2: Create `shared` package skeleton and `paths.ts` (TDD)

**Files:**
- Create: `anyclaw-server/packages/shared/package.json`
- Create: `anyclaw-server/packages/shared/tsconfig.json`
- Create: `anyclaw-server/packages/shared/src/index.ts`
- Create: `anyclaw-server/packages/shared/src/paths.ts`
- Create: `anyclaw-server/packages/shared/test/paths.test.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@anyclaw/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -b"
  },
  "dependencies": {
    "libsodium-wrappers": "^0.7.13",
    "simple-git": "^3.24.0"
  },
  "devDependencies": {
    "@types/libsodium-wrappers": "^0.7.14"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create placeholder `src/index.ts`**

```ts
export * from "./paths.js";
```

- [ ] **Step 4: Install deps**

Run: `cd anyclaw-server && npm install`
Expected: installs libsodium-wrappers, simple-git.

- [ ] **Step 5: Write failing test `test/paths.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { AnyClawPaths } from "../src/paths.js";

describe("AnyClawPaths", () => {
  it("derives all known paths from a data root", () => {
    const p = new AnyClawPaths("/tmp/anyclaw-data");
    expect(p.dataRoot).toBe("/tmp/anyclaw-data");
    expect(p.pocketbase).toBe("/tmp/anyclaw-data/pocketbase");
    expect(p.pocketbaseData).toBe("/tmp/anyclaw-data/pocketbase/pb_data");
    expect(p.dev).toBe("/tmp/anyclaw-data/dev");
    expect(p.devWorktrees).toBe("/tmp/anyclaw-data/dev/.worktrees");
    expect(p.prod).toBe("/tmp/anyclaw-data/prod");
    expect(p.prodFrontend).toBe("/tmp/anyclaw-data/prod/frontend-build");
    expect(p.prodLogic).toBe("/tmp/anyclaw-data/prod/logic-build");
    expect(p.snapshots).toBe("/tmp/anyclaw-data/snapshots");
    expect(p.secrets).toBe("/tmp/anyclaw-data/.anyclaw");
    expect(p.secretsLogs).toBe("/tmp/anyclaw-data/.anyclaw/logs");
  });

  it("provides worktree path for a task id", () => {
    const p = new AnyClawPaths("/data");
    expect(p.worktreeFor("task-abc")).toBe("/data/dev/.worktrees/task-abc");
  });

  it("provides snapshot path for an ISO timestamp", () => {
    const p = new AnyClawPaths("/data");
    expect(p.snapshotFile("2026-04-06T12-00-00Z")).toBe(
      "/data/snapshots/2026-04-06T12-00-00Z.sqlite.gz",
    );
  });
});
```

- [ ] **Step 6: Run test — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/paths.test.ts`
Expected: FAIL — module `../src/paths.js` not found.

- [ ] **Step 7: Implement `src/paths.ts`**

```ts
import path from "node:path";

export class AnyClawPaths {
  constructor(public readonly dataRoot: string) {}

  get pocketbase() { return path.posix.join(this.dataRoot, "pocketbase"); }
  get pocketbaseData() { return path.posix.join(this.pocketbase, "pb_data"); }
  get dev() { return path.posix.join(this.dataRoot, "dev"); }
  get devWorktrees() { return path.posix.join(this.dev, ".worktrees"); }
  get prod() { return path.posix.join(this.dataRoot, "prod"); }
  get prodFrontend() { return path.posix.join(this.prod, "frontend-build"); }
  get prodLogic() { return path.posix.join(this.prod, "logic-build"); }
  get snapshots() { return path.posix.join(this.dataRoot, "snapshots"); }
  get secrets() { return path.posix.join(this.dataRoot, ".anyclaw"); }
  get secretsLogs() { return path.posix.join(this.secrets, "logs"); }

  worktreeFor(taskId: string): string {
    return path.posix.join(this.devWorktrees, taskId);
  }

  snapshotFile(isoStamp: string): string {
    return path.posix.join(this.snapshots, `${isoStamp}.sqlite.gz`);
  }
}
```

- [ ] **Step 8: Run test — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/paths.test.ts`
Expected: 3 passed.

- [ ] **Step 9: Commit**

```bash
git add anyclaw-server/packages/shared anyclaw-server/package-lock.json
git commit -m "feat(shared): add AnyClawPaths resolver"
```

---

### Task 3: NaCl crypto module (TDD)

**Files:**
- Create: `anyclaw-server/packages/shared/src/crypto.ts`
- Create: `anyclaw-server/packages/shared/test/crypto.test.ts`
- Modify: `anyclaw-server/packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test `test/crypto.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import {
  initCrypto,
  generateKeyPair,
  encrypt,
  decrypt,
  type KeyPair,
} from "../src/crypto.js";

describe("crypto (NaCl box)", () => {
  beforeAll(async () => { await initCrypto(); });

  it("generates a 32-byte public/secret keypair", () => {
    const kp = generateKeyPair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.secretKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.secretKey.length).toBe(32);
  });

  it("encrypts then decrypts a round trip between two keypairs", () => {
    const alice: KeyPair = generateKeyPair();
    const bob: KeyPair = generateKeyPair();
    const msg = new TextEncoder().encode("hello anyclaw");

    const box = encrypt(msg, bob.publicKey, alice.secretKey);
    expect(box.ciphertext).toBeInstanceOf(Uint8Array);
    expect(box.nonce.length).toBe(24);
    expect(box.ciphertext).not.toEqual(msg);

    const plain = decrypt(box, alice.publicKey, bob.secretKey);
    expect(new TextDecoder().decode(plain)).toBe("hello anyclaw");
  });

  it("throws on tampered ciphertext", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const box = encrypt(new TextEncoder().encode("secret"), b.publicKey, a.secretKey);
    box.ciphertext[0] = box.ciphertext[0]! ^ 0xff;
    expect(() => decrypt(box, a.publicKey, b.secretKey)).toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/crypto.test.ts`
Expected: FAIL — cannot find module `../src/crypto.js`.

- [ ] **Step 3: Implement `src/crypto.ts`**

```ts
import sodium from "libsodium-wrappers";

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface SealedBox {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

let ready = false;

export async function initCrypto(): Promise<void> {
  if (ready) return;
  await sodium.ready;
  ready = true;
}

function ensureReady(): void {
  if (!ready) {
    throw new Error("crypto: call initCrypto() before use");
  }
}

export function generateKeyPair(): KeyPair {
  ensureReady();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

export function encrypt(
  message: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array,
): SealedBox {
  ensureReady();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    message,
    nonce,
    recipientPublicKey,
    senderSecretKey,
  );
  return { nonce, ciphertext };
}

export function decrypt(
  box: SealedBox,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): Uint8Array {
  ensureReady();
  return sodium.crypto_box_open_easy(
    box.ciphertext,
    box.nonce,
    senderPublicKey,
    recipientSecretKey,
  );
}
```

- [ ] **Step 4: Update `src/index.ts`**

```ts
export * from "./paths.js";
export * from "./crypto.js";
```

- [ ] **Step 5: Run test — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/crypto.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add anyclaw-server/packages/shared/src/crypto.ts \
        anyclaw-server/packages/shared/test/crypto.test.ts \
        anyclaw-server/packages/shared/src/index.ts
git commit -m "feat(shared): add NaCl box encrypt/decrypt wrapper"
```

---

### Task 4: Snapshot manager (TDD)

**Files:**
- Create: `anyclaw-server/packages/shared/src/snapshots.ts`
- Create: `anyclaw-server/packages/shared/test/snapshots.test.ts`
- Modify: `anyclaw-server/packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test `test/snapshots.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { SnapshotManager } from "../src/snapshots.js";

describe("SnapshotManager", () => {
  let root: string;
  let dbPath: string;
  let snapshotsDir: string;
  let mgr: SnapshotManager;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-snap-"));
    dbPath = join(root, "data.sqlite");
    snapshotsDir = join(root, "snapshots");
    writeFileSync(dbPath, Buffer.from("SQLITE-FAKE-DB-CONTENT"));
    mgr = new SnapshotManager({ sqlitePath: dbPath, snapshotsDir, keep: 3 });
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("creates a gzip snapshot file and returns its path", async () => {
    const file = await mgr.create("2026-04-06T12-00-00Z");
    expect(existsSync(file)).toBe(true);
    expect(file.endsWith(".sqlite.gz")).toBe(true);
    const plain = gunzipSync(readFileSync(file));
    expect(plain.toString()).toBe("SQLITE-FAKE-DB-CONTENT");
  });

  it("lists snapshots newest-first", async () => {
    await mgr.create("2026-04-06T10-00-00Z");
    await mgr.create("2026-04-06T11-00-00Z");
    await mgr.create("2026-04-06T12-00-00Z");
    const list = await mgr.list();
    expect(list.map(s => s.id)).toEqual([
      "2026-04-06T12-00-00Z",
      "2026-04-06T11-00-00Z",
      "2026-04-06T10-00-00Z",
    ]);
  });

  it("prunes to N most recent", async () => {
    await mgr.create("2026-04-06T09-00-00Z");
    await mgr.create("2026-04-06T10-00-00Z");
    await mgr.create("2026-04-06T11-00-00Z");
    await mgr.create("2026-04-06T12-00-00Z");
    await mgr.prune();
    const list = await mgr.list();
    expect(list.length).toBe(3);
    expect(list[0]!.id).toBe("2026-04-06T12-00-00Z");
    expect(list.find(s => s.id === "2026-04-06T09-00-00Z")).toBeUndefined();
  });

  it("restores a snapshot into the live DB path", async () => {
    const file = await mgr.create("2026-04-06T12-00-00Z");
    writeFileSync(dbPath, Buffer.from("CORRUPTED"));
    await mgr.restore(file);
    expect(readFileSync(dbPath).toString()).toBe("SQLITE-FAKE-DB-CONTENT");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/snapshots.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/snapshots.ts`**

```ts
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { createGunzip, createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import path from "node:path";

export interface SnapshotEntry {
  id: string;
  file: string;
  size: number;
  createdAt: Date;
}

export interface SnapshotManagerOptions {
  sqlitePath: string;
  snapshotsDir: string;
  keep: number;
}

export class SnapshotManager {
  constructor(private readonly opts: SnapshotManagerOptions) {}

  async create(id: string): Promise<string> {
    await fs.mkdir(this.opts.snapshotsDir, { recursive: true });
    const out = path.join(this.opts.snapshotsDir, `${id}.sqlite.gz`);
    await pipeline(
      createReadStream(this.opts.sqlitePath),
      createGzip(),
      createWriteStream(out),
    );
    return out;
  }

  async list(): Promise<SnapshotEntry[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.opts.snapshotsDir);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const snaps: SnapshotEntry[] = [];
    for (const name of entries) {
      if (!name.endsWith(".sqlite.gz")) continue;
      const full = path.join(this.opts.snapshotsDir, name);
      const stat = await fs.stat(full);
      snaps.push({
        id: name.replace(/\.sqlite\.gz$/, ""),
        file: full,
        size: stat.size,
        createdAt: stat.mtime,
      });
    }
    snaps.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return snaps;
  }

  async prune(): Promise<void> {
    const snaps = await this.list();
    const toDelete = snaps.slice(this.opts.keep);
    await Promise.all(toDelete.map(s => fs.unlink(s.file)));
  }

  async restore(snapshotFile: string): Promise<void> {
    const tmp = `${this.opts.sqlitePath}.restore-tmp`;
    await pipeline(
      createReadStream(snapshotFile),
      createGunzip(),
      createWriteStream(tmp),
    );
    await fs.rename(tmp, this.opts.sqlitePath);
  }
}
```

- [ ] **Step 4: Update `src/index.ts`**

```ts
export * from "./paths.js";
export * from "./crypto.js";
export * from "./snapshots.js";
```

- [ ] **Step 5: Run test — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/snapshots.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add anyclaw-server/packages/shared/src/snapshots.ts \
        anyclaw-server/packages/shared/test/snapshots.test.ts \
        anyclaw-server/packages/shared/src/index.ts
git commit -m "feat(shared): add gzip SQLite SnapshotManager"
```

---

### Task 5: Git-based version store (TDD)

**Files:**
- Create: `anyclaw-server/packages/shared/src/versionStore.ts`
- Create: `anyclaw-server/packages/shared/test/versionStore.test.ts`
- Modify: `anyclaw-server/packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test `test/versionStore.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { VersionStore } from "../src/versionStore.js";

async function initRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "test@anyclaw.local");
  await git.addConfig("user.name", "Test");
  await git.addConfig("commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "init\n");
  await git.add(".");
  await git.commit("initial");
  // Ensure the default branch is `main` for consistency
  await git.raw(["branch", "-M", "main"]);
}

describe("VersionStore", () => {
  let root: string;
  let store: VersionStore;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-vs-"));
    await initRepo(root);
    store = new VersionStore(root);
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("commits a change and tags it as a version", async () => {
    writeFileSync(join(root, "feature.txt"), "hello\n");
    const v = await store.commitVersion({
      description: "Added a feature",
      files: ["feature.txt"],
    });
    expect(v.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(v.tag).toMatch(/^v\d+$/);
    expect(v.description).toBe("Added a feature");
  });

  it("lists versions newest-first", async () => {
    writeFileSync(join(root, "a.txt"), "a"); await store.commitVersion({ description: "A", files: ["a.txt"] });
    writeFileSync(join(root, "b.txt"), "b"); await store.commitVersion({ description: "B", files: ["b.txt"] });
    writeFileSync(join(root, "c.txt"), "c"); await store.commitVersion({ description: "C", files: ["c.txt"] });
    const list = await store.list();
    expect(list.map(v => v.description)).toEqual(["C", "B", "A"]);
    expect(list.map(v => v.tag)).toEqual(["v3", "v2", "v1"]);
  });

  it("checks out a prior version (restoring file contents)", async () => {
    writeFileSync(join(root, "x.txt"), "one");
    const v1 = await store.commitVersion({ description: "one", files: ["x.txt"] });
    writeFileSync(join(root, "x.txt"), "two");
    await store.commitVersion({ description: "two", files: ["x.txt"] });

    await store.checkoutVersion(v1.tag);
    expect(readFileSync(join(root, "x.txt"), "utf8")).toBe("one");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/versionStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/versionStore.ts`**

```ts
import { simpleGit, type SimpleGit } from "simple-git";

export interface Version {
  sha: string;
  tag: string;
  description: string;
  createdAt: Date;
}

export interface CommitVersionInput {
  description: string;
  files: string[];
}

export class VersionStore {
  private git: SimpleGit;

  constructor(public readonly repoDir: string) {
    this.git = simpleGit(repoDir);
  }

  async commitVersion(input: CommitVersionInput): Promise<Version> {
    await this.git.add(input.files);
    await this.git.commit(input.description);
    const log = await this.git.log({ maxCount: 1 });
    const head = log.latest!;
    const tag = await this.nextTag();
    await this.git.addAnnotatedTag(tag, input.description);
    return {
      sha: head.hash,
      tag,
      description: input.description,
      createdAt: new Date(head.date),
    };
  }

  async list(): Promise<Version[]> {
    const tagsRaw = await this.git.tags();
    const tags = tagsRaw.all.filter(t => /^v\d+$/.test(t));
    const versions: Version[] = [];
    for (const tag of tags) {
      const show = await this.git.raw([
        "log", "-1", "--format=%H%n%aI%n%B", tag,
      ]);
      const [sha, iso, ...rest] = show.split("\n");
      versions.push({
        sha: sha!,
        tag,
        description: rest.join("\n").trim(),
        createdAt: new Date(iso!),
      });
    }
    versions.sort((a, b) => {
      const an = parseInt(a.tag.slice(1), 10);
      const bn = parseInt(b.tag.slice(1), 10);
      return bn - an;
    });
    return versions;
  }

  async checkoutVersion(tag: string): Promise<void> {
    await this.git.raw(["checkout", tag, "--", "."]);
  }

  private async nextTag(): Promise<string> {
    const tagsRaw = await this.git.tags();
    const nums = tagsRaw.all
      .filter(t => /^v\d+$/.test(t))
      .map(t => parseInt(t.slice(1), 10));
    const next = (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
    return `v${next}`;
  }
}
```

- [ ] **Step 4: Update `src/index.ts`**

```ts
export * from "./paths.js";
export * from "./crypto.js";
export * from "./snapshots.js";
export * from "./versionStore.js";
```

- [ ] **Step 5: Run test — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/versionStore.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add anyclaw-server/packages/shared/src/versionStore.ts \
        anyclaw-server/packages/shared/test/versionStore.test.ts \
        anyclaw-server/packages/shared/src/index.ts
git commit -m "feat(shared): add git-based VersionStore"
```

---

### Task 6: Worktree manager (TDD)

**Files:**
- Create: `anyclaw-server/packages/shared/src/worktrees.ts`
- Create: `anyclaw-server/packages/shared/test/worktrees.test.ts`
- Modify: `anyclaw-server/packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test `test/worktrees.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { WorktreeManager } from "../src/worktrees.js";

async function initRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "t@a.local");
  await git.addConfig("user.name", "t");
  await git.addConfig("commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "x");
  await git.add(".");
  await git.commit("init");
  await git.raw(["branch", "-M", "main"]);
}

describe("WorktreeManager", () => {
  let repoDir: string;
  let worktreesDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    const root = mkdtempSync(join(tmpdir(), "anyclaw-wt-"));
    repoDir = join(root, "dev");
    worktreesDir = join(repoDir, ".worktrees");
    await initRepo(repoDir);
    mgr = new WorktreeManager({ repoDir, worktreesDir });
  });

  afterEach(() => { rmSync(join(worktreesDir, ".."), { recursive: true, force: true }); });

  it("creates a worktree for a task id on a new branch", async () => {
    const wt = await mgr.create("task-abc");
    expect(wt.path).toBe(join(worktreesDir, "task-abc"));
    expect(wt.branch).toBe("task/task-abc");
    expect(existsSync(wt.path)).toBe(true);
  });

  it("lists active worktrees (excluding main)", async () => {
    await mgr.create("task-one");
    await mgr.create("task-two");
    const list = await mgr.list();
    const ids = list.map(w => w.taskId).sort();
    expect(ids).toEqual(["task-one", "task-two"]);
  });

  it("deletes a worktree and its branch", async () => {
    const wt = await mgr.create("task-del");
    await mgr.delete("task-del");
    expect(existsSync(wt.path)).toBe(false);
    const list = await mgr.list();
    expect(list.find(w => w.taskId === "task-del")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/worktrees.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/worktrees.ts`**

```ts
import { simpleGit, type SimpleGit } from "simple-git";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface Worktree {
  taskId: string;
  path: string;
  branch: string;
}

export interface WorktreeManagerOptions {
  repoDir: string;
  worktreesDir: string;
}

export class WorktreeManager {
  private git: SimpleGit;

  constructor(private readonly opts: WorktreeManagerOptions) {
    this.git = simpleGit(opts.repoDir);
  }

  private branchFor(taskId: string): string {
    return `task/${taskId}`;
  }

  async create(taskId: string): Promise<Worktree> {
    await fs.mkdir(this.opts.worktreesDir, { recursive: true });
    const wtPath = path.join(this.opts.worktreesDir, taskId);
    const branch = this.branchFor(taskId);
    await this.git.raw(["worktree", "add", "-b", branch, wtPath, "main"]);
    return { taskId, path: wtPath, branch };
  }

  async list(): Promise<Worktree[]> {
    const raw = await this.git.raw(["worktree", "list", "--porcelain"]);
    const result: Worktree[] = [];
    let cur: Partial<Worktree> & { path?: string; branch?: string } = {};
    for (const line of raw.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (cur.path) this.pushIfTask(result, cur);
        cur = { path: line.slice("worktree ".length) };
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        cur.branch = ref.replace(/^refs\/heads\//, "");
      }
    }
    if (cur.path) this.pushIfTask(result, cur);
    return result;
  }

  private pushIfTask(
    out: Worktree[],
    cur: { path?: string; branch?: string },
  ): void {
    if (!cur.path || !cur.branch) return;
    if (!cur.branch.startsWith("task/")) return;
    const taskId = cur.branch.slice("task/".length);
    out.push({ taskId, path: cur.path, branch: cur.branch });
  }

  async delete(taskId: string): Promise<void> {
    const wtPath = path.join(this.opts.worktreesDir, taskId);
    const branch = this.branchFor(taskId);
    await this.git.raw(["worktree", "remove", "--force", wtPath]);
    try {
      await this.git.raw(["branch", "-D", branch]);
    } catch {
      // branch already gone is fine
    }
  }
}
```

- [ ] **Step 4: Update `src/index.ts`**

```ts
export * from "./paths.js";
export * from "./crypto.js";
export * from "./snapshots.js";
export * from "./versionStore.js";
export * from "./worktrees.js";
```

- [ ] **Step 5: Run test — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/worktrees.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add anyclaw-server/packages/shared/src/worktrees.ts \
        anyclaw-server/packages/shared/test/worktrees.test.ts \
        anyclaw-server/packages/shared/src/index.ts
git commit -m "feat(shared): add WorktreeManager"
```

---

### Task 7: DeployManager (TDD)

The DeployManager wires the pieces together: run a validator, snapshot DB (if schema changed), commit-and-tag via VersionStore, merge the task branch into main, delete the worktree, copy built artifacts into `prod/`, and restart the logic service via an injected restart callback. Every dependency is injected for testability — no real supervisord calls in this plan.

**Files:**
- Create: `anyclaw-server/packages/shared/src/deployManager.ts`
- Create: `anyclaw-server/packages/shared/test/deployManager.test.ts`
- Modify: `anyclaw-server/packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test `test/deployManager.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { DeployManager, type DeployResult } from "../src/deployManager.js";
import { VersionStore } from "../src/versionStore.js";
import { WorktreeManager } from "../src/worktrees.js";
import { SnapshotManager } from "../src/snapshots.js";

async function initRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig("user.email", "t@a.local");
  await g.addConfig("user.name", "t");
  await g.addConfig("commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "x");
  await g.add(".");
  await g.commit("init");
  await g.raw(["branch", "-M", "main"]);
}

describe("DeployManager", () => {
  let root: string;
  let repoDir: string;
  let prodDir: string;
  let snapDir: string;
  let dbPath: string;
  let vs: VersionStore;
  let wt: WorktreeManager;
  let sn: SnapshotManager;
  let restartCalls: number;
  let mgr: DeployManager;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-dep-"));
    repoDir = join(root, "dev");
    prodDir = join(root, "prod");
    snapDir = join(root, "snapshots");
    dbPath = join(root, "db.sqlite");
    mkdirSync(prodDir, { recursive: true });
    writeFileSync(dbPath, Buffer.from("DB"));
    await initRepo(repoDir);
    vs = new VersionStore(repoDir);
    wt = new WorktreeManager({ repoDir, worktreesDir: join(repoDir, ".worktrees") });
    sn = new SnapshotManager({ sqlitePath: dbPath, snapshotsDir: snapDir, keep: 10 });
    restartCalls = 0;
    mgr = new DeployManager({
      repoDir,
      prodDir,
      versions: vs,
      worktrees: wt,
      snapshots: sn,
      restartLogicService: async () => { restartCalls++; },
      now: () => new Date("2026-04-06T12:00:00Z"),
    });
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("runs a successful deploy end-to-end", async () => {
    const { path: wtPath } = await wt.create("task-1");
    // Simulate an agent build: a file in the worktree and a build artifact
    writeFileSync(join(wtPath, "feature.txt"), "new feature");
    const buildSrc = join(wtPath, "build");
    mkdirSync(buildSrc, { recursive: true });
    writeFileSync(join(buildSrc, "index.html"), "<html>v1</html>");

    const result: DeployResult = await mgr.deploy({
      taskId: "task-1",
      description: "Adds a feature",
      schemaChanged: true,
      validate: async () => ({ ok: true }),
      buildArtifactDir: "build",
      prodSubdir: "frontend-build",
    });

    expect(result.ok).toBe(true);
    expect(result.version.tag).toBe("v1");
    expect(result.snapshotId).toBe("2026-04-06T12-00-00Z");
    expect(existsSync(join(snapDir, "2026-04-06T12-00-00Z.sqlite.gz"))).toBe(true);
    expect(readFileSync(join(prodDir, "frontend-build", "index.html"), "utf8")).toBe("<html>v1</html>");
    expect(existsSync(join(repoDir, ".worktrees", "task-1"))).toBe(false);
    expect(readFileSync(join(repoDir, "feature.txt"), "utf8")).toBe("new feature");
    expect(restartCalls).toBe(1);
  });

  it("fails early if validate returns ok=false, no commit, no prod copy, no restart", async () => {
    const { path: wtPath } = await wt.create("task-2");
    mkdirSync(join(wtPath, "build"), { recursive: true });
    writeFileSync(join(wtPath, "build", "index.html"), "bad");

    const result = await mgr.deploy({
      taskId: "task-2",
      description: "Broken",
      schemaChanged: false,
      validate: async () => ({ ok: false, error: "typecheck failed" }),
      buildArtifactDir: "build",
      prodSubdir: "frontend-build",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("typecheck");
    expect(restartCalls).toBe(0);
    expect(existsSync(join(prodDir, "frontend-build"))).toBe(false);
    const list = await vs.list();
    expect(list.length).toBe(0);
  });

  it("skips snapshot when schemaChanged is false", async () => {
    const { path: wtPath } = await wt.create("task-3");
    writeFileSync(join(wtPath, "x.txt"), "x");
    mkdirSync(join(wtPath, "build"), { recursive: true });
    writeFileSync(join(wtPath, "build", "index.html"), "ok");

    const result = await mgr.deploy({
      taskId: "task-3",
      description: "No schema",
      schemaChanged: false,
      validate: async () => ({ ok: true }),
      buildArtifactDir: "build",
      prodSubdir: "frontend-build",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshotId).toBeUndefined();
    const snaps = await sn.list();
    expect(snaps.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/deployManager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/deployManager.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import type { VersionStore, Version } from "./versionStore.js";
import type { WorktreeManager } from "./worktrees.js";
import type { SnapshotManager } from "./snapshots.js";

export interface ValidateResult {
  ok: boolean;
  error?: string;
}

export interface DeployManagerOptions {
  repoDir: string;
  prodDir: string;
  versions: VersionStore;
  worktrees: WorktreeManager;
  snapshots: SnapshotManager;
  restartLogicService: () => Promise<void>;
  now?: () => Date;
}

export interface DeployInput {
  taskId: string;
  description: string;
  schemaChanged: boolean;
  validate: () => Promise<ValidateResult>;
  buildArtifactDir: string; // path inside worktree
  prodSubdir: string;       // subdir under prodDir to replace
}

export type DeployResult =
  | { ok: true; version: Version; snapshotId?: string }
  | { ok: false; error: string };

export class DeployManager {
  private git: SimpleGit;
  private now: () => Date;

  constructor(private readonly opts: DeployManagerOptions) {
    this.git = simpleGit(opts.repoDir);
    this.now = opts.now ?? (() => new Date());
  }

  async deploy(input: DeployInput): Promise<DeployResult> {
    const wtList = await this.opts.worktrees.list();
    const wt = wtList.find(w => w.taskId === input.taskId);
    if (!wt) return { ok: false, error: `worktree not found for ${input.taskId}` };

    // 1. Validate
    const val = await input.validate();
    if (!val.ok) {
      return { ok: false, error: val.error ?? "validation failed" };
    }

    // 2. Snapshot DB if schema changed
    let snapshotId: string | undefined;
    if (input.schemaChanged) {
      snapshotId = this.formatSnapshotId(this.now());
      await this.opts.snapshots.create(snapshotId);
    }

    // 3. Commit inside the worktree on its branch
    const wtGit = simpleGit(wt.path);
    await wtGit.add(".");
    const status = await wtGit.status();
    if (status.files.length > 0 || status.staged.length > 0) {
      await wtGit.commit(input.description);
    }

    // 4. Merge the task branch into main
    await this.git.raw(["merge", "--no-ff", "-m", input.description, wt.branch]);

    // 5. Tag the merge commit as a version
    const version = await this.tagHead(input.description);

    // 6. Copy build artifacts from the worktree into prod
    const src = path.join(wt.path, input.buildArtifactDir);
    const dest = path.join(this.opts.prodDir, input.prodSubdir);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dest, { recursive: true });
    await this.copyDir(src, dest);

    // 7. Remove the worktree + task branch
    await this.opts.worktrees.delete(input.taskId);

    // 8. Restart logic service
    await this.opts.restartLogicService();

    return { ok: true, version, ...(snapshotId !== undefined ? { snapshotId } : {}) };
  }

  private async tagHead(description: string): Promise<Version> {
    const log = await this.git.log({ maxCount: 1 });
    const head = log.latest!;
    const tag = await this.nextTag();
    await this.git.addAnnotatedTag(tag, description);
    return {
      sha: head.hash,
      tag,
      description,
      createdAt: new Date(head.date),
    };
  }

  private async nextTag(): Promise<string> {
    const tagsRaw = await this.git.tags();
    const nums = tagsRaw.all
      .filter(t => /^v\d+$/.test(t))
      .map(t => parseInt(t.slice(1), 10));
    const next = (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
    return `v${next}`;
  }

  private formatSnapshotId(d: Date): string {
    return d.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const e of entries) {
      const s = path.join(src, e.name);
      const d = path.join(dest, e.name);
      if (e.isDirectory()) await this.copyDir(s, d);
      else await fs.copyFile(s, d);
    }
  }
}
```

- [ ] **Step 4: Update `src/index.ts`**

```ts
export * from "./paths.js";
export * from "./crypto.js";
export * from "./snapshots.js";
export * from "./versionStore.js";
export * from "./worktrees.js";
export * from "./deployManager.js";
```

- [ ] **Step 5: Run test — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/deployManager.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Typecheck the whole shared package**

Run: `cd anyclaw-server && npx tsc -b packages/shared`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add anyclaw-server/packages/shared/src/deployManager.ts \
        anyclaw-server/packages/shared/test/deployManager.test.ts \
        anyclaw-server/packages/shared/src/index.ts
git commit -m "feat(shared): add DeployManager orchestrator"
```

---

### Task 7b: RollbackManager (TDD)

Symmetric to `DeployManager`: checks out a prior version tag, optionally restores a DB snapshot, and restarts the logic service. All dependencies injected — no supervisord coupling.

**Files:**
- Create: `anyclaw-server/packages/shared/src/rollbackManager.ts`
- Create: `anyclaw-server/packages/shared/test/rollbackManager.test.ts`
- Modify: `anyclaw-server/packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test `test/rollbackManager.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { RollbackManager } from "../src/rollbackManager.js";
import { VersionStore } from "../src/versionStore.js";
import { SnapshotManager } from "../src/snapshots.js";

async function initRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig("user.email", "t@a.local");
  await g.addConfig("user.name", "t");
  await g.addConfig("commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "x");
  await g.add(".");
  await g.commit("init");
  await g.raw(["branch", "-M", "main"]);
}

describe("RollbackManager", () => {
  let root: string;
  let repoDir: string;
  let snapDir: string;
  let dbPath: string;
  let vs: VersionStore;
  let sn: SnapshotManager;
  let restartCalls: number;
  let mgr: RollbackManager;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-rb-"));
    repoDir = join(root, "dev");
    snapDir = join(root, "snapshots");
    dbPath = join(root, "db.sqlite");
    writeFileSync(dbPath, Buffer.from("DB-CURRENT"));
    await initRepo(repoDir);
    vs = new VersionStore(repoDir);
    sn = new SnapshotManager({ sqlitePath: dbPath, snapshotsDir: snapDir, keep: 10 });
    restartCalls = 0;
    mgr = new RollbackManager({
      versions: vs,
      snapshots: sn,
      restartLogicService: async () => { restartCalls++; },
    });

    // Create two versions
    writeFileSync(join(repoDir, "f.txt"), "one");
    await vs.commitVersion({ description: "v1", files: ["f.txt"] });
    writeFileSync(join(repoDir, "f.txt"), "two");
    await vs.commitVersion({ description: "v2", files: ["f.txt"] });
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("rolls back to a prior version tag and restarts the logic service", async () => {
    const result = await mgr.rollback("v1");
    expect(result.ok).toBe(true);
    expect(readFileSync(join(repoDir, "f.txt"), "utf8")).toBe("one");
    expect(restartCalls).toBe(1);
  });

  it("restores DB snapshot when dbSnapshotId provided", async () => {
    const snapFile = await sn.create("snap-A");
    // snapshot captured "DB-CURRENT"; mutate live DB
    writeFileSync(dbPath, Buffer.from("DB-MUTATED"));
    const result = await mgr.rollback("v1", "snap-A");
    expect(result.ok).toBe(true);
    expect(readFileSync(dbPath).toString()).toBe("DB-CURRENT");
    expect(existsSync(snapFile)).toBe(true);
    expect(restartCalls).toBe(1);
  });

  it("fails gracefully when dbSnapshotId is missing", async () => {
    const result = await mgr.rollback("v1", "does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/snapshot/i);
    expect(restartCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/rollbackManager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/rollbackManager.ts`**

```ts
import path from "node:path";
import { promises as fs } from "node:fs";
import type { VersionStore } from "./versionStore.js";
import type { SnapshotManager } from "./snapshots.js";

export interface RollbackManagerOptions {
  versions: VersionStore;
  snapshots: SnapshotManager;
  restartLogicService: () => Promise<void>;
}

export type RollbackResult =
  | { ok: true }
  | { ok: false; error: string };

export class RollbackManager {
  constructor(private readonly opts: RollbackManagerOptions) {}

  async rollback(versionTag: string, dbSnapshotId?: string): Promise<RollbackResult> {
    // 1. Verify tag exists
    const versions = await this.opts.versions.list();
    if (!versions.find(v => v.tag === versionTag)) {
      return { ok: false, error: `version tag not found: ${versionTag}` };
    }

    // 2. If a DB snapshot was requested, verify it exists first (before touching anything)
    if (dbSnapshotId !== undefined) {
      const snaps = await this.opts.snapshots.list();
      const match = snaps.find(s => s.id === dbSnapshotId);
      if (!match) {
        return { ok: false, error: `snapshot not found: ${dbSnapshotId}` };
      }
      await this.opts.snapshots.restore(match.file);
    }

    // 3. Checkout the version tag
    await this.opts.versions.checkoutVersion(versionTag);

    // 4. Restart logic service
    await this.opts.restartLogicService();

    return { ok: true };
  }
}
```

- [ ] **Step 4: Update `src/index.ts`**

```ts
export * from "./paths.js";
export * from "./crypto.js";
export * from "./snapshots.js";
export * from "./versionStore.js";
export * from "./worktrees.js";
export * from "./deployManager.js";
export * from "./rollbackManager.js";
```

- [ ] **Step 5: Run test — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/shared/test/rollbackManager.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add anyclaw-server/packages/shared/src/rollbackManager.ts \
        anyclaw-server/packages/shared/test/rollbackManager.test.ts \
        anyclaw-server/packages/shared/src/index.ts
git commit -m "feat(shared): add RollbackManager orchestrator"
```

---

### Task 8: Dispatch scaffold with `/health` (TDD)

The `dispatch` package is the single Express app that hosts MCP routes (Plan 2), REST routes (Plan 3), and agent adapters (Plan 3), all on port **4100**. Plan 1 creates only the scaffold: `createApp(opts)` returns an Express instance with `/health` wired up, and later plans call `app.use(...)` to mount their route modules. No other routes exist in Plan 1.

**Files:**
- Create: `anyclaw-server/packages/dispatch/package.json`
- Create: `anyclaw-server/packages/dispatch/tsconfig.json`
- Create: `anyclaw-server/packages/dispatch/src/index.ts`
- Create: `anyclaw-server/packages/dispatch/test/health.test.ts`

- [ ] **Step 1: Create `packages/dispatch/package.json`**

```json
{
  "name": "@anyclaw/dispatch",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -b",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@anyclaw/shared": "*",
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2"
  }
}
```

- [ ] **Step 2: Create `packages/dispatch/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "references": [
    { "path": "../shared" }
  ],
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install**

Run: `cd anyclaw-server && npm install`
Expected: express, supertest installed.

- [ ] **Step 4: Write failing test `test/health.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";

describe("dispatch stub", () => {
  it("GET /health returns 200 and status=ok with a version string", async () => {
    const app = createApp({ version: "0.1.0" });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", version: "0.1.0" });
  });

  it("returns 404 for unknown routes", async () => {
    const app = createApp({ version: "0.1.0" });
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 5: Run test — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/dispatch/test/health.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement `src/index.ts`**

```ts
import express, { type Express } from "express";

export interface AppOptions {
  version: string;
}

/**
 * createApp() returns the single Express instance that hosts ALL dispatch
 * routes. Plan 1 wires only `/health`. Plan 2 mounts MCP routes onto this
 * same app (via `app.use("/mcp", mcpRouter)`). Plan 3 mounts REST routes
 * and agent adapters (via `app.use("/api", restRouter)` etc.). There is
 * only ever ONE Express app per container, listening on port 4100.
 */
export function createApp(opts: AppOptions): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", version: opts.version });
  });

  return app;
}

// Entrypoint for `node dist/index.js`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 4100);
  const app = createApp({ version: process.env.ANYCLAW_VERSION ?? "0.1.0" });
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[dispatch] listening on :${port}`);
  });
}
```

- [ ] **Step 7: Run test — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/dispatch/test/health.test.ts`
Expected: 2 passed.

- [ ] **Step 8: Build the whole repo**

Run: `cd anyclaw-server && npm run build`
Expected: success, produces `packages/*/dist/`.

- [ ] **Step 9: Commit**

```bash
git add anyclaw-server/packages/dispatch anyclaw-server/package-lock.json
git commit -m "feat(dispatch): scaffold Express app on :4100 with /health"
```

---

### Task 8b: `@anyclaw/tunnel-manager` package (TDD)

A Node service that will maintain a persistent WSS connection to `broker.anyclawapp.com` (real WSS wiring is Plan 4). In Plan 1 we create:
- a config loader that reads `/data/.anyclaw/server-token` and `/data/.anyclaw/device-keys.json`,
- a routing table that maps the in-envelope `service` tag (`pb`/`api`/`app`) to a local port (`8090`/`4100`/`5173`),
- a reconnection loop with exponential backoff that only logs (no real WSS).

**Files:**
- Create: `anyclaw-server/packages/tunnel-manager/package.json`
- Create: `anyclaw-server/packages/tunnel-manager/tsconfig.json`
- Create: `anyclaw-server/packages/tunnel-manager/src/index.ts`
- Create: `anyclaw-server/packages/tunnel-manager/src/config.ts`
- Create: `anyclaw-server/packages/tunnel-manager/src/router.ts`
- Create: `anyclaw-server/packages/tunnel-manager/src/reconnect.ts`
- Create: `anyclaw-server/packages/tunnel-manager/test/router.test.ts`
- Create: `anyclaw-server/packages/tunnel-manager/test/config.test.ts`

- [ ] **Step 1: Create `packages/tunnel-manager/package.json`**

```json
{
  "name": "@anyclaw/tunnel-manager",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -b",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@anyclaw/shared": "*",
    "ws": "^8.17.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.10"
  }
}
```

- [ ] **Step 2: Create `packages/tunnel-manager/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "references": [{ "path": "../shared" }],
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install**

Run: `cd anyclaw-server && npm install`
Expected: ws and types installed.

- [ ] **Step 4: Write failing test `test/router.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { ServiceRouter, type ServiceTag } from "../src/router.js";

describe("ServiceRouter", () => {
  const router = new ServiceRouter({
    pb: 8090,
    api: 4100,
    app: 5173,
  });

  it("maps pb -> 8090", () => {
    expect(router.portFor("pb")).toBe(8090);
  });
  it("maps api -> 4100", () => {
    expect(router.portFor("api")).toBe(4100);
  });
  it("maps app -> 5173", () => {
    expect(router.portFor("app")).toBe(5173);
  });
  it("throws for unknown service tags", () => {
    expect(() => router.portFor("nope" as ServiceTag)).toThrow(/unknown/i);
  });
  it("returns the local URL for a service", () => {
    expect(router.urlFor("pb")).toBe("http://127.0.0.1:8090");
    expect(router.urlFor("api")).toBe("http://127.0.0.1:4100");
    expect(router.urlFor("app")).toBe("http://127.0.0.1:5173");
  });
});
```

- [ ] **Step 5: Write failing test `test/config.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTunnelConfig } from "../src/config.js";

describe("loadTunnelConfig", () => {
  let root: string;
  let secretsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-tun-"));
    secretsDir = join(root, ".anyclaw");
    mkdirSync(secretsDir, { recursive: true });
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("loads server token and device keys from .anyclaw/", async () => {
    writeFileSync(join(secretsDir, "server-token"), "tok-123\n");
    writeFileSync(
      join(secretsDir, "device-keys.json"),
      JSON.stringify({
        publicKey: Buffer.alloc(32, 1).toString("base64"),
        secretKey: Buffer.alloc(32, 2).toString("base64"),
      }),
    );
    const cfg = await loadTunnelConfig({ secretsDir });
    expect(cfg.serverToken).toBe("tok-123");
    expect(cfg.deviceKeys.publicKey.length).toBe(32);
    expect(cfg.deviceKeys.secretKey.length).toBe(32);
    expect(cfg.brokerUrl).toBe("wss://broker.anyclawapp.com");
  });

  it("throws when server-token is missing", async () => {
    await expect(loadTunnelConfig({ secretsDir })).rejects.toThrow(/server-token/);
  });
});
```

- [ ] **Step 6: Run tests — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/tunnel-manager/test/`
Expected: FAIL — modules not found.

- [ ] **Step 7: Implement `src/router.ts`**

```ts
export type ServiceTag = "pb" | "api" | "app";

export interface RouteMap {
  pb: number;
  api: number;
  app: number;
}

export class ServiceRouter {
  constructor(private readonly ports: RouteMap) {}

  portFor(tag: ServiceTag): number {
    const p = this.ports[tag];
    if (p === undefined) throw new Error(`unknown service tag: ${tag}`);
    return p;
  }

  urlFor(tag: ServiceTag): string {
    return `http://127.0.0.1:${this.portFor(tag)}`;
  }
}
```

- [ ] **Step 8: Implement `src/config.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";

export interface DeviceKeys {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface TunnelConfig {
  serverToken: string;
  deviceKeys: DeviceKeys;
  brokerUrl: string;
}

export interface LoadOptions {
  secretsDir: string;
  brokerUrl?: string;
}

export async function loadTunnelConfig(opts: LoadOptions): Promise<TunnelConfig> {
  const tokenPath = path.join(opts.secretsDir, "server-token");
  const keysPath  = path.join(opts.secretsDir, "device-keys.json");

  let serverToken: string;
  try {
    serverToken = (await fs.readFile(tokenPath, "utf8")).trim();
  } catch {
    throw new Error(`tunnel-manager: missing server-token at ${tokenPath}`);
  }
  if (!serverToken) throw new Error(`tunnel-manager: empty server-token at ${tokenPath}`);

  const keysRaw = await fs.readFile(keysPath, "utf8");
  const parsed = JSON.parse(keysRaw) as { publicKey: string; secretKey: string };
  const deviceKeys: DeviceKeys = {
    publicKey: Buffer.from(parsed.publicKey, "base64"),
    secretKey: Buffer.from(parsed.secretKey, "base64"),
  };

  return {
    serverToken,
    deviceKeys,
    brokerUrl: opts.brokerUrl ?? "wss://broker.anyclawapp.com",
  };
}
```

- [ ] **Step 9: Implement `src/reconnect.ts`** (Plan 1 is logging-only; Plan 4 swaps in real WSS)

```ts
export interface ReconnectOptions {
  brokerUrl: string;
  onAttempt: (attempt: number, delayMs: number) => void;
  maxDelayMs?: number;
  baseDelayMs?: number;
  stopAfter?: number; // test hook
}

/**
 * Plan 1 stub: computes the backoff schedule and invokes onAttempt for each
 * attempt. Plan 4 replaces the body with a real WebSocket connection.
 */
export async function reconnectLoop(opts: ReconnectOptions): Promise<void> {
  const base = opts.baseDelayMs ?? 1000;
  const max  = opts.maxDelayMs  ?? 30000;
  const stopAfter = opts.stopAfter ?? Infinity;

  let attempt = 0;
  while (attempt < stopAfter) {
    attempt++;
    const delay = Math.min(max, base * Math.pow(2, attempt - 1));
    opts.onAttempt(attempt, delay);
    if (attempt >= stopAfter) return;
    await new Promise(r => setTimeout(r, 0)); // yield; no real sleep in stub
  }
}
```

- [ ] **Step 10: Implement `src/index.ts`**

```ts
import path from "node:path";
import { loadTunnelConfig } from "./config.js";
import { ServiceRouter } from "./router.js";
import { reconnectLoop } from "./reconnect.js";

export * from "./config.js";
export * from "./router.js";
export * from "./reconnect.js";

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const secretsDir = process.env.ANYCLAW_SECRETS_DIR ?? "/data/.anyclaw";
  loadTunnelConfig({ secretsDir }).then(cfg => {
    const router = new ServiceRouter({ pb: 8090, api: 4100, app: 5173 });
    // eslint-disable-next-line no-console
    console.log(`[tunnel-manager] broker=${cfg.brokerUrl} routes pb=${router.portFor("pb")} api=${router.portFor("api")} app=${router.portFor("app")}`);
    return reconnectLoop({
      brokerUrl: cfg.brokerUrl,
      onAttempt: (n, d) => console.log(`[tunnel-manager] (stub) connect attempt ${n} would wait ${d}ms`),
      stopAfter: 1,
    });
  }).catch(err => {
    // eslint-disable-next-line no-console
    console.error(`[tunnel-manager] startup failed:`, err);
    process.exit(1);
  });
}
```

- [ ] **Step 11: Run tests — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/tunnel-manager/test/`
Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add anyclaw-server/packages/tunnel-manager anyclaw-server/package-lock.json
git commit -m "feat(tunnel-manager): scaffold config loader, router, reconnect stub"
```

---

### Task 8c: `@anyclaw/logic-runner` package (TDD)

A small Node process that runs the agent-built logic service from `/data/prod/logic-build/index.js` on port **3000**. If the file doesn't exist, it instead serves a single endpoint that returns 503 with `{"error":"no_logic_deployed"}`. Watches `/data/prod/logic-build/` for changes and restarts the inner process.

**Files:**
- Create: `anyclaw-server/packages/logic-runner/package.json`
- Create: `anyclaw-server/packages/logic-runner/tsconfig.json`
- Create: `anyclaw-server/packages/logic-runner/src/index.ts`
- Create: `anyclaw-server/packages/logic-runner/src/fallback.ts`
- Create: `anyclaw-server/packages/logic-runner/test/fallback.test.ts`
- Create: `anyclaw-server/packages/logic-runner/test/runner.test.ts`

- [ ] **Step 1: Create `packages/logic-runner/package.json`**

```json
{
  "name": "@anyclaw/logic-runner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -b",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@anyclaw/shared": "*",
    "chokidar": "^3.6.0",
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2"
  }
}
```

- [ ] **Step 2: Create `packages/logic-runner/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "references": [{ "path": "../shared" }],
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install**

Run: `cd anyclaw-server && npm install`

- [ ] **Step 4: Write failing test `test/fallback.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createFallbackApp } from "../src/fallback.js";

describe("logic-runner fallback", () => {
  it("returns 503 with no_logic_deployed for any route", async () => {
    const app = createFallbackApp();
    const a = await request(app).get("/");
    expect(a.status).toBe(503);
    expect(a.body).toEqual({ error: "no_logic_deployed" });

    const b = await request(app).post("/api/anything");
    expect(b.status).toBe(503);
    expect(b.body).toEqual({ error: "no_logic_deployed" });
  });
});
```

- [ ] **Step 5: Write failing test `test/runner.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogicRunner } from "../src/index.js";

describe("LogicRunner", () => {
  let root: string;
  let buildDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-lr-"));
    buildDir = join(root, "logic-build");
    mkdirSync(buildDir, { recursive: true });
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("reports mode=fallback when index.js is missing", async () => {
    const runner = new LogicRunner({ buildDir, port: 0 });
    await runner.start();
    expect(runner.mode).toBe("fallback");
    await runner.stop();
  });

  it("reports mode=running when index.js exists", async () => {
    writeFileSync(join(buildDir, "index.js"), "// agent logic");
    const runner = new LogicRunner({ buildDir, port: 0 });
    await runner.start();
    expect(runner.mode).toBe("running");
    await runner.stop();
  });

  it("transitions from fallback to running when index.js appears", async () => {
    const runner = new LogicRunner({ buildDir, port: 0 });
    await runner.start();
    expect(runner.mode).toBe("fallback");
    writeFileSync(join(buildDir, "index.js"), "// later");
    await runner.reloadForTest();
    expect(runner.mode).toBe("running");
    await runner.stop();
  });
});
```

- [ ] **Step 6: Run tests — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/logic-runner/test/`
Expected: FAIL.

- [ ] **Step 7: Implement `src/fallback.ts`**

```ts
import express, { type Express } from "express";

export function createFallbackApp(): Express {
  const app = express();
  app.use((_req, res) => {
    res.status(503).json({ error: "no_logic_deployed" });
  });
  return app;
}
```

- [ ] **Step 8: Implement `src/index.ts`**

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import chokidar, { type FSWatcher } from "chokidar";
import type { Server } from "node:http";
import { createFallbackApp } from "./fallback.js";

export type RunnerMode = "fallback" | "running";

export interface LogicRunnerOptions {
  buildDir: string;
  port: number;
  nodeBin?: string;
}

export class LogicRunner {
  public mode: RunnerMode = "fallback";
  private child?: ChildProcess;
  private watcher?: FSWatcher;
  private fallback?: Server;

  constructor(private readonly opts: LogicRunnerOptions) {}

  async start(): Promise<void> {
    await this.reconcile();
    this.watcher = chokidar.watch(this.opts.buildDir, { ignoreInitial: true });
    this.watcher.on("all", () => { void this.reconcile(); });
  }

  async reloadForTest(): Promise<void> {
    await this.reconcile();
  }

  private async reconcile(): Promise<void> {
    const entry = path.join(this.opts.buildDir, "index.js");
    if (existsSync(entry)) {
      await this.stopFallback();
      await this.stopChild();
      this.child = spawn(this.opts.nodeBin ?? process.execPath, [entry], {
        stdio: "inherit",
        env: { ...process.env, PORT: String(this.opts.port) },
      });
      this.mode = "running";
    } else {
      await this.stopChild();
      if (!this.fallback) {
        const app = createFallbackApp();
        await new Promise<void>((resolve) => {
          this.fallback = app.listen(this.opts.port, () => resolve());
        });
      }
      this.mode = "fallback";
    }
  }

  private async stopChild(): Promise<void> {
    if (this.child) {
      this.child.kill();
      this.child = undefined;
    }
  }

  private async stopFallback(): Promise<void> {
    if (this.fallback) {
      await new Promise<void>((resolve) => this.fallback!.close(() => resolve()));
      this.fallback = undefined;
    }
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    await this.stopChild();
    await this.stopFallback();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const buildDir = process.env.LOGIC_BUILD_DIR ?? "/data/prod/logic-build";
  const port = Number(process.env.PORT ?? 3000);
  const runner = new LogicRunner({ buildDir, port });
  runner.start().then(() => {
    // eslint-disable-next-line no-console
    console.log(`[logic-runner] listening on :${port} mode=${runner.mode}`);
  });
}
```

- [ ] **Step 9: Run tests — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/logic-runner/test/`

- [ ] **Step 10: Commit**

```bash
git add anyclaw-server/packages/logic-runner anyclaw-server/package-lock.json
git commit -m "feat(logic-runner): supervise agent-built logic service on :3000"
```

---

### Task 8d: `@anyclaw/prod-static` package (TDD)

A small Express server that serves static files from `/data/prod/frontend-build/` on port **5173**. If the directory is empty (nothing has been deployed), it serves a placeholder "Welcome to AnyClaw — your agent has not built anything yet" HTML page. SPA fallback: unknown routes return `index.html`.

**Files:**
- Create: `anyclaw-server/packages/prod-static/package.json`
- Create: `anyclaw-server/packages/prod-static/tsconfig.json`
- Create: `anyclaw-server/packages/prod-static/src/index.ts`
- Create: `anyclaw-server/packages/prod-static/src/placeholder.ts`
- Create: `anyclaw-server/packages/prod-static/test/server.test.ts`

- [ ] **Step 1: Create `packages/prod-static/package.json`**

```json
{
  "name": "@anyclaw/prod-static",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -b",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2"
  }
}
```

- [ ] **Step 2: Create `packages/prod-static/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install**

Run: `cd anyclaw-server && npm install`

- [ ] **Step 4: Write failing test `test/server.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createProdStaticApp } from "../src/index.js";

describe("prod-static", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-ps-"));
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("serves the placeholder when the build dir is empty", async () => {
    mkdirSync(root, { recursive: true });
    const app = createProdStaticApp({ buildDir: root });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Welcome to AnyClaw/);
    expect(res.text).toMatch(/has not built anything yet/);
  });

  it("serves index.html when the build dir has content", async () => {
    writeFileSync(join(root, "index.html"), "<html><body>APP</body></html>");
    writeFileSync(join(root, "app.js"), "console.log(1)");
    const app = createProdStaticApp({ buildDir: root });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("APP");
  });

  it("serves static assets", async () => {
    writeFileSync(join(root, "index.html"), "<html></html>");
    writeFileSync(join(root, "app.js"), "console.log(1)");
    const app = createProdStaticApp({ buildDir: root });
    const res = await request(app).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.text).toContain("console.log");
  });

  it("falls back to index.html for SPA routes", async () => {
    writeFileSync(join(root, "index.html"), "<html>SPA</html>");
    const app = createProdStaticApp({ buildDir: root });
    const res = await request(app).get("/settings/profile");
    expect(res.status).toBe(200);
    expect(res.text).toContain("SPA");
  });
});
```

- [ ] **Step 5: Run test — expect FAIL**

Run: `cd anyclaw-server && npx vitest run packages/prod-static/test/`
Expected: FAIL.

- [ ] **Step 6: Implement `src/placeholder.ts`**

```ts
export const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AnyClaw</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
  </head>
  <body>
    <main style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;">
      <h1>Welcome to AnyClaw</h1>
      <p>Your agent has not built anything yet.</p>
    </main>
  </body>
</html>
`;
```

- [ ] **Step 7: Implement `src/index.ts`**

```ts
import express, { type Express } from "express";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { PLACEHOLDER_HTML } from "./placeholder.js";

export interface ProdStaticOptions {
  buildDir: string;
}

export function createProdStaticApp(opts: ProdStaticOptions): Express {
  const app = express();

  const hasIndex = () =>
    existsSync(opts.buildDir) &&
    readdirSync(opts.buildDir).includes("index.html");

  app.use((req, res, next) => {
    if (hasIndex()) return next();
    res.status(200).type("html").send(PLACEHOLDER_HTML);
  });

  app.use(express.static(opts.buildDir, { index: "index.html" }));

  // SPA fallback
  app.use((_req, res, next) => {
    if (!hasIndex()) return next();
    res.sendFile(path.join(opts.buildDir, "index.html"));
  });

  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const buildDir = process.env.PROD_FRONTEND_DIR ?? "/data/prod/frontend-build";
  const port = Number(process.env.PORT ?? 5173);
  const app = createProdStaticApp({ buildDir });
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[prod-static] serving ${buildDir} on :${port}`);
  });
}
```

- [ ] **Step 8: Run test — expect PASS**

Run: `cd anyclaw-server && npx vitest run packages/prod-static/test/`

- [ ] **Step 9: Commit**

```bash
git add anyclaw-server/packages/prod-static anyclaw-server/package-lock.json
git commit -m "feat(prod-static): Express static server on :5173 with placeholder"
```

---

### Task 8e: `@anyclaw/frontend-template` package (TDD)

A Vite + React + TypeScript + Tailwind v4 seed project copied into `/data/dev/` on first run. Plan 1 creates the scaffold only — the FULL `@theme` color values, real welcome page content, and the real PocketBase-backed `usePreferences` integration are locked in Plan 6. Plan 1 provides the package shell, hook contract, and a verifying build test.

**Files:**
- Create: `anyclaw-server/packages/frontend-template/package.json`
- Create: `anyclaw-server/packages/frontend-template/tsconfig.json`
- Create: `anyclaw-server/packages/frontend-template/vite.config.ts`
- Create: `anyclaw-server/packages/frontend-template/index.html`
- Create: `anyclaw-server/packages/frontend-template/src/main.tsx`
- Create: `anyclaw-server/packages/frontend-template/src/App.tsx`
- Create: `anyclaw-server/packages/frontend-template/src/app.css`
- Create: `anyclaw-server/packages/frontend-template/src/lib/usePreferences.ts`
- Create: `anyclaw-server/packages/frontend-template/test/usePreferences.test.ts`
- Create: `anyclaw-server/packages/frontend-template/test/build.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@anyclaw/frontend-template",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.0",
    "lucide-react": "^0.400.0",
    "pocketbase": "^0.25.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "vite": "^5.3.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "rootDir": ".",
    "outDir": "dist",
    "noEmit": true,
    "composite": false
  },
  "include": ["src/**/*", "test/**/*", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: Create `index.html`**

```html
<!doctype html>
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

- [ ] **Step 5: Create `src/app.css`**

```css
@import 'tailwindcss';

/* Plan 6 fills in real color values. This is only a placeholder to prove the
   template builds. */
@theme {
  --color-primary: #000000;
}
```

- [ ] **Step 6: Create `src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import "./app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 7: Create `src/App.tsx`**

```tsx
import { Routes, Route } from "react-router-dom";

function Home() {
  return <main className="p-8">AnyClaw template</main>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
```

- [ ] **Step 8: Create `src/lib/usePreferences.ts`** (hook contract — real PB integration is Plan 6)

```ts
export interface Preferences {
  theme: "light" | "dark" | "system";
  locale: string;
}

export interface UsePreferencesResult {
  preferences: Preferences;
  loading: boolean;
  error: Error | null;
}

/**
 * Plan 1 scaffold: returns hardcoded defaults so the template builds and
 * components can be authored against a stable shape. Plan 6 replaces the
 * body with real PocketBase `_preferences` collection reads.
 */
export function usePreferences(): UsePreferencesResult {
  return {
    preferences: { theme: "system", locale: "en-US" },
    loading: false,
    error: null,
  };
}
```

- [ ] **Step 9: Create `test/usePreferences.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { usePreferences } from "../src/lib/usePreferences.js";

describe("usePreferences (scaffold)", () => {
  it("returns the expected shape with defaults", () => {
    const result = usePreferences();
    expect(result.loading).toBe(false);
    expect(result.error).toBeNull();
    expect(result.preferences.theme).toBe("system");
    expect(result.preferences.locale).toBe("en-US");
  });
});
```

- [ ] **Step 10: Create `test/build.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

describe("frontend-template build", () => {
  it("vite build produces dist/index.html", () => {
    const pkgDir = join(__dirname, "..");
    execSync("npx vite build", { cwd: pkgDir, stdio: "inherit" });
    expect(existsSync(join(pkgDir, "dist", "index.html"))).toBe(true);
  });
}, { timeout: 60000 });
```

- [ ] **Step 11: Install and run tests**

Run: `cd anyclaw-server && npm install`
Run: `cd anyclaw-server && npx vitest run packages/frontend-template/test/usePreferences.test.ts`
Expected: pass.
Run: `cd anyclaw-server && npx vitest run packages/frontend-template/test/build.test.ts`
Expected: pass; `packages/frontend-template/dist/index.html` exists.

- [ ] **Step 12: Commit**

```bash
git add anyclaw-server/packages/frontend-template anyclaw-server/package-lock.json
git commit -m "feat(frontend-template): Vite+React+Tailwind v4 seed for /data/dev"
```

---

### Task 9: Full test suite green-bar

**Files:**
- None

- [ ] **Step 1: Run all tests**

Run: `cd anyclaw-server && npm test`
Expected: all suites pass (paths, crypto, snapshots, versionStore, worktrees, deployManager, rollbackManager, dispatch health, tunnel-manager router+config, logic-runner fallback+runner, prod-static server, frontend-template usePreferences + build).

- [ ] **Step 2: Typecheck the whole repo**

Run: `cd anyclaw-server && npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit (only if anything changed)**

```bash
git status
# If there are no changes, skip this step.
```

---

### Task 10: Filesystem layout init script

**Files:**
- Create: `anyclaw-server/infra/scripts/init-data-layout.sh`

- [ ] **Step 1: Create `init-data-layout.sh`**

```bash
#!/usr/bin/env bash
# Initialize the AnyClaw /data filesystem layout.
# Idempotent: safe to run multiple times.
set -euo pipefail

DATA_ROOT="${DATA_ROOT:-/data}"
FRONTEND_TEMPLATE_SRC="${FRONTEND_TEMPLATE_SRC:-/anyclaw/frontend-template}"

mkdir -p "$DATA_ROOT/pocketbase/pb_data"
mkdir -p "$DATA_ROOT/dev"
mkdir -p "$DATA_ROOT/dev/.worktrees"
mkdir -p "$DATA_ROOT/prod/frontend-build"
mkdir -p "$DATA_ROOT/prod/logic-build"
mkdir -p "$DATA_ROOT/snapshots"
mkdir -p "$DATA_ROOT/.anyclaw/logs"

chmod 0750 "$DATA_ROOT/.anyclaw" || true

# On first run, seed /data/dev with the frontend template so the agent has
# something to start with. We detect "first run" by the absence of .git.
if [ ! -d "$DATA_ROOT/dev/.git" ]; then
  if [ -d "$FRONTEND_TEMPLATE_SRC" ]; then
    # Copy everything except node_modules and dist
    ( cd "$FRONTEND_TEMPLATE_SRC" \
      && find . -mindepth 1 \
           -not -path "./node_modules*" \
           -not -path "./dist*" \
           -print0 \
        | xargs -0 -I {} cp -r --parents {} "$DATA_ROOT/dev/" 2>/dev/null || true )
  fi

  ( cd "$DATA_ROOT/dev" \
    && git init --initial-branch=main \
    && git config user.email "anyclaw@local" \
    && git config user.name  "AnyClaw" \
    && git config commit.gpgsign false \
    && [ -f README.md ] || : > README.md \
    && git add -A \
    && git commit -m "initial: frontend-template seed" )
fi

# Always ensure the worktrees dir exists (even after first run)
mkdir -p "$DATA_ROOT/dev/.worktrees"

echo "AnyClaw data layout ready at $DATA_ROOT"
```

- [ ] **Step 2: Make it executable and test locally**

Run: `chmod +x anyclaw-server/infra/scripts/init-data-layout.sh`
Run: `DATA_ROOT=$(mktemp -d)/data bash anyclaw-server/infra/scripts/init-data-layout.sh`
Expected: prints "AnyClaw data layout ready at ...", creates the directories, initializes git repo, exit 0.

- [ ] **Step 3: Commit**

```bash
git add anyclaw-server/infra/scripts/init-data-layout.sh
git commit -m "feat(infra): add init-data-layout.sh"
```

---

### Task 11: PocketBase download script

**Files:**
- Create: `anyclaw-server/infra/scripts/download-pocketbase.sh`

- [ ] **Step 1: Create `download-pocketbase.sh`**

```bash
#!/usr/bin/env bash
# Download the PocketBase binary for the current platform.
# Used by the Dockerfile and by native installs.
set -euo pipefail

# Pinned to 0.25.x — must stay consistent with the JS SDK version in
# frontend-template (pocketbase ^0.25.0) and the bootstrap migrations in Plan 2.
POCKETBASE_VERSION="${POCKETBASE_VERSION:-0.25.0}"
DEST="${DEST:-/usr/local/bin/pocketbase}"

UNAME_S="$(uname -s | tr '[:upper:]' '[:lower:]')"
UNAME_M="$(uname -m)"

case "$UNAME_S" in
  linux)  OS="linux"  ;;
  darwin) OS="darwin" ;;
  *) echo "Unsupported OS: $UNAME_S" >&2; exit 1 ;;
esac

case "$UNAME_M" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported arch: $UNAME_M" >&2; exit 1 ;;
esac

URL="https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_${OS}_${ARCH}.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading PocketBase $POCKETBASE_VERSION ($OS/$ARCH)..."
curl -fsSL -o "$TMP/pb.zip" "$URL"
unzip -q "$TMP/pb.zip" -d "$TMP"
install -m 0755 "$TMP/pocketbase" "$DEST"

echo "Installed: $DEST"
"$DEST" --version || true
```

- [ ] **Step 2: Make executable**

Run: `chmod +x anyclaw-server/infra/scripts/download-pocketbase.sh`

- [ ] **Step 3: Commit**

```bash
git add anyclaw-server/infra/scripts/download-pocketbase.sh
git commit -m "feat(infra): add download-pocketbase.sh"
```

---

### Task 12: supervisord configuration

**Files:**
- Create: `anyclaw-server/infra/supervisord.conf`

- [ ] **Step 1: Create `supervisord.conf`** (Plan 1 supervises all 5 processes: `pocketbase`, `dispatch`, `tunnel-manager`, `logic-runner`, `prod-static`.)

```ini
[supervisord]
nodaemon=true
logfile=/var/log/anyclaw/supervisord.log
pidfile=/var/run/supervisord.pid
user=root

[unix_http_server]
file=/var/run/supervisor.sock
chmod=0700

[rpcinterface:supervisor]
supervisor.rpcinterface_factory=supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix:///var/run/supervisor.sock

[program:pocketbase]
command=/usr/local/bin/pocketbase serve --http=127.0.0.1:8090 --dir=/data/pocketbase/pb_data
autorestart=true
startretries=10
user=anyclaw-infra
stdout_logfile=/var/log/anyclaw/pocketbase.log
stderr_logfile=/var/log/anyclaw/pocketbase.err

[program:dispatch]
command=/usr/bin/node /anyclaw/dispatch/dist/index.js
directory=/anyclaw/dispatch
autorestart=true
startretries=10
user=anyclaw-infra
environment=POCKETBASE_URL="http://127.0.0.1:8090",DEV_WORKSPACE="/data/dev",PROD_WORKSPACE="/data/prod",SNAPSHOTS_DIR="/data/snapshots",INFRA_DIR="/anyclaw",PORT="4100",ANYCLAW_VERSION="0.1.0"
stdout_logfile=/var/log/anyclaw/dispatch.log
stderr_logfile=/var/log/anyclaw/dispatch.err

[program:tunnel-manager]
command=/usr/bin/node /anyclaw/tunnel-manager/dist/index.js
directory=/anyclaw/tunnel-manager
autorestart=true
startretries=10
user=anyclaw-infra
environment=ANYCLAW_SECRETS_DIR="/data/.anyclaw"
stdout_logfile=/var/log/anyclaw/tunnel-manager.log
stderr_logfile=/var/log/anyclaw/tunnel-manager.err

[program:logic-runner]
command=/usr/bin/node /anyclaw/logic-runner/dist/index.js
directory=/anyclaw/logic-runner
; logic-runner wraps agent-authored code, which might crash — use on-failure
; so supervisord still restarts it but does not hide a crash loop.
autorestart=unexpected
startretries=20
user=anyclaw-infra
environment=LOGIC_BUILD_DIR="/data/prod/logic-build",PORT="3000"
stdout_logfile=/var/log/anyclaw/logic-runner.log
stderr_logfile=/var/log/anyclaw/logic-runner.err

[program:prod-static]
command=/usr/bin/node /anyclaw/prod-static/dist/index.js
directory=/anyclaw/prod-static
autorestart=true
startretries=10
user=anyclaw-infra
environment=PROD_FRONTEND_DIR="/data/prod/frontend-build",PORT="5173"
stdout_logfile=/var/log/anyclaw/prod-static.log
stderr_logfile=/var/log/anyclaw/prod-static.err
```

- [ ] **Step 2: Commit**

```bash
git add anyclaw-server/infra/supervisord.conf
git commit -m "feat(infra): add supervisord.conf with all 5 supervised processes"
```

---

### Task 13: Dockerfile

**Files:**
- Create: `anyclaw-server/infra/Dockerfile`
- Create: `anyclaw-server/.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
**/node_modules
**/dist
**/*.tsbuildinfo
.git
tmp-test-*
coverage
```

- [ ] **Step 2: Create `infra/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:20-bookworm-slim AS builder

WORKDIR /build
COPY package.json package-lock.json tsconfig.base.json vitest.config.ts ./
COPY packages ./packages
RUN npm ci
RUN npm run build


FROM node:20-bookworm-slim

ARG POCKETBASE_VERSION=0.25.0

RUN apt-get update && apt-get install -y --no-install-recommends \
      supervisor \
      git \
      curl \
      ca-certificates \
      unzip \
      tini \
 && rm -rf /var/lib/apt/lists/*

# PocketBase binary
RUN curl -fsSL -o /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_amd64.zip" \
 && unzip /tmp/pb.zip -d /usr/local/bin \
 && rm /tmp/pb.zip \
 && chmod +x /usr/local/bin/pocketbase

# Non-root users
RUN groupadd --system anyclaw-infra \
 && useradd  --system --gid anyclaw-infra --home /anyclaw --shell /usr/sbin/nologin anyclaw-infra \
 && groupadd --system anyclaw-agent \
 && useradd  --system --gid anyclaw-agent --home /data/dev --shell /bin/bash anyclaw-agent

# Bundle all 5 supervised packages + shared (runtime artifacts only)
RUN mkdir -p /anyclaw/dispatch /anyclaw/shared /anyclaw/tunnel-manager \
             /anyclaw/logic-runner /anyclaw/prod-static /anyclaw/frontend-template
COPY --from=builder /build/packages/dispatch/dist             /anyclaw/dispatch/dist
COPY --from=builder /build/packages/dispatch/package.json     /anyclaw/dispatch/package.json
COPY --from=builder /build/packages/shared/dist               /anyclaw/shared/dist
COPY --from=builder /build/packages/shared/package.json       /anyclaw/shared/package.json
COPY --from=builder /build/packages/tunnel-manager/dist       /anyclaw/tunnel-manager/dist
COPY --from=builder /build/packages/tunnel-manager/package.json /anyclaw/tunnel-manager/package.json
COPY --from=builder /build/packages/logic-runner/dist         /anyclaw/logic-runner/dist
COPY --from=builder /build/packages/logic-runner/package.json /anyclaw/logic-runner/package.json
COPY --from=builder /build/packages/prod-static/dist          /anyclaw/prod-static/dist
COPY --from=builder /build/packages/prod-static/package.json  /anyclaw/prod-static/package.json
# frontend-template is copied as SOURCE (not built dist) because init-data-layout.sh
# seeds the source into /data/dev/ on first run where the agent will modify and build it.
COPY --from=builder /build/packages/frontend-template         /anyclaw/frontend-template
COPY --from=builder /build/node_modules                       /anyclaw/node_modules
RUN rm -rf /anyclaw/frontend-template/node_modules /anyclaw/frontend-template/dist \
 && chown -R anyclaw-infra:anyclaw-infra /anyclaw

# Data directories
RUN mkdir -p /data/pocketbase/pb_data \
             /data/dev/.worktrees \
             /data/prod/frontend-build \
             /data/prod/logic-build \
             /data/snapshots \
             /data/.anyclaw/logs \
             /var/log/anyclaw \
             /var/run \
 && chown -R anyclaw-infra:anyclaw-infra /data/pocketbase /data/prod /data/snapshots \
                                          /data/.anyclaw  /var/log/anyclaw \
 && chown -R anyclaw-agent:anyclaw-agent /data/dev \
 && chmod 0750 /data/.anyclaw

# Infra scripts + supervisord config
COPY infra/scripts/ /anyclaw/scripts/
RUN chmod +x /anyclaw/scripts/*.sh
COPY infra/supervisord.conf /etc/supervisor/conf.d/anyclaw.conf

# Initialize the dev git repo at image-build time so the container is ready
RUN bash /anyclaw/scripts/init-data-layout.sh \
 && chown -R anyclaw-agent:anyclaw-agent /data/dev

EXPOSE 8090 4100 5173 3000
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/anyclaw.conf"]
```

- [ ] **Step 3: Verify Docker build works**

Run: `cd anyclaw-server && docker build -f infra/Dockerfile -t anyclaw:plan1 .`
Expected: build succeeds.

- [ ] **Step 4: Run the container and smoke-test `/health`**

Run:
```bash
docker run --rm -d --name anyclaw-plan1 \
  -p 127.0.0.1:4100:4100 \
  -p 127.0.0.1:5173:5173 \
  -p 127.0.0.1:8090:8090 \
  anyclaw:plan1
sleep 5
curl -fsS http://127.0.0.1:4100/health
curl -fsS http://127.0.0.1:5173/ | head -5
docker logs anyclaw-plan1 | tail -60
docker stop anyclaw-plan1
```
Expected: `curl /health` prints `{"status":"ok","version":"0.1.0"}`. `curl /` against prod-static returns the "Welcome to AnyClaw" placeholder HTML. Logs show all 5 supervised processes started: `pocketbase`, `dispatch`, `tunnel-manager`, `logic-runner`, `prod-static`. `/data/dev` contains the seeded frontend-template with a git history.

- [ ] **Step 5: Commit**

```bash
git add anyclaw-server/infra/Dockerfile anyclaw-server/.dockerignore
git commit -m "feat(infra): add Dockerfile for plan1 single-container"
```

---

### Task 14: Final verification pass

**Files:**
- None

- [ ] **Step 1: Clean build from scratch**

Run:
```bash
cd anyclaw-server
rm -rf node_modules packages/*/dist packages/*/node_modules
npm install
npm run build
npm run typecheck
npm test
```
Expected: every step succeeds; all test suites pass.

- [ ] **Step 2: Verify all Plan 1 deliverables exist**

Run: `cd anyclaw-server && ls packages/shared/src packages/dispatch/src packages/tunnel-manager/src packages/logic-runner/src packages/prod-static/src packages/frontend-template/src infra`
Expected output includes:
- `packages/shared/src`: `paths.ts crypto.ts snapshots.ts versionStore.ts worktrees.ts deployManager.ts rollbackManager.ts index.ts`
- `packages/dispatch/src`: `index.ts`
- `packages/tunnel-manager/src`: `index.ts config.ts router.ts reconnect.ts`
- `packages/logic-runner/src`: `index.ts fallback.ts`
- `packages/prod-static/src`: `index.ts placeholder.ts`
- `packages/frontend-template/src`: `main.tsx App.tsx app.css lib/`
- `infra`: `Dockerfile supervisord.conf scripts`

- [ ] **Step 3: Tag the plan completion**

```bash
git tag plan1-complete
git log --oneline -20
```

---

## Self-Review Checklist

- **Spec coverage:** monorepo scaffold (Task 1), TypeScript build + typecheck (Task 1), `@anyclaw/shared` with `paths` (Task 2), `crypto` (Task 3), `snapshots` (Task 4), `versionStore` (Task 5), `worktrees` (Task 6), `deployManager` (Task 7), `rollbackManager` (Task 7b), `@anyclaw/dispatch` scaffold on :4100 (Task 8), `@anyclaw/tunnel-manager` (Task 8b), `@anyclaw/logic-runner` on :3000 (Task 8c), `@anyclaw/prod-static` on :5173 (Task 8d), `@anyclaw/frontend-template` Vite+React+Tailwind v4 seed (Task 8e), filesystem init that copies the frontend-template into `/data/dev/` and creates `.worktrees/` (Task 10), PocketBase 0.25 pinned download (Task 11), supervisord with all 5 programs (Task 12), Dockerfile bundling all 5 packages + frontend-template source (Task 13), full verification (Tasks 9 + 14).
- **Canonical decisions honored:** shared = `@anyclaw/shared`; dispatch = `@anyclaw/dispatch` on port **4100** (Plan 2 mounts MCP routes onto this same Express app, Plan 3 mounts REST + adapters — there is only ONE dispatch Express app per container); npm workspaces; infra at `anyclaw-server/infra/`; PocketBase **0.25** binary + **^0.25.0** JS SDK.
- **Out of scope (deferred to later plans):** MCP tools and routes (Plan 2), PocketBase collection bootstrap with `_` prefixed collections (Plan 2), dispatch REST routes and agent adapters (Plan 3), real WSS broker connection and CBOR envelope (Plan 4), mobile app (Plan 5), welcome page content, real `@theme` color values, `usePreferences` PocketBase integration, skills, `install.sh`, `bootstrap-pocketbase.sh`, `store-api-key.js` (all Plan 6 — Plan 1 only provides the scripts `install.sh` will call and the frontend hook contract Plan 6 will implement against).
- **Type / name consistency:** `AnyClawPaths`, `KeyPair`, `SealedBox`, `SnapshotManager`, `Version`, `VersionStore`, `Worktree`, `WorktreeManager`, `DeployManager`, `DeployResult`, `ValidateResult`, `RollbackManager`, `RollbackResult`, `createApp` (dispatch), `ServiceRouter`, `ServiceTag`, `TunnelConfig`, `DeviceKeys`, `LogicRunner`, `RunnerMode`, `createFallbackApp`, `createProdStaticApp`, `Preferences`, `usePreferences` are each defined exactly once and imported under the same name across tests, implementations, and package barrels.
- **No placeholders:** every step includes complete code or a concrete command with expected output. No TBD / TODO / "similar to".
