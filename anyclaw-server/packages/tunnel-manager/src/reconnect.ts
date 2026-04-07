export interface ReconnectOptions {
  brokerUrl: string;
  onAttempt: (attempt: number, delayMs: number) => void;
  maxDelayMs?: number;
  baseDelayMs?: number;
  stopAfter?: number; // test hook
}

/**
 * Plan 1 stub: computes the backoff schedule and invokes onAttempt for each
 * attempt. Plan 4 replaces the body with a real WebSocket connection.
 */
export async function reconnectLoop(opts: ReconnectOptions): Promise<void> {
  const base = opts.baseDelayMs ?? 1000;
  const max  = opts.maxDelayMs  ?? 30000;
  const stopAfter = opts.stopAfter ?? Infinity;

  let attempt = 0;
  while (attempt < stopAfter) {
    attempt++;
    const delay = Math.min(max, base * Math.pow(2, attempt - 1));
    opts.onAttempt(attempt, delay);
    if (attempt >= stopAfter) return;
    await new Promise(r => setTimeout(r, 0)); // yield; no real sleep in stub
  }
}
