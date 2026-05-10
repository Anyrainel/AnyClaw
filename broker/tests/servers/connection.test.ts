import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { pairingRoutes } from '../../src/servers/pairing.js';
import { mintAccess, type JwtConfig } from '../../src/auth/jwt.js';
import type { DB } from '../../src/db/client.js';

const jwtCfg: JwtConfig = {
  secret: 'pairing-test-secret',
  accessTtlSeconds: 900,
};

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

  it('GET /servers/:id/connection returns 400 for invalid UUID', async () => {
    db.__script([
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/servers/not-a-uuid/connection',
      headers: { authorization: await makeAuthHeader() },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_server_id' });
    await app.close();
  });

  it('GET /servers/:id/connection returns 404 for unknown server', async () => {
    db.__script([
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
      [],
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/servers/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/connection',
      headers: { authorization: await makeAuthHeader() },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'server_not_found' });
    await app.close();
  });

  it('GET /servers/:id/connection returns public_ip info', async () => {
    db.__script([
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
      [{
        id: '11111111-2222-3333-4444-555555555551',
        name: 'home',
        status: 'online',
        last_heartbeat: new Date(),
        registered_at: new Date(),
        connection_mode: 'public_ip',
        public_host: '203.0.113.42',
        public_api_port: 4100,
        public_app_port: 5173,
        public_pb_port: 8090,
        public_use_tls: true,
        wg_public_key: null,
        wg_endpoint: null,
        wg_tunnel_ip: null,
        wg_port: null,
      }],
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/servers/11111111-2222-3333-4444-555555555551/connection',
      headers: { authorization: await makeAuthHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.server_id).toBe('11111111-2222-3333-4444-555555555551');
    expect(body.connection_mode).toBe('public_ip');
    expect(body.public_endpoint).toEqual({
      host: '203.0.113.42',
      api_port: 4100,
      app_port: 5173,
      pb_port: 8090,
      use_tls: true,
    });
    expect(body.wireguard).toBeUndefined();
    await app.close();
  });

  it('GET /servers/:id/connection returns wireguard info', async () => {
    db.__script([
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
      [{
        id: '22222222-3333-4444-5555-666666666666',
        name: 'pi',
        status: 'online',
        last_heartbeat: new Date(),
        registered_at: new Date(),
        connection_mode: 'wireguard',
        public_host: null,
        public_api_port: null,
        public_app_port: null,
        public_pb_port: null,
        public_use_tls: null,
        wg_public_key: 'ABC123wgPubKey',
        wg_endpoint: '192.168.1.100:51820',
        wg_tunnel_ip: '10.64.0.1',
        wg_port: 51820,
      }],
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/servers/22222222-3333-4444-5555-666666666666/connection',
      headers: { authorization: await makeAuthHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.server_id).toBe('22222222-3333-4444-5555-666666666666');
    expect(body.connection_mode).toBe('wireguard');
    expect(body.wireguard).toEqual({
      server_public_key: 'ABC123wgPubKey',
      endpoint: '192.168.1.100:51820',
      port: 51820,
      tunnel_ip: '10.64.0.1',
    });
    expect(body.public_endpoint).toBeUndefined();
    await app.close();
  });

  it('GET /servers/:id/connection returns both public and wireguard info', async () => {
    db.__script([
      [{ id: 'sess-abc', user_id: '11111111-2222-3333-4444-555555555555', refresh_token: 'r', expires_at: new Date(Date.now() + 1000 * 60) }],
      [{
        id: '33333333-4444-5555-6666-777777777777',
        name: 'vps',
        status: 'online',
        last_heartbeat: new Date(),
        registered_at: new Date(),
        connection_mode: 'public_tunnel',
        public_host: 'myserver.cloudflare.io',
        public_api_port: 4100,
        public_app_port: 5173,
        public_pb_port: 8090,
        public_use_tls: true,
        wg_public_key: 'DEF456wgPubKey',
        wg_endpoint: null,
        wg_tunnel_ip: '10.64.0.1',
        wg_port: 51820,
      }],
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/servers/33333333-4444-5555-6666-777777777777/connection',
      headers: { authorization: await makeAuthHeader() },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.connection_mode).toBe('public_tunnel');
    expect(body.public_endpoint).toBeDefined();
    expect(body.wireguard).toBeDefined();
    await app.close();
  });
});
