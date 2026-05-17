import { describe, it, expect, vi } from "vitest";
import { makeSnapshotDbHandler, snapshotDbInput } from "../src/tools/snapshot-db.js";

describe("anyraven_snapshot_db", () => {
  it("calls snapshotManager.create with label and returns structured content", async () => {
    const snap = { snapshotId: "s1", sizeBytes: 123, path: "/tmp/s1.gz" };
    const mgr = { create: vi.fn().mockResolvedValue(snap) };
    const h = makeSnapshotDbHandler(() => mgr as any);
    const out = await h({ label: "manual-before-migration" });
    expect(mgr.create).toHaveBeenCalledWith("manual-before-migration");
    expect(out.structuredContent).toEqual(snap);
  });
  it("rejects label shorter than 3 chars", () => {
    expect(() => snapshotDbInput.parse({ label: "ab" })).toThrow();
  });
  it("returns isError when snapshot fails", async () => {
    const mgr = { create: vi.fn().mockRejectedValue(new Error("disk full")) };
    const h = makeSnapshotDbHandler(() => mgr as any);
    const out = await h({ label: "xyz" });
    expect(out.isError).toBe(true);
  });
});
