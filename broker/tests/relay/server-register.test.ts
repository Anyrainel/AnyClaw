import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { encodeFrame, decodeFrame, type Envelope } from '../../src/relay/envelope.js';
import { ConnectionMap } from '../../src/relay/connection-map.js';
import { registerServerRelay } from '../../src/relay/server-handler.js';
import type { DB } from '../../src/db/client.js';

/* ------------------------------------------------------------------ */
/*  Scripted stub DB                                                  */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
const USER_ID = '11111111-2222-3333-4444-555555555555';
const TOKEN = 'valid-pairing-token-abc123';
const SERVER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeRegisterFrame(): Buffer {
  return encodeFrame({
    type: 'register',
    client_id: '',
    server_pk: Buffer.alloc(32, 1).toString('base64url'),
    server_name: 'test-server',
    version: '0.1.0',
    capabilities: ['pb'],
  } as Envelope);
}

function makeHeartbeatFrame(): Buffer {
  return encodeFrame({ type: 'heartbeat', client_id: '' } as Envelope);
}

async function buildApp(
  db: ReturnType<typeof stubDb>,
  connMap: ConnectionMap,
): Promise<FastifyInstance> {
  const app = fastify();
  await app.register(websocket);
  registerServerRelay(app, db, connMap);
  return app;
}

function wsUrl(app: FastifyInstance, token: string): string {
  const addr = app.server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no address');
  return `ws://127.0.0.1:${addr.port}/relay/server?token=${token}`;
}

