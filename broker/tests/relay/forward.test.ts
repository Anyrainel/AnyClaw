import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { encodeFrame, decodeFrame, type Envelope } from '../../src/relay/envelope.js';
import { ConnectionMap } from '../../src/relay/connection-map.js';
import { registerServerRelay } from '../../src/relay/server-handler.js';
import { registerClientRelay } from '../../src/relay/client-handler.js';
import { mintAccess, type JwtConfig } from '../../src/auth/jwt.js';
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
/*  Constants                                                         */
/* ------------------------------------------------------------------ */
const USER_ID = '11111111-2222-3333-4444-555555555555';
const SERVER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TOKEN = 'valid-pairing-token-abc123';
const SESSION_ID = 'sess-abc';

const jwtCfg: JwtConfig = {
  secret: 'forward-test-secret-32chars-ok!!',
  accessTtlSeconds: 900,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
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

async function buildApp(db: ReturnType<typeof stubDb>, connMap: ConnectionMap): Promise<FastifyInstance> {
  const app = fastify();
  await app.register(websocket);
  registerServerRelay(app, db, connMap);
  registerClientRelay(app, db, connMap, jwtCfg);
  return app;
}

function baseUrl(app: FastifyInstance): string {
  const addr = app.server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no address');
  return `ws://127.0.0.1:${addr.port}`;
}

function openWs(url: string, opts?: { headers?: Record<string, string> }): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts);
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
/*  Connect a server WS and complete registration. Returns the ws.    */
/* ------------------------------------------------------------------ */
async function connectServer(
  app: FastifyInstance,
  db: ReturnType<typeof stubDb>,
): Promise<WebSocket> {
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
  ]);
  const ws = await openWs(`${baseUrl(app)}/relay/server?token=${TOKEN}`);
  const regPromise = waitForMessage(ws);
  ws.send(makeRegisterFrame());
  await regPromise; // 'registered' frame
  return ws;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */
