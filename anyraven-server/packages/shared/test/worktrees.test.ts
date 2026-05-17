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
    const root = mkdtempSync(join(tmpdir(), "anyraven-wt-"));
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
