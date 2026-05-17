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
      restartAppBackendService: async () => { restartCalls++; },
    });

    // Create two versions
    writeFileSync(join(repoDir, "f.txt"), "one");
    await vs.commitVersion({ description: "v1", files: ["f.txt"] });
    writeFileSync(join(repoDir, "f.txt"), "two");
    await vs.commitVersion({ description: "v2", files: ["f.txt"] });
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("rolls back to a prior version tag and restarts the app backend", async () => {
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