describe('client relay + forwarding', () => {
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

  it('rejects client with missing auth', async () => {
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(`${baseUrl(app)}/relay/client?server_id=${SERVER_ID}`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4000);
  });

  it('rejects client with invalid JWT', async () => {
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(
      `${baseUrl(app)}/relay/client?server_id=${SERVER_ID}`,
      { headers: { authorization: 'Bearer invalid.jwt.token' } },
    );
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it('rejects client when session is revoked', async () => {
    const jwt = await mintAccess(jwtCfg, USER_ID, SESSION_ID);
    // Script: session lookup returns empty
    db.__script([[]]);
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(
      `${baseUrl(app)}/relay/client?server_id=${SERVER_ID}`,
      { headers: { authorization: `Bearer ${jwt}` } },
    );
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it('rejects client when user does not own server', async () => {
    const jwt = await mintAccess(jwtCfg, USER_ID, SESSION_ID);
    db.__script([
      // session lookup — valid
      [{ id: SESSION_ID }],
      // server ownership — empty
      [],
    ]);
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(
      `${baseUrl(app)}/relay/client?server_id=${SERVER_ID}`,
      { headers: { authorization: `Bearer ${jwt}` } },
    );
    const { code } = await waitForClose(ws);
    expect(code).toBe(4003);
  });

  it('rejects client when server is offline', async () => {
    const jwt = await mintAccess(jwtCfg, USER_ID, SESSION_ID);
    db.__script([
      // session lookup
      [{ id: SESSION_ID }],
      // ownership — valid
      [{ id: SERVER_ID }],
    ]);
    // No server in connMap => offline
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(
      `${baseUrl(app)}/relay/client?server_id=${SERVER_ID}`,
      { headers: { authorization: `Bearer ${jwt}` } },
    );
    const { code } = await waitForClose(ws);
    expect(code).toBe(4004);
  });

  it('sends connection_request to server when client connects', async () => {
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    // Connect server first
    const serverWs = await connectServer(app, db);

    // Now connect client
    const jwt = await mintAccess(jwtCfg, USER_ID, SESSION_ID);
    db.__script([
      // session lookup
      [{ id: SESSION_ID }],
      // ownership
      [{ id: SERVER_ID }],
    ]);

    const connReqPromise = waitForMessage(serverWs);
    const _clientWs = await openWs(
      `${baseUrl(app)}/relay/client?server_id=${SERVER_ID}`,
      { headers: { authorization: `Bearer ${jwt}` } },
    );

    const raw = await connReqPromise;
    const { env } = decodeFrame(raw);
    expect(env.type).toBe('connection_request');
    expect(env.client_id).toMatch(/^c_/);
    expect(env.session_id).toBe(SESSION_ID);

    _clientWs.close();
    serverWs.close();
  });

  it('forwards data frame from client to server', async () => {
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const serverWs = await connectServer(app, db);

    const jwt = await mintAccess(jwtCfg, USER_ID, SESSION_ID);
    db.__script([
      [{ id: SESSION_ID }],
      [{ id: SERVER_ID }],
    ]);

    // Listen for connection_request to capture client_id
    const connReqPromise = waitForMessage(serverWs);
    const clientWs = await openWs(
      `${baseUrl(app)}/relay/client?server_id=${SERVER_ID}`,
      { headers: { authorization: `Bearer ${jwt}` } },
    );
    const connReqRaw = await connReqPromise;
    const { env: connReqEnv } = decodeFrame(connReqRaw);
    const clientId = connReqEnv.client_id;

    // Now send a data frame from client to server
    const dataPayload = Buffer.from('hello from client');
    const clientFrame = encodeFrame(
      { type: 'data', client_id: clientId, stream_id: 1 } as Envelope,
      dataPayload,
    );

    const serverMsgPromise = waitForMessage(serverWs);
    clientWs.send(clientFrame);
    const serverReceived = await serverMsgPromise;

    // The server should get the exact same raw frame
    expect(Buffer.compare(serverReceived, clientFrame)).toBe(0);

    clientWs.close();
    serverWs.close();
  });

  it('forwards data frame from server to client', async () => {
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const serverWs = await connectServer(app, db);

    const jwt = await mintAccess(jwtCfg, USER_ID, SESSION_ID);
    db.__script([
      [{ id: SESSION_ID }],
      [{ id: SERVER_ID }],
    ]);

    const connReqPromise = waitForMessage(serverWs);
    const clientWs = await openWs(
      `${baseUrl(app)}/relay/client?server_id=${SERVER_ID}`,
      { headers: { authorization: `Bearer ${jwt}` } },
    );
    const connReqRaw = await connReqPromise;
    const { env: connReqEnv } = decodeFrame(connReqRaw);
    const clientId = connReqEnv.client_id;

    // Server sends a data frame addressed to the client
    const dataPayload = Buffer.from('hello from server');
    const serverFrame = encodeFrame(
      { type: 'data', client_id: clientId, stream_id: 1 } as Envelope,
      dataPayload,
    );

    const clientMsgPromise = waitForMessage(clientWs);
    serverWs.send(serverFrame);
    const clientReceived = await clientMsgPromise;

    expect(Buffer.compare(clientReceived, serverFrame)).toBe(0);

    clientWs.close();
    serverWs.close();
  });

  it('sends stream_close to server when client disconnects', async () => {
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const serverWs = await connectServer(app, db);

    const jwt = await mintAccess(jwtCfg, USER_ID, SESSION_ID);
    db.__script([
      [{ id: SESSION_ID }],
      [{ id: SERVER_ID }],
    ]);

    const connReqPromise = waitForMessage(serverWs);
    const clientWs = await openWs(
      `${baseUrl(app)}/relay/client?server_id=${SERVER_ID}`,
      { headers: { authorization: `Bearer ${jwt}` } },
    );
    const connReqRaw = await connReqPromise;
    const { env: connReqEnv } = decodeFrame(connReqRaw);
    const clientId = connReqEnv.client_id;

    // Now close the client, expect stream_close to be sent to server
    const streamClosePromise = waitForMessage(serverWs);
    clientWs.close();
    const streamCloseRaw = await streamClosePromise;
    const { env: closeEnv } = decodeFrame(streamCloseRaw);
    expect(closeEnv.type).toBe('stream_close');
    expect(closeEnv.client_id).toBe(clientId);

    // Confirm client removed from connMap
    await new Promise((r) => setTimeout(r, 50));
    expect(connMap.getClient(clientId)).toBeUndefined();

    serverWs.close();
  });

  it('closes client with 4002 on client_id mismatch (anti-spoof)', async () => {
    app = await buildApp(db, connMap);
    await app.listen({ port: 0, host: '127.0.0.1' });

    const serverWs = await connectServer(app, db);

    const jwt = await mintAccess(jwtCfg, USER_ID, SESSION_ID);
    db.__script([
      [{ id: SESSION_ID }],
      [{ id: SERVER_ID }],
    ]);

    const connReqPromise = waitForMessage(serverWs);
    const clientWs = await openWs(
      `${baseUrl(app)}/relay/client?server_id=${SERVER_ID}`,
      { headers: { authorization: `Bearer ${jwt}` } },
    );
    await connReqPromise; // consume connection_request

    // Send a frame with a WRONG client_id
    const spoofFrame = encodeFrame(
      { type: 'data', client_id: 'c_WRONG', stream_id: 1 } as Envelope,
      Buffer.from('spoofed'),
    );

    const closePromise = waitForClose(clientWs);
    clientWs.send(spoofFrame);
    const { code } = await closePromise;
    expect(code).toBe(4002);

    serverWs.close();
  });
});