function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<Buffer> {
  return new Promise((resolve) => {
    ws.once('message', (data: Buffer) => resolve(data));
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.on('close', (code: number, reason: Buffer) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */
describe('server relay handler', () => {
  let db: ReturnType<typeof stubDb>;
  let connMap: ConnectionMap;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = stubDb();
    connMap = new ConnectionMap();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('closes with 4000 when no token query param', async () => {
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (typeof addr === 'string' || !addr) throw new Error('no address');
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/relay/server`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4000);
  });

  it('closes with 4003 for invalid token', async () => {
    db.__script([
      // SELECT from server_tokens — empty = not found
      [],
    ]);
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(wsUrl(app, 'bad-token'));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4003);
  });

  it('closes with 4003 for expired token', async () => {
    db.__script([
      // SELECT from server_tokens — expired
      [{
        token: TOKEN,
        user_id: USER_ID,
        mobile_pk: Buffer.alloc(32),
        expires_at: new Date(Date.now() - 60_000),
        claimed: false,
        server_id: null,
      }],
    ]);
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(wsUrl(app, TOKEN));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4003);
  });

  it('registers a new server and returns registered frame', async () => {
    db.__script([
      // SELECT from server_tokens — valid, not yet claimed
      [{
        token: TOKEN,
        user_id: USER_ID,
        mobile_pk: Buffer.alloc(32),
        expires_at: new Date(Date.now() + 300_000),
        claimed: false,
        server_id: null,
      }],
      // INSERT INTO servers RETURNING id
      [{ id: SERVER_ID }],
      // UPDATE server_tokens SET claimed
      [],
    ]);
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const ws = await openWs(wsUrl(app, TOKEN));
    const msgPromise = waitForMessage(ws);
    ws.send(makeRegisterFrame());

    const raw = await msgPromise;
    const { env } = decodeFrame(raw);
    expect(env.type).toBe('registered');
    expect(env.server_id).toBe(SERVER_ID);
    expect(env.heartbeat_interval_ms).toBe(30000);
    expect(connMap.getServer(SERVER_ID)).toBeDefined();
    ws.close();
  });

  it('reconnects an already-claimed server', async () => {
    db.__script([
      // SELECT from server_tokens — already claimed
      [{
        token: TOKEN,
        user_id: USER_ID,
        mobile_pk: Buffer.alloc(32),
        expires_at: new Date(Date.now() + 300_000),
        claimed: true,
        server_id: SERVER_ID,
      }],
      // UPDATE servers SET status = online
      [],
    ]);
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const ws = await openWs(wsUrl(app, TOKEN));
    const msgPromise = waitForMessage(ws);
    ws.send(makeRegisterFrame());

    const raw = await msgPromise;
    const { env } = decodeFrame(raw);
    expect(env.type).toBe('registered');
    expect(env.server_id).toBe(SERVER_ID);
    ws.close();
  });

  it('registers a new server with connection fields', async () => {
    db.__script([
      // SELECT from server_tokens — valid, not yet claimed
      [{
        token: TOKEN,
        user_id: USER_ID,
        mobile_pk: Buffer.alloc(32),
        expires_at: new Date(Date.now() + 300_000),
        claimed: false,
        server_id: null,
      }],
      // INSERT INTO servers RETURNING id
      [{ id: SERVER_ID }],
      // UPDATE server_tokens SET claimed
      [],
    ]);
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const ws = await openWs(wsUrl(app, TOKEN));
    const msgPromise = waitForMessage(ws);

    const registerFrame = encodeFrame({
      type: 'register',
      client_id: '',
      server_pk: Buffer.alloc(32, 1).toString('base64url'),
      server_name: 'test-server',
      version: '0.1.0',
      capabilities: ['pb'],
      connection_mode: 'public_ip',
      public_host: '203.0.113.42',
      public_api_port: 4100,
      public_app_port: 5173,
      public_pb_port: 8090,
      public_use_tls: true,
      wg_public_key: 'wg-pub-key',
      wg_endpoint: '203.0.113.42:51820',
      wg_tunnel_ip: '10.64.0.1',
      wg_port: 51820,
    } as Envelope);
    ws.send(registerFrame);

    const raw = await msgPromise;
    const { env } = decodeFrame(raw);
    expect(env.type).toBe('registered');
    expect(env.server_id).toBe(SERVER_ID);
    expect(connMap.getServer(SERVER_ID)).toBeDefined();
    ws.close();
  });

  it('handles heartbeat with connection field updates', async () => {
    db.__script([
      // SELECT from server_tokens
      [{
        token: TOKEN,
        user_id: USER_ID,
        mobile_pk: Buffer.alloc(32),
        expires_at: new Date(Date.now() + 300_000),
        claimed: false,
        server_id: null,
      }],
      // INSERT INTO servers
      [{ id: SERVER_ID }],
      // UPDATE server_tokens
      [],
      // UPDATE servers (heartbeat with connection fields)
      [],
    ]);
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const ws = await openWs(wsUrl(app, TOKEN));

    // Register first
    const regPromise = waitForMessage(ws);
    ws.send(makeRegisterFrame());
    await regPromise;

    // Now send heartbeat with connection updates
    const hbPromise = waitForMessage(ws);
    const hbFrame = encodeFrame({
      type: 'heartbeat',
      client_id: '',
      connection_mode: 'wireguard',
      wg_public_key: 'new-wg-key',
      wg_endpoint: '198.51.100.1:51820',
    } as Envelope);
    ws.send(hbFrame);

    const raw = await hbPromise;
    const { env } = decodeFrame(raw);
    expect(env.type).toBe('heartbeat_ack');
    expect(env.timestamp).toBeDefined();
    ws.close();
  });

  it('handles heartbeat and returns heartbeat_ack', async () => {
    db.__script([
      // SELECT from server_tokens
      [{
        token: TOKEN,
        user_id: USER_ID,
        mobile_pk: Buffer.alloc(32),
        expires_at: new Date(Date.now() + 300_000),
        claimed: false,
        server_id: null,
      }],
      // INSERT INTO servers
      [{ id: SERVER_ID }],
      // UPDATE server_tokens
      [],
      // UPDATE servers (heartbeat)
      [],
    ]);
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const ws = await openWs(wsUrl(app, TOKEN));

    // Register first
    const regPromise = waitForMessage(ws);
    ws.send(makeRegisterFrame());
    await regPromise;

    // Now send heartbeat
    const hbPromise = waitForMessage(ws);
    ws.send(makeHeartbeatFrame());

    const raw = await hbPromise;
    const { env } = decodeFrame(raw);
    expect(env.type).toBe('heartbeat_ack');
    expect(env.timestamp).toBeDefined();
    ws.close();
  });

  it('sets server offline and removes from connMap on close', async () => {
    db.__script([
      [{
        token: TOKEN,
        user_id: USER_ID,
        mobile_pk: Buffer.alloc(32),
        expires_at: new Date(Date.now() + 300_000),
        claimed: false,
        server_id: null,
      }],
      [{ id: SERVER_ID }],
      [],
      // UPDATE servers SET status = offline (on close)
      [],
    ]);
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const ws = await openWs(wsUrl(app, TOKEN));
    const regPromise = waitForMessage(ws);
    ws.send(makeRegisterFrame());
    await regPromise;

    expect(connMap.getServer(SERVER_ID)).toBeDefined();

    // Close and wait for cleanup
    const closePromise = waitForClose(ws);
    ws.close();
    await closePromise;

    // Give the server-side close handler a moment to run
    await new Promise((r) => setTimeout(r, 100));
    expect(connMap.getServer(SERVER_ID)).toBeUndefined();
  });
});
