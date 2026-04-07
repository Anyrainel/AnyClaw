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
