import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import { createDb, type DB } from './db/client.js';
import { initNacl } from './crypto/nacl.js';
import { ConnectionMap } from './relay/connection-map.js';
import { authRoutes } from './auth/routes.js';
import { pairingRoutes } from './servers/pairing.js';
import { registerServerRelay } from './relay/server-handler.js';
import { registerClientRelay } from './relay/client-handler.js';
import { RateLimiter } from './middleware/rate-limit.js';

export async function buildApp(cfg: Config) {
  await initNacl();
  const app = Fastify({ logger: { level: cfg.logLevel } });
  const db = createDb(cfg);
  const connMap = new ConnectionMap();
  const limiter = new RateLimiter();

  // Periodic GC for rate-limiter buckets (every 10 minutes).
  const gcInterval = setInterval(() => limiter.gc(), 10 * 60 * 1000);
  gcInterval.unref();

  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

  app.get('/healthz', async () => ({ ok: true }));

  await app.register(authRoutes, {
    db,
    jwtCfg: cfg.jwt,
    google: cfg.oauth.google,
    apple: cfg.oauth.apple,
    github: cfg.oauth.github,
  });

  await app.register(pairingRoutes, { db, jwtCfg: cfg.jwt });

  registerServerRelay(app, db, connMap);
  registerClientRelay(app, db, connMap, cfg.jwt);

  // Expose db on the instance for e2e tests (non-public).
  (app as unknown as { db: DB }).db = db;

  app.addHook('onClose', async () => {
    clearInterval(gcInterval);
    await db.end();
  });

  return app;
}
