import { describe, it, expect } from "vitest";
import { AnyRavenPaths } from "../src/paths.js";

describe("AnyRavenPaths", () => {
  it("derives all known paths from a data root", () => {
    const p = new AnyRavenPaths("/tmp/anyraven-data");
    expect(p.dataRoot).toBe("/tmp/anyraven-data");
    expect(p.pocketbase).toBe("/tmp/anyraven-data/pocketbase");
    expect(p.pocketbaseData).toBe("/tmp/anyraven-data/pocketbase/pb_data");
    expect(p.dev).toBe("/tmp/anyraven-data/dev");
    expect(p.devWorktrees).toBe("/tmp/anyraven-data/dev/.worktrees");
    expect(p.prod).toBe("/tmp/anyraven-data/prod");
    expect(p.prodAppFrontend).toBe("/tmp/anyraven-data/prod/app-frontend");
    expect(p.prodAppBackend).toBe("/tmp/anyraven-data/prod/app-backend");
    expect(p.snapshots).toBe("/tmp/anyraven-data/snapshots");
    expect(p.secrets).toBe("/tmp/anyraven-data/.anyraven");
    expect(p.secretsLogs).toBe("/tmp/anyraven-data/.anyraven/logs");
  });

  it("provides worktree path for a task id", () => {
    const p = new AnyRavenPaths("/data");
    expect(p.worktreeFor("task-abc")).toBe("/data/dev/.worktrees/task-abc");
  });

  it("provides snapshot path for an ISO timestamp", () => {
    const p = new AnyRavenPaths("/data");
    expect(p.snapshotFile("2026-04-06T12-00-00Z")).toBe(
      "/data/snapshots/2026-04-06T12-00-00Z.sqlite.gz",
    );
  });
});
