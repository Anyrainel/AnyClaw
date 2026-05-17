import path from "node:path";

export class AnyRavenPaths {
  constructor(public readonly dataRoot: string) {}

  get pocketbase() { return path.posix.join(this.dataRoot, "pocketbase"); }
  get pocketbaseData() { return path.posix.join(this.pocketbase, "pb_data"); }
  get dev() { return path.posix.join(this.dataRoot, "dev"); }
  get devWorktrees() { return path.posix.join(this.dev, ".worktrees"); }
  get prod() { return path.posix.join(this.dataRoot, "prod"); }
  get prodAppFrontend() { return path.posix.join(this.prod, "app-frontend"); }
  get prodAppBackend() { return path.posix.join(this.prod, "app-backend"); }
  get snapshots() { return path.posix.join(this.dataRoot, "snapshots"); }
  get secrets() { return path.posix.join(this.dataRoot, ".anyraven"); }
  get secretsLogs() { return path.posix.join(this.secrets, "logs"); }

  worktreeFor(taskId: string): string {
    return path.posix.join(this.devWorktrees, taskId);
  }

  snapshotFile(isoStamp: string): string {
    return path.posix.join(this.snapshots, `${isoStamp}.sqlite.gz`);
  }
}
