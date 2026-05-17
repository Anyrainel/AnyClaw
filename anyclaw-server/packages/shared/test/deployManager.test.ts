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
      restartAppBackendService: async () => { restartCalls++; },
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
      prodSubdir: "app-frontend",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version.tag).toBe("v1");
      expect(result.snapshotId).toBe("2026-04-06T12-00-00Z");
    }
    expect(existsSync(join(snapDir, "2026-04-06T12-00-00Z.sqlite.gz"))).toBe(true);
    expect(readFileSync(join(prodDir, "app-frontend", "index.html"), "utf8")).toBe("<html>v1</html>");
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
      prodSubdir: "app-frontend",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("typecheck");
    expect(restartCalls).toBe(0);
    expect(existsSync(join(prodDir, "app-frontend"))).toBe(false);
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
      prodSubdir: "app-frontend",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshotId).toBeUndefined();
    const snaps = await sn.list();
    expect(snaps.length).toBe(0);
  });
});
