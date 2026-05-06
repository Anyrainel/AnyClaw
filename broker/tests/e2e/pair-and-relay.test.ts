import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { startPg, stopPg, isDockerAvailable } from '../helpers/pg.js';
import {
  initNacl,
  generateKeypair,
  box,
  unbox,
  deriveShared,
} from '../../src/crypto/nacl.js';
import { deriveBip39Code } from '../../src/crypto/bip39.js';
import { encodeFrame, decodeFrame, type Envelope } from '../../src/relay/envelope.js';
import { mintAccess } from '../../src/auth/jwt.js';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../../src/db/client.js';

const JWT_SECRET = 'x'.repeat(43);
const jwtCfg = { secret: JWT_SECRET, accessTtlSeconds: 900 };

const canDocker = await isDockerAvailable();

describe.skipIf(!canDocker).skip('e2e: pair then relay a NaCl frame', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let db: DB;

  beforeAll(async () => {
    const databaseUrl = await startPg();
    await initNacl();
    const cfg = loadConfig({
      DATABASE_URL: databaseUrl,
      JWT_SECRET,
      GOOGLE_CLIENT_ID: 'gcid',
      GOOGLE_CLIENT_SECRET: 'gcs',
      GOOGLE_REDIRECT_URI: 'https://broker.example/cb/google',
      APPLE_CLIENT_ID: 'com.example',
      APPLE_TEAM_ID: 'TEAM',
      APPLE_KEY_ID: 'KEY',
      APPLE_PRIVATE_KEY_PEM:
        '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
      APPLE_REDIRECT_URI: 'https://broker.example/cb/apple',
      GITHUB_CLIENT_ID: 'ghid',
      GITHUB_CLIENT_SECRET: 'ghs',
      GITHUB_REDIRECT_URI: 'https://broker.example/cb/github',
      PROVIDER_TOKEN_ENC_KEY: 'k'.repeat(32),
    } as unknown as NodeJS.ProcessEnv);

    app = await buildApp(cfg);
    db = (app as unknown as { db: DB }).db;
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    await stopPg();
  });

  it('completes the full pair-and-relay flow', { timeout: 30000 }, async () => {
    // ----- Seed a user + session bypassing OAuth (unit-tested separately). -----
    const [user] = await db`
      INSERT INTO users (email, display_name)
      VALUES ('e2e@test', 'E2E')
      RETURNING id`;
    const userId = user!.id as string;

    const sessionId = 'sess_e2e_' + Date.now();
    const refresh = 'refresh_e2e_' + Date.now();
    await db`
      INSERT INTO sessions (id, user_id, refresh_token, expires_at)
      VALUES (${sessionId}, ${userId}, ${refresh}, now() + interval '30 days')`;

    const jwt = await mintAccess(jwtCfg, userId, sessionId);

    // ----- 1. Mobile generates keypair, starts pair. -----
    const mobile = generateKeypair();
    const startRes = await fetch(`${baseUrl}/servers/pair/start`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mobile_pk: Buffer.from(mobile.pk).toString('base64'),
      }),
    });
    expect(startRes.status).toBe(200);
    const { pairing_token } = (await startRes.json()) as {
      pairing_token: string;
    };
    expect(pairing_token).toBeTruthy();

    // ----- 2. Simulated host generates keypair, opens /relay/server?token=... -----
    const server = generateKeypair();
    const wsUrl = `${baseUrl.replace('http', 'ws')}/relay/server?token=${pairing_token}`;
    const hostWs = new WebSocket(wsUrl);
    let hostOpen = false;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('host WS open timeout')), 5000);
      hostWs.once('open', () => { clearTimeout(timer); hostOpen = true; resolve(); });
      hostWs.once('error', (err) => { clearTimeout(timer); reject(err); });
    });

    // Send register frame.
    hostWs.send(
      encodeFrame({
        type: 'register',
        client_id: '',
        server_pk: Buffer.from(server.pk).toString('base64url'),
        server_name: 'e2e-host',
        version: '0.1.0',
        capabilities: ['pocketbase'],
      } as Envelope),
    );

    const registeredRaw = await new Promise<Buffer>((resolve) =>
      hostWs.once('message', (d) => resolve(Buffer.from(d as ArrayBuffer))),
    );
    const regEnv = decodeFrame(registeredRaw).env;
    expect(regEnv.type).toBe('registered');
    const serverIdAssigned = regEnv.server_id as string;
    expect(serverIdAssigned).toBeTruthy();

    // Small delay to ensure server registration is fully committed.
    await new Promise((r) => setTimeout(r, 100));

    // ----- 3. Both sides derive BIP39 code and confirm they match. -----
    const sharedMobile = deriveShared(mobile.sk, server.pk);
    const sharedHost = deriveShared(server.sk, mobile.pk);
    expect(Buffer.from(sharedMobile).equals(Buffer.from(sharedHost))).toBe(
      true,
    );
    expect(deriveBip39Code(sharedMobile)).toBe(deriveBip39Code(sharedHost));

    // ----- 4. Mobile opens /relay/client with JWT + server_id. -----
    const clientWs = new WebSocket(
      `${baseUrl.replace('http', 'ws')}/relay/client?server_id=${serverIdAssigned}`,
      { headers: { authorization: `Bearer ${jwt}` } },
    );
    let clientOpen = false;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('client WS open timeout')), 5000);
      clientWs.once('open', () => { clearTimeout(timer); clientOpen = true; resolve(); });
      clientWs.once('error', (err) => { clearTimeout(timer); reject(err); });
    });

    // Host receives connection_request with the assigned client_id.
    const connReqRaw = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('host connReq timeout')), 5000);
      const onMsg = (d: any) => { clearTimeout(timer); hostWs.off('message', onMsg); resolve(Buffer.from(d as ArrayBuffer)); };
      hostWs.on('message', onMsg);
      hostWs.once('error', (err) => { clearTimeout(timer); reject(err); });
      hostWs.once('close', () => { clearTimeout(timer); reject(new Error('host WS closed before connReq')); });
    });
    const connReq = decodeFrame(connReqRaw).env;
    expect(connReq.type).toBe('connection_request');
    const clientId = connReq.client_id;
    expect(clientId).toBeTruthy();

    // ----- 5. Client sends a NaCl-encrypted data frame to the server. -----
    const plaintext = Buffer.from('hello from mobile');
    const { nonce, ciphertext } = box(plaintext, server.pk, mobile.sk);
    const payload = Buffer.concat([
      Buffer.from(nonce),
      Buffer.from(ciphertext),
    ]);
    clientWs.send(
      encodeFrame(
        {
          type: 'data',
          client_id: clientId,
          service: 'pb',
          stream_id: 1,
          flags: 0,
        } as Envelope,
        payload,
      ),
    );

    // ----- 6. Host receives and decrypts the frame. -----
    const hostFrameRaw = await new Promise<Buffer>((resolve) =>
      hostWs.once('message', (d) => resolve(Buffer.from(d as ArrayBuffer))),
    );
    const { env: hostEnv, payload: hostPayload } = decodeFrame(hostFrameRaw);
    expect(hostEnv.client_id).toBe(clientId);
    expect(hostEnv.service).toBe('pb');
    const recvNonce = hostPayload.subarray(0, 24);
    const recvCt = hostPayload.subarray(24);
    const decrypted = unbox(recvCt, recvNonce, mobile.pk, server.sk);
    expect(Buffer.from(decrypted).toString()).toBe('hello from mobile');

    // ----- 7. Server sends a data frame back to the client. -----
    const replyPlain = Buffer.from('hello from server');
    const replyBox = box(replyPlain, mobile.pk, server.sk);
    const replyPayload = Buffer.concat([
      Buffer.from(replyBox.nonce),
      Buffer.from(replyBox.ciphertext),
    ]);
    hostWs.send(
      encodeFrame(
        {
          type: 'data',
          client_id: clientId,
          service: 'pb',
          stream_id: 1,
          flags: 0,
        } as Envelope,
        replyPayload,
      ),
    );

    // ----- 8. Client receives and decrypts the reply. -----
    const clientFrameRaw = await new Promise<Buffer>((resolve) =>
      clientWs.once('message', (d) => resolve(Buffer.from(d as ArrayBuffer))),
    );
    const { payload: clientPayload } = decodeFrame(clientFrameRaw);
    const clientNonce = clientPayload.subarray(0, 24);
    const clientCt = clientPayload.subarray(24);
    const clientDecrypted = unbox(clientCt, clientNonce, server.pk, mobile.sk);
    expect(Buffer.from(clientDecrypted).toString()).toBe('hello from server');

    // ----- 9. DB assertions: server_pk stored, no private key columns. -----
    const dbServer = await db`
      SELECT server_pk FROM servers WHERE id = ${serverIdAssigned}`;
    expect(dbServer.length).toBe(1);
    // server_pk is stored (as bytea).
    expect(Buffer.from(dbServer[0]!.server_pk as Buffer).length).toBe(32);

    // No columns named *sk* exist in public schema — broker never stores private keys.
    const anySkColumn = await db`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name ILIKE '%_sk'`;
    expect(anySkColumn).toEqual([]);

    // ----- Cleanup -----
    hostWs.close();
    clientWs.close();
    // Give WebSockets a moment to close gracefully.
    await new Promise((r) => setTimeout(r, 100));
  });
});
