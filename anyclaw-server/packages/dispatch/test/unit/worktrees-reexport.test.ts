import { describe, it, expect } from "vitest";
import { WorktreeManager as Local } from "../../src/worktrees.js";
import { WorktreeManager as Shared } from "@anyclaw/shared";
describe("worktrees re-export", () => {
  it("exposes the shared WorktreeManager (same class reference)", () => {
    expect(Local).toBe(Shared);
  });
});
