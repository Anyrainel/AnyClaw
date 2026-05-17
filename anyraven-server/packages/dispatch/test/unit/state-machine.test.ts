import { describe, it, expect } from "vitest";
import { transition, TransitionError } from "../../src/lifecycle/state-machine.js";
describe("transition", () => {
  it("queued -> working on scheduler_pick", () => {
    expect(transition("queued", "scheduler_pick")).toBe("working");
  });
  it("working -> clarifying on ask_user", () => {
    expect(transition("working", "ask_user")).toBe("clarifying");
  });
  it("clarifying -> working on answer", () => {
    expect(transition("clarifying", "answer")).toBe("working");
  });
  it("working -> deploying on deploy_called", () => {
    expect(transition("working", "deploy_called")).toBe("deploying");
  });
  it("deploying -> done on validation_pass", () => {
    expect(transition("deploying", "validation_pass")).toBe("done");
  });
  it("any non-terminal -> cancelled on cancel", () => {
    for (const s of ["queued","working","clarifying","deploying"] as const) {
      expect(transition(s, "cancel")).toBe("cancelled");
    }
  });
  it("rejects terminal -> anything", () => {
    expect(() => transition("done", "cancel")).toThrow(TransitionError);
    expect(() => transition("failed", "answer")).toThrow(TransitionError);
  });
  it("rejects nonsense transitions", () => {
    expect(() => transition("queued", "answer")).toThrow(TransitionError);
  });
});
