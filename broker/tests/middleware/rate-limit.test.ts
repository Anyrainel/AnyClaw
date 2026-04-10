import { describe, it, expect } from 'vitest';
import { RateLimiter, RULES, type RateRule } from '../../src/middleware/rate-limit.js';

describe('RateLimiter', () => {
  const rule: RateRule = { points: 3, windowMs: 10_000 };

  it('allows requests within the limit', () => {
    const limiter = new RateLimiter();
    const now = 1_000_000;
    expect(limiter.check('ip1', rule, now)).toBe(true);
    expect(limiter.check('ip1', rule, now + 1)).toBe(true);
    expect(limiter.check('ip1', rule, now + 2)).toBe(true);
  });

  it('rejects after exceeding the limit', () => {
    const limiter = new RateLimiter();
    const now = 1_000_000;
    expect(limiter.check('ip1', rule, now)).toBe(true);
    expect(limiter.check('ip1', rule, now + 1)).toBe(true);
    expect(limiter.check('ip1', rule, now + 2)).toBe(true);
    // 4th request should be rejected
    expect(limiter.check('ip1', rule, now + 3)).toBe(false);
  });

  it('sliding window recovers after time passes', () => {
    const limiter = new RateLimiter();
    const now = 1_000_000;
    // Exhaust the limit
    expect(limiter.check('ip1', rule, now)).toBe(true);
    expect(limiter.check('ip1', rule, now + 1000)).toBe(true);
    expect(limiter.check('ip1', rule, now + 2000)).toBe(true);
    expect(limiter.check('ip1', rule, now + 3000)).toBe(false);

    // After the first request slides out of the window (10s), a new slot opens
    expect(limiter.check('ip1', rule, now + 10_001)).toBe(true);
    // But the second and third are still inside the window
    expect(limiter.check('ip1', rule, now + 10_002)).toBe(false);
  });

  it('isolates keys from each other', () => {
    const limiter = new RateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) limiter.check('ip1', rule, now + i);
    expect(limiter.check('ip1', rule, now + 3)).toBe(false);
    // Different key should still have full budget
    expect(limiter.check('ip2', rule, now + 3)).toBe(true);
  });

  it('gc removes expired entries', () => {
    const limiter = new RateLimiter();
    const now = 1_000_000;
    limiter.check('ip1', rule, now);
    limiter.check('ip2', rule, now);

    // GC with maxAgeMs=5000 at now+20000 should clear both
    limiter.gc(now + 20_000, 5000);

    // Entries should be gone; keys get full budget again
    expect(limiter.check('ip1', rule, now + 20_001)).toBe(true);
    expect(limiter.check('ip2', rule, now + 20_001)).toBe(true);
  });

  it('gc keeps recent entries', () => {
    const limiter = new RateLimiter();
    const now = 1_000_000;
    limiter.check('ip1', rule, now);
    limiter.check('ip1', rule, now + 1);
    limiter.check('ip1', rule, now + 2);

    // GC at now+5000 with maxAge 10000 — entries are still fresh
    limiter.gc(now + 5000, 10_000);

    // Should still be at limit
    expect(limiter.check('ip1', rule, now + 5001)).toBe(false);
  });

  it('exports sensible default RULES', () => {
    expect(RULES.oauthStart.points).toBeGreaterThan(0);
    expect(RULES.oauthStart.windowMs).toBeGreaterThan(0);
    expect(RULES.pairStart.points).toBe(10);
    expect(RULES.pairStatus.points).toBe(120);
  });
});
