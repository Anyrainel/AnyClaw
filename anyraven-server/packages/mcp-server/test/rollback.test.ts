import { describe, it, expect, vi } from "vitest";
import { makeRollbackHandler } from "../src/tools/rollback.js";

describe("anyraven_rollback", () => {
  it("delegates to RollbackManager.run", async () => {
    const mgr = {
      run: vi.fn().mockResolvedValue({
        rolledBackTo: "v1.0.0",
        safetySnapshotId: "snap-2",
        gitCommit: "abc",
      }),
    };
    const h = makeRollbackHandler(() => mgr as any);
    const out = await h({ version: "v1.0.0" });
    expect(mgr.run).toHaveBeenCalledWith("v1.0.0");
    expect((out.structuredContent as any).rolledBackTo).toBe("v1.0.0");
  });
  it("surfaces unknown version as isError", async () => {
    const mgr = { run: vi.fn().mockRejectedValue(new Error("Unknown version")) };
    const h = makeRollbackHandler(() => mgr as any);
    const out = await h({ version: "v9.9.9" });
    expect(out.isError).toBe(true);
  });
});
