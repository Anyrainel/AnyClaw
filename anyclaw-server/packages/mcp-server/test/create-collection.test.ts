import { describe, it, expect, vi } from "vitest";
import { makeCreateCollectionHandler } from "../src/tools/create-collection.js";

const baseInput = {
  name: "mood_entries",
  type: "base" as const,
  fields: [
    { name: "score", type: "number" as const, required: true },
    { name: "note",  type: "text"   as const, required: false },
  ],
};

describe("anyclaw_create_collection", () => {
  it("snapshots then creates and returns structured content", async () => {
    const snap = { snapshotId: "snap-1", sizeBytes: 1, path: "/x" };
    const snapMgr = { create: vi.fn().mockResolvedValue(snap) };
    const pbCreate = vi.fn().mockResolvedValue({ id: "col-1" });
    const pb = { collections: { create: pbCreate } };
    const h = makeCreateCollectionHandler(() => snapMgr as any, () => pb as any);
    const out = await h(baseInput);
    expect(snapMgr.create).toHaveBeenCalledTimes(1);
    expect(pbCreate).toHaveBeenCalledTimes(1);
    expect(out.structuredContent).toEqual({
      collectionId: "col-1",
      collectionName: "mood_entries",
      fieldsCreated: 2,
      snapshotId: "snap-1",
    });
  });
  it("rejects reserved names starting with _", async () => {
    const snapMgr = { create: vi.fn() };
    const pb = { collections: { create: vi.fn() } };
    const h = makeCreateCollectionHandler(() => snapMgr as any, () => pb as any);
    const out = await h({ ...baseInput, name: "_foo" });
    expect(out.isError).toBe(true);
    expect(snapMgr.create).not.toHaveBeenCalled();
  });
  it("surfaces PocketBase errors after snapshot", async () => {
    const snapMgr = { create: vi.fn().mockResolvedValue({ snapshotId: "s", sizeBytes: 0, path: "" }) };
    const pb = { collections: { create: vi.fn().mockRejectedValue(new Error("duplicate")) } };
    const h = makeCreateCollectionHandler(() => snapMgr as any, () => pb as any);
    const out = await h(baseInput);
    expect(out.isError).toBe(true);
  });
});
