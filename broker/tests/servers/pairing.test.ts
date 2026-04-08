import { describe, it, expect, beforeEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { pairingRoutes } from '../../src/servers/pairing.js';
import { mintAccess, type JwtConfig } from '../../src/auth/jwt.js';
import type { DB } from '../../src/db/client.js';

const jwtCfg: JwtConfig = {
  secret: 'pairing-test-secret',
  accessTtlSeconds: 900,
};

/**
 * Stub DB that returns canned rows based on a simple script. Each call
 * returns the next scripted row. Used for route-shape tests only.
 *
 * The test provides the script via `db.__script(rows)` before each inject.
 */
function stubDb(): DB & { __script(rows: unknown[][]): void } {
  let script: unknown[][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tag = ((..._args: unknown[]) => {
    const next = script.shift() ?? [];
    return Promise.resolve(next);
  }) as any;
  tag.__script = (rows: unknown[][]) => {
    script = rows;
  };
  return tag as DB & { __script(rows: unknown[][]): void };
}

async function buildApp(db: ReturnType<typeof stubDb>): Promise<FastifyInstance> {
  const app = fastify();
  // Middleware needs session lookup to return a row — script that too.
  await app.register(pairingRoutes, { db, jwtCfg });
  return app;
}

async function makeAuthHeader(
  userId = '11111111-2222-3333-4444-555555555555',
  sessionId = 'sess-abc',
): Promise<string> {
  const token = await mintAccess(jwtCfg, userId, sessionId);
  return `Bearer ${token}`;
}

const DUMMY_MOBILE_PK = Buffer.alloc(32, 7).toString('base64');

describe('pairing routes', () => {
  let db: ReturnType<typeof stubDb>;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = stubDb();
    app = await buildApp(db);
  });

  it('rejects unauthenticated /servers/pair/start', async () => {
    // The authenticate middleware needs no script — the token is missing so
    // it short-circuits before touching the DB.
    const res = await app.inject({ method: 'POST', url: '/servers/pair/start', payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects /servers/pair/start without mobile_pk', async () => {
    // Script the session lookup the middleware performs, then the pairing
    // handler rejects before any DB write.
    db.__script([
      // findSessionById result
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/servers/pair/start',
      headers: { authorization: await makeAuthHeader() },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'missing_mobile_pk' });
    await app.close();
  });

  it('issues a pairing token on /servers/pair/start', async () => {
    db.__script([
      // session lookup
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
      // INSERT INTO server_tokens — postgres lib returns undefined, stub returns []
      [],
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/servers/pair/start',
      headers: { authorization: await makeAuthHeader() },
      payload: { mobile_pk: DUMMY_MOBILE_PK },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { pairing_token: string; expires_at: string };
    expect(body.pairing_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
    await app.close();
  });

  it('returns "pending" from /servers/pair/status when token not yet claimed', async () => {
    db.__script([
      // session lookup
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
      // token lookup
      [{ token: 'tok', claimed: false, server_id: null }],
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/servers/pair/status',
      headers: { authorization: await makeAuthHeader() },
      payload: { pairing_token: 'tok' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'pending' });
    await app.close();
  });

  it('returns 404 from /servers/pair/status for unknown token', async () => {
    db.__script([
      // session lookup
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
      // token lookup empty
      [],
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/servers/pair/status',
      headers: { authorization: await makeAuthHeader() },
      payload: { pairing_token: 'nope' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /servers returns an array', async () => {
    db.__script([
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
      [
        { id: 'srv-1', name: 'home', status: 'online', last_heartbeat: new Date(), registered_at: new Date() },
        { id: 'srv-2', name: 'office', status: 'offline', last_heartbeat: null, registered_at: new Date() },
      ],
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/servers',
      headers: { authorization: await makeAuthHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { servers: unknown[] };
    expect(body.servers).toHaveLength(2);
    await app.close();
  });

  it('DELETE /servers/:id rejects non-UUID ids', async () => {
    db.__script([
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
    ]);
    const res = await app.inject({
      method: 'DELETE',
      url: '/servers/not-a-uuid',
      headers: { authorization: await makeAuthHeader() },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_server_id' });
    await app.close();
  });

  it('DELETE /servers/:id accepts a valid UUID', async () => {
    db.__script([
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
      [],
    ]);
    const res = await app.inject({
      method: 'DELETE',
      url: '/servers/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      headers: { authorization: await makeAuthHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    await app.close();
  });
});
