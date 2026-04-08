import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { startPg, stopPg, resetPg, isDockerAvailable } from '../helpers/pg.js';
import {
  createSession,
  findSessionById,
  findSessionByRefresh,
  touchSession,
  revokeSession,
  newOpaque,
} from '../../src/auth/session.js';
import type { DB } from '../../src/db/client.js';

const dockerOk = await isDockerAvailable();
const d = dockerOk ? describe : describe.skip;

d('auth/session', () => {
  let url: string;
  let sql: DB;
  let userId: string;

  beforeAll(async () => {
    url = await startPg();
    sql = postgres(url, { max: 2 }) as unknown as DB;
  });
  afterAll(async () => {
    await (sql as unknown as { end: () => Promise<void> }).end();
    await stopPg();
  });
  beforeEach(async () => {
    await resetPg();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name)
      VALUES (${'u@example.com'}, ${'User'})
      RETURNING id`;
    userId = rows[0]!.id;
  });

  it('newOpaque returns base64url of requested length', () => {
    const s = newOpaque(16);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThanOrEqual(20);
  });

  it('create → find by id + by refresh → touch → revoke', async () => {
    const created = await createSession(sql, userId, {
      deviceName: 'iPhone',
      deviceOs: 'iOS 18',
      ip: '10.0.0.1',
    });
    expect(created.id).toBeTruthy();
    expect(created.refresh_token).toBeTruthy();
    expect(created.user_id).toBe(userId);
    expect(created.expires_at.getTime()).toBeGreaterThan(Date.now());

    const byId = await findSessionById(sql, created.id);
    expect(byId?.id).toBe(created.id);

    const byRefresh = await findSessionByRefresh(sql, created.refresh_token);
    expect(byRefresh?.id).toBe(created.id);

    const beforeExp = byId!.expires_at.getTime();
    // Ensure touch bumps expires_at monotonically.
    await new Promise((r) => setTimeout(r, 20));
    await touchSession(sql, created.id);
    const touched = await findSessionById(sql, created.id);
    expect(touched!.expires_at.getTime()).toBeGreaterThanOrEqual(beforeExp);

    await revokeSession(sql, created.id);
    const gone = await findSessionById(sql, created.id);
    expect(gone).toBeNull();
  });

  it('findSessionByRefresh returns null for unknown token', async () => {
    const missing = await findSessionByRefresh(sql, 'no-such-token');
    expect(missing).toBeNull();
  });
});
