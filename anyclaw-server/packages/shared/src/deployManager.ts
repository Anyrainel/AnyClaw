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
