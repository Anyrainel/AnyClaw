import { describe, it, expect, vi } from "vitest";
import { makeAskUserHandler } from "../src/tools/ask-user.js";

function fakePb() {
  const subs: any[] = [];
  return {
    subs,
    collection: () => ({
      create: vi.fn().mockResolvedValue({ id: "q1" }),
      subscribe: vi.fn().mockImplementation((_t: any, cb: any, _opts: any) => {
        subs.push(cb);
        return Promise.resolve(() => {
          /* unsub */
        });
      }),
      unsubscribe: vi.fn(),
    }),
  };
}

describe("anyclaw_ask_user", () => {
  it("resolves with the answer record when a matching answer arrives", async () => {
    const pb = fakePb();
    const h = makeAskUserHandler(() => pb as any);
    const p = h(
      { question: "Daily?", options: ["Daily", "MTD"], timeoutMs: 5000 },
      { taskId: "t1" },
    );
    await new Promise((r) => setImmediate(r));
    pb.subs[0]({
      action: "create",
      record: {
        direction: "user_to_agent",
        type: "answer",
        questionId: "q1",
        content: "Daily",
        answeredAt: "2026-04-06T00:00:00Z",
      },
    });
    const out = await p;
    expect(out.isError).toBeUndefined();
    expect((out.structuredContent as any).answer).toBe("Daily");
    expect((out.structuredContent as any).timedOut).toBe(false);
  });

  it("returns isError on timeout", async () => {
    vi.useFakeTimers();
    const pb = fakePb();
    const h = makeAskUserHandler(() => pb as any);
    const p = h({ question: "Q", timeoutMs: 1000 }, { taskId: "t1" });
    await vi.advanceTimersByTimeAsync(1001);
    const out = await p;
    vi.useRealTimers();
    expect(out.isError).toBe(true);
    expect((out.content[0] as any).text).toContain("timed out");
  });

  it("ignores answers for other questions", async () => {
    const pb = fakePb();
    const h = makeAskUserHandler(() => pb as any);
    const p = h({ question: "Q", timeoutMs: 5000 }, { taskId: "t1" });
    await new Promise((r) => setImmediate(r));
    pb.subs[0]({
      action: "create",
      record: {
        direction: "user_to_agent",
        type: "answer",
        questionId: "other",
        content: "x",
      },
    });
    pb.subs[0]({
      action: "create",
      record: {
        direction: "user_to_agent",
        type: "answer",
        questionId: "q1",
        content: "yes",
        answeredAt: "z",
      },
    });
    const out = await p;
    expect((out.structuredContent as any).answer).toBe("yes");
  });
});
