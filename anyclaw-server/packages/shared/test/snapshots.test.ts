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
