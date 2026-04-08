import { describe, it, expect } from 'vitest';
import { mintAccess, verifyAccess } from '../../src/auth/jwt.js';

const cfg = { secret: 'a'.repeat(43), accessTtlSeconds: 900 };

describe('jwt', () => {
  it('mints and verifies', async () => {
    const tok = await mintAccess(cfg, 'user-1', 'sess-1');
    const { sub, sid } = await verifyAccess(cfg, tok);
    expect(sub).toBe('user-1');
    expect(sid).toBe('sess-1');
  });

  it('rejects tampered tokens', async () => {
    const tok = await mintAccess(cfg, 'u', 's');
    const bad = tok.slice(0, -4) + 'xxxx';
    await expect(verifyAccess(cfg, bad)).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    const tok = await mintAccess({ ...cfg, accessTtlSeconds: -1 }, 'u', 's');
    await expect(verifyAccess(cfg, tok)).rejects.toThrow();
  });

  it('rejects wrong secret', async () => {
    const tok = await mintAccess(cfg, 'u', 's');
    await expect(verifyAccess({ ...cfg, secret: 'b'.repeat(43) }, tok)).rejects.toThrow();
  });
});
