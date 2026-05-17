import { describe, it, expect } from "vitest";
import { AdapterError, isTerminal } from "../../src/adapters/types.js";
describe("TaskState terminal detection", () => {
  it("treats done/failed/cancelled as terminal", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });
  it("treats queued/working/clarifying/deploying as non-terminal", () => {
    for (const s of ["queued","working","clarifying","deploying"] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });
  it("AdapterError preserves code and retryable flag", () => {
    const e = new AdapterError("nope", "AGENT_UNREACHABLE", true);
    expect(e.code).toBe("AGENT_UNREACHABLE");
    expect(e.retryable).toBe(true);
  });
});
