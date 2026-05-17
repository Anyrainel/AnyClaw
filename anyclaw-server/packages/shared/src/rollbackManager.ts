import type { VersionStore } from "./versionStore.js";
import type { SnapshotManager } from "./snapshots.js";

export interface RollbackManagerOptions {
  versions: VersionStore;
  snapshots: SnapshotManager;
  restartAppBackendService: () => Promise<void>;
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

    // 4. Restart app backend
    await this.opts.restartAppBackendService();

    return { ok: true };
  }
}
