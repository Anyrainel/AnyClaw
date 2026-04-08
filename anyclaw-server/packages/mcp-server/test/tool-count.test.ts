import { describe, it, expect } from "vitest";
import { registerAllTools } from "../src/tools/index.js";

describe("tool count guard", () => {
  it("registers exactly 7 tools", () => {
    const names: string[] = [];
    const fakeServer = {
      registerTool: (name: string) => {
        names.push(name);
      },
    };
    registerAllTools(fakeServer as any, { taskId: "x" });
    expect(names.sort()).toEqual([
      "anyclaw_ask_user",
      "anyclaw_create_collection",
      "anyclaw_deploy",
      "anyclaw_list_versions",
      "anyclaw_rollback",
      "anyclaw_snapshot_db",
      "anyclaw_update_progress",
    ]);
  });
});
