import { describe, it, expect, vi, afterEach } from "vitest";
import {
  waitForAnswer,
  type ClarificationResult,
} from "../../src/lifecycle/clarification.js";

/**
 * Fake PocketBase-like object that supports collection().subscribe()
 * for realtime updates on _task_clarifications.
 */
function makeFakePbRealtime() {
  let subscribeCb: ((data: { action: string; record: Record<string, unknown> }) => void) | null = null;
  return {
    collection(name: string) {
      if (name !== "_task_clarifications") {
        throw new Error(`unexpected collection: ${name}`);
      }
      return {
        subscribe(
          id: string,
          cb: (data: { action: string; record: Record<string, unknown> }) => void,
        ) {
          void id;
          subscribeCb = cb;
          return () => {
            subscribeCb = null;
          };
        },
      };
    },
    /** Simulate a realtime update arriving */
    simulateUpdate(record: Record<string, unknown>) {
      subscribeCb?.({ action: "update", record });
    },
  };
}

describe("waitForAnswer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("best_judgment resolves with fallback answer after timeout", async () => {
    const pb = makeFakePbRealtime();
    const result = await waitForAnswer(
      pb as any,
      "cl-1",
      50, // 50ms timeout
      "best_judgment",
    );
    expect(result.source).toBe("timeout");
    expect(result.answer).toBe(
      "No user response received. Use your best judgment to proceed.",
    );
  });

  it("pause_indefinitely waits until answer arrives (no timeout)", async () => {
    const pb = makeFakePbRealtime();
    // Start waiting — should not resolve until we push an update
    const promise = waitForAnswer(
      pb as any,
      "cl-2",
      50, // timeout value is ignored in pause_indefinitely
      "pause_indefinitely",
    );

    // Simulate answer arriving after a short delay
    setTimeout(() => {
      pb.simulateUpdate({
        clarificationId: "cl-2",
        status: "answered",
        answer: "42",
      });
    }, 20);

    const result = await promise;
    expect(result.source).toBe("user");
    expect(result.answer).toBe("42");
  });

  it("answer arriving before timeout resolves with actual answer", async () => {
    const pb = makeFakePbRealtime();
    const promise = waitForAnswer(
      pb as any,
      "cl-3",
      5000, // long timeout
      "best_judgment",
    );

    // Answer arrives quickly
    setTimeout(() => {
      pb.simulateUpdate({
        clarificationId: "cl-3",
        status: "answered",
        answer: "blue",
      });
    }, 10);

    const result = await promise;
    expect(result.source).toBe("user");
    expect(result.answer).toBe("blue");
  });

  it("ignores updates for different clarificationId", async () => {
    const pb = makeFakePbRealtime();
    const promise = waitForAnswer(
      pb as any,
      "cl-4",
      100,
      "best_judgment",
    );

    // Send update for a different clarification — should be ignored
    setTimeout(() => {
      pb.simulateUpdate({
        clarificationId: "cl-OTHER",
        status: "answered",
        answer: "wrong",
      });
    }, 10);

    const result = await promise;
    // Should timeout because the update was for a different ID
    expect(result.source).toBe("timeout");
  });
});
