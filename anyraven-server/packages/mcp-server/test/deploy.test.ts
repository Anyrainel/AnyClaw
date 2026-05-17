import { describe, it, expect, vi } from "vitest";
import { makeDeployHandler, deployInput } from "../src/tools/deploy.js";

const happy = {
  version: "v1.0.1",
  gitCommit: "abc123",
  gitTag: "v1.0.1",
  dbSnapshotId: "snap-1",
  validationResults: { lint: true, typecheck: true, build: true, smokeTests: true },
};

describe("anyraven_deploy", () => {
  it("delegates to DeployManager.run and returns structured content", async () => {
    const mgr = { run: vi.fn().mockResolvedValue(happy) };
    const h = makeDeployHandler(() => mgr as any);
    const out = await h(
      { versionDescription: "adds mood tracking feature", skipDbSnapshot: false },
      { taskId: "t1" },
    );
    expect(mgr.run).toHaveBeenCalledWith({
      taskId: "t1",
      versionDescription: "adds mood tracking feature",
      skipDbSnapshot: false,
    });
    expect(out.structuredContent).toEqual(happy);
    expect(out.isError).toBeUndefined();
  });
  it("rejects short version descriptions (schema)", () => {
    expect(() => deployInput.parse({ versionDescription: "short" })).toThrow();
  });
  it("returns isError when deploy fails validation", async () => {
    const mgr = { run: vi.fn().mockRejectedValue(new Error("lint failed:\n...")) };
    const h = makeDeployHandler(() => mgr as any);
    const out = await h(
      { versionDescription: "ten chars..", skipDbSnapshot: false },
      { taskId: "t1" },
    );
    expect(out.isError).toBe(true);
    expect((out.content[0] as any).text).toContain("lint failed");
  });
});
