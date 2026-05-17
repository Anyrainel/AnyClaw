import { describe, it, expect, vi } from "vitest";
import { makeUpdateProgressHandler } from "../src/tools/update-progress.js";

describe("anyraven_update_progress", () => {
  it("writes progress record and returns delivered=true", async () => {
    const create = vi.fn().mockResolvedValue({ id: "rec1" });
    const pb = { collection: () => ({ create }) };
    const h = makeUpdateProgressHandler(() => pb as any);
    const out = await h({ message: "step 1", phase: "working", percent: 25 }, { taskId: "t1" });
    expect(out.isError).toBeUndefined();
    expect(create).toHaveBeenCalledWith({
      taskId: "t1",
      direction: "agent_to_user",
      type: "progress",
      content: "step 1",
      phase: "working",
      percent: 25,
    });
    expect(out.structuredContent).toEqual({ delivered: true });
  });
  it("returns isError when PB throws", async () => {
    const pb = { collection: () => ({ create: vi.fn().mockRejectedValue(new Error("offline")) }) };
    const h = makeUpdateProgressHandler(() => pb as any);
    const out = await h({ message: "x", phase: "working" }, { taskId: "t1" });
    expect(out.isError).toBe(true);
  });
});
