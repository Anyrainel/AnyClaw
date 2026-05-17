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
      "anyraven_ask_user",
      "anyraven_create_collection",
      "anyraven_deploy",
      "anyraven_list_versions",
      "anyraven_rollback",
      "anyraven_snapshot_db",
      "anyraven_update_progress",
    ]);
  });
});
