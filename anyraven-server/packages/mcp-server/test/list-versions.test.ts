import { describe, it, expect, vi } from "vitest";
import { makeListVersionsHandler } from "../src/tools/list-versions.js";

const rows = [
  { version: "v1.0.1", description: "fix",   created: "2026-04-05T00:00:00Z", gitCommit: "aaa", dbSnapshotId: "s1" },
  { version: "v1.0.0", description: "init",  created: "2026-04-04T00:00:00Z", gitCommit: "bbb", dbSnapshotId: null },
];

describe("anyraven_list_versions", () => {
  it("returns mapped rows", async () => {
    const getList = vi.fn().mockResolvedValue({ items: rows });
    const pb = { collection: () => ({ getList }) };
    const h = makeListVersionsHandler(() => pb as any);
    const out = await h({ limit: 10 });
    expect(getList).toHaveBeenCalledWith(1, 10, { sort: "-created" });
    expect((out.structuredContent as any).versions).toHaveLength(2);
    expect((out.structuredContent as any).versions[0].version).toBe("v1.0.1");
    expect((out.structuredContent as any).versions[1].dbSnapshotId).toBeNull();
  });
  it("defaults limit to 10 via schema parse", async () => {
    const parsed = (await import("../src/tools/list-versions.js")).listVersionsInput.parse({});
    expect(parsed.limit).toBe(10);
  });
  it("rejects limit > 100", async () => {
    const mod = await import("../src/tools/list-versions.js");
    expect(() => mod.listVersionsInput.parse({ limit: 500 })).toThrow();
  });
});
