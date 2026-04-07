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
