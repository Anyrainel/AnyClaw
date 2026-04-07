# Plan 1: Server Infrastructure Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the AnyClaw server monorepo with shared libraries (NaCl crypto, snapshot manager, git-based version store, worktree manager, deploy manager), filesystem layout, PocketBase binary, supervisord config, Dockerfile, and a minimal dispatch server stub that exposes `/health` — the foundation every other plan builds on.

**Architecture:** TypeScript monorepo under `anyclaw-server/` using npm workspaces. Shared code lives in `packages/shared/` and is imported by `packages/dispatch/` (stub in this plan, real in Plan 2/3), `packages/tunnel/` (Plan 4), `packages/prod-static/` (Plan 6). All persistent state is rooted at `/data` (PocketBase, dev, prod, snapshots, `.anyclaw`). Process supervision runs via `supervisord` inside a single Docker container.

**Tech Stack:** Node.js 20, TypeScript 5.4, npm workspaces, vitest, libsodium-wrappers, better-sqlite3 (schema-inspection only for snapshot tests), simple-git, express (health stub), supervisord, PocketBase 0.22.

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
      test/
        crypto.test.ts
        snapshots.test.ts
        versionStore.test.ts
        worktrees.test.ts
        deployManager.test.ts
        paths.test.ts
    dispatch/
      package.json
      tsconfig.json
      src/
        index.ts                     # express stub, /health only
      test/
        health.test.ts
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
    "typecheck": "tsc -b packages/shared packages/dispatch",
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
- `shared` — crypto, snapshots, version store, worktrees, deploy manager
- `dispatch` — control-plane HTTP server (stub in Plan 1, expanded in Plan 2/3)
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

### Task 8: Dispatch stub server with `/health` (TDD)

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
  const port = Number(process.env.PORT ?? 3002);
  const app = createApp({ version: process.env.ANYCLAW_VERSION ?? "0.1.0" });
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[dispatch-stub] listening on :${port}`);
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
git commit -m "feat(dispatch): stub server with /health endpoint"
```

---

### Task 9: Full test suite green-bar

**Files:**
- None

- [ ] **Step 1: Run all tests**

Run: `cd anyclaw-server && npm test`
Expected: all suites pass (paths, crypto, snapshots, versionStore, worktrees, deployManager, dispatch health).

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

mkdir -p "$DATA_ROOT/pocketbase/pb_data"
mkdir -p "$DATA_ROOT/dev"
mkdir -p "$DATA_ROOT/dev/.worktrees"
mkdir -p "$DATA_ROOT/prod/frontend-build"
mkdir -p "$DATA_ROOT/prod/logic-build"
mkdir -p "$DATA_ROOT/snapshots"
mkdir -p "$DATA_ROOT/.anyclaw/logs"

chmod 0750 "$DATA_ROOT/.anyclaw" || true

# Initialize the dev git repo if not already
if [ ! -d "$DATA_ROOT/dev/.git" ]; then
  ( cd "$DATA_ROOT/dev" \
    && git init --initial-branch=main \
    && git config user.email "anyclaw@local" \
    && git config user.name  "AnyClaw" \
    && git config commit.gpgsign false \
    && : > README.md \
    && git add README.md \
    && git commit -m "initial" )
fi

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

POCKETBASE_VERSION="${POCKETBASE_VERSION:-0.22.0}"
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

- [ ] **Step 1: Create `supervisord.conf`** (Plan 1 includes only PocketBase + the dispatch stub; tunnel / logic / prod-static are added by later plans.)

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

[program:dispatch-mcp]
command=/usr/bin/node /anyclaw/dispatch/dist/index.js
directory=/anyclaw/dispatch
autorestart=true
startretries=10
user=anyclaw-infra
environment=POCKETBASE_URL="http://127.0.0.1:8090",DEV_WORKSPACE="/data/dev",PROD_WORKSPACE="/data/prod",SNAPSHOTS_DIR="/data/snapshots",INFRA_DIR="/anyclaw",PORT="3002",ANYCLAW_VERSION="0.1.0"
stdout_logfile=/var/log/anyclaw/dispatch.log
stderr_logfile=/var/log/anyclaw/dispatch.err
```

- [ ] **Step 2: Commit**

```bash
git add anyclaw-server/infra/supervisord.conf
git commit -m "feat(infra): add supervisord.conf with pocketbase + dispatch stub"
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

ARG POCKETBASE_VERSION=0.22.0

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

# Dispatch build + shared (runtime deps only)
RUN mkdir -p /anyclaw/dispatch /anyclaw/shared
COPY --from=builder /build/packages/dispatch/dist         /anyclaw/dispatch/dist
COPY --from=builder /build/packages/dispatch/package.json /anyclaw/dispatch/package.json
COPY --from=builder /build/packages/shared/dist           /anyclaw/shared/dist
COPY --from=builder /build/packages/shared/package.json   /anyclaw/shared/package.json
COPY --from=builder /build/node_modules                   /anyclaw/node_modules
RUN chown -R anyclaw-infra:anyclaw-infra /anyclaw

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

EXPOSE 8090 3002
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
docker run --rm -d --name anyclaw-plan1 -p 127.0.0.1:3002:3002 -p 127.0.0.1:8090:8090 anyclaw:plan1
sleep 3
curl -fsS http://127.0.0.1:3002/health
docker logs anyclaw-plan1 | tail -30
docker stop anyclaw-plan1
```
Expected: `curl` prints `{"status":"ok","version":"0.1.0"}`. Logs show `pocketbase` and `dispatch-mcp` both started.

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

Run: `cd anyclaw-server && ls packages/shared/src packages/dispatch/src infra`
Expected output includes:
- `packages/shared/src`: `paths.ts crypto.ts snapshots.ts versionStore.ts worktrees.ts deployManager.ts index.ts`
- `packages/dispatch/src`: `index.ts`
- `infra`: `Dockerfile supervisord.conf scripts`

- [ ] **Step 3: Tag the plan completion**

```bash
git tag plan1-complete
git log --oneline -20
```

---

## Self-Review Checklist

- **Spec coverage:** monorepo scaffold (Task 1), TypeScript build (Task 1+2+8), filesystem layout (Task 10), PocketBase download (Task 11), NaCl crypto (Task 3), snapshot manager (Task 4), version store (Task 5), worktree manager (Task 6), deploy manager (Task 7), supervisord config (Task 12), Dockerfile (Task 13), dispatch stub with `/health` (Task 8), full verification (Tasks 9 + 14). All in-scope items from the plan description are covered.
- **Out of scope (deferred to later plans):** MCP tools, dispatch REST beyond `/health`, tunnel manager, prod-static server, agent adapters, mobile app, install script, skills, bootstrap-pocketbase.sh, store-api-key.js, welcome page.
- **Type consistency:** `AnyClawPaths`, `KeyPair`, `SealedBox`, `SnapshotManager`, `Version`, `VersionStore`, `Worktree`, `WorktreeManager`, `DeployManager`, `DeployResult`, `ValidateResult`, `createApp` are defined exactly once and used under the same name across tests, implementations, and exports from `packages/shared/src/index.ts`.
- **No placeholders:** every step includes complete code or a concrete command with expected output. No TBD / TODO / "similar to".
