import { describe, it, expect } from "vitest";
import { AnyClawPaths } from "../src/paths.js";

describe("AnyClawPaths", () => {
  it("derives all known paths from a data root", () => {
    const p = new AnyClawPaths("/tmp/anyclaw-data");
    expect(p.dataRoot).toBe("/tmp/anyclaw-data");
    expect(p.pocketbase).toBe("/tmp/anyclaw-data/pocketbase");
    expect(p.pocketbaseData).toBe("/tmp/anyclaw-data/pocketbase/pb_data");
    expect(p.dev).toBe("/tmp/anyclaw-data/dev");
    expect(p.devWorktrees).toBe("/tmp/anyclaw-data/dev/.worktrees");
    expect(p.prod).toBe("/tmp/anyclaw-data/prod");
    expect(p.prodFrontend).toBe("/tmp/anyclaw-data/prod/frontend-build");
    expect(p.prodLogic).toBe("/tmp/anyclaw-data/prod/logic-build");
    expect(p.snapshots).toBe("/tmp/anyclaw-data/snapshots");
    expect(p.secrets).toBe("/tmp/anyclaw-data/.anyclaw");
    expect(p.secretsLogs).toBe("/tmp/anyclaw-data/.anyclaw/logs");
  });

  it("provides worktree path for a task id", () => {
    const p = new AnyClawPaths("/data");
    expect(p.worktreeFor("task-abc")).toBe("/data/dev/.worktrees/task-abc");
  });

  it("provides snapshot path for an ISO timestamp", () => {
    const p = new AnyClawPaths("/data");
    expect(p.snapshotFile("2026-04-06T12-00-00Z")).toBe(
      "/data/snapshots/2026-04-06T12-00-00Z.sqlite.gz",
    );
  });
});
