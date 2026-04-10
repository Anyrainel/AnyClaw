export interface RateRule {
  points: number;
  windowMs: number;
}

export class RateLimiter {
  private buckets = new Map<string, number[]>();

  check(key: string, rule: RateRule, now = Date.now()): boolean {
    const windowStart = now - rule.windowMs;
    const arr = this.buckets.get(key) ?? [];
    const fresh = arr.filter(t => t > windowStart);
    if (fresh.length >= rule.points) {
      this.buckets.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.buckets.set(key, fresh);
    return true;
  }

  /** Periodic GC to keep the map bounded. */
  gc(now = Date.now(), maxAgeMs = 60 * 60 * 1000): void {
    for (const [k, arr] of this.buckets) {
      const fresh = arr.filter(t => t > now - maxAgeMs);
      if (fresh.length === 0) this.buckets.delete(k);
      else this.buckets.set(k, fresh);
    }
  }
}

export const RULES = {
  oauthStart:   { points: 20,  windowMs: 60 * 60 * 1000 },
  authExchange: { points: 20,  windowMs: 60 * 60 * 1000 },
  authRefresh:  { points: 60,  windowMs: 60 * 60 * 1000 },
  pairStart:    { points: 10,  windowMs: 60 * 60 * 1000 },
  pairStatus:   { points: 120, windowMs: 5 * 60 * 1000 },
} as const;
