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
