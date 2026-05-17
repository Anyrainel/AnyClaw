import type { DispatchConfig } from "../adapters/types.js";

export interface ClarificationResult {
  source: "user" | "timeout";
  answer: string;
}

interface PocketBaseLike {
  collection(name: string): {
    subscribe(
      id: string,
      cb: (data: {
        action: string;
        record: Record<string, unknown>;
      }) => void,
    ): (() => void) | Promise<() => void>;
  };
}

const BEST_JUDGMENT_FALLBACK =
  "No user response received. Use your best judgment to proceed.";

/**
 * Wait for a clarification answer, racing a realtime subscription
 * against a configurable timeout.
 *
 * - "best_judgment": after `timeoutMs` resolves with a fallback answer.
 * - "pause_indefinitely": ignores timeout, waits until answer arrives.
 */
export async function waitForAnswer(
  pb: PocketBaseLike,
  clarificationId: string,
  timeoutMs: number,
  mode: DispatchConfig["clarificationTimeoutMode"],
): Promise<ClarificationResult> {
  return new Promise<ClarificationResult>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let settled = false;

    const settle = (result: ClarificationResult) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe?.();
      resolve(result);
    };

    // Subscribe to realtime updates on _task_clarifications
    const unsub = pb.collection("_task_clarifications").subscribe(
      clarificationId,
      (data) => {
        const record = data.record;
        if (
          record.clarificationId === clarificationId &&
          record.status === "answered"
        ) {
          settle({ source: "user", answer: String(record.answer ?? "") });
        }
      },
    );

    // Handle both sync and async unsubscribe
    if (typeof unsub === "function") {
      unsubscribe = unsub;
    } else if (unsub && typeof (unsub as Promise<() => void>).then === "function") {
      void (unsub as Promise<() => void>).then((fn) => {
        unsubscribe = fn;
        // If already settled before async unsub resolved, clean up
        if (settled) fn();
      });
    }

    // Set timeout only for best_judgment mode
    if (mode === "best_judgment") {
      timer = setTimeout(() => {
        settle({ source: "timeout", answer: BEST_JUDGMENT_FALLBACK });
      }, timeoutMs);
    }
  });
}
