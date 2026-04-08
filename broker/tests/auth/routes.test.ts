import { describe, it, expect } from 'vitest';
import fastify from 'fastify';
import { authRoutes } from '../../src/auth/routes.js';
import type { DB } from '../../src/db/client.js';

/**
 * These tests verify the routing shape and validation behavior that does
 * not require a real Postgres instance. Full end-to-end tests covering
 * OAuth → session creation → JWT are deferred until testcontainers are
 * available (same as Task 8 lucia session tests).
 */

// Minimal stub: only the methods our tests hit. Cast to DB for type compat.
function stubDb(): DB {
  const handler = async () => [];
  // postgres template tag is callable with a template strings array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tag = ((..._args: unknown[]) => handler()) as any;
  return tag as DB;
}

async function buildApp() {
  const app = fastify();
  await app.register(authRoutes, {
    db: stubDb(),
    jwtCfg: { secret: 'test-secret-not-prod', accessTtlSeconds: 900 },
    google: {
      clientId: 'gcid',
      clientSecret: 'gcs',
      redirectUri: 'https://broker.example/callback/google',
    },
    apple: {
      clientId: 'com.example.apple',
      teamId: 'TEAM123',
      keyId: 'KEY456',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
      redirectUri: 'https://broker.example/callback/apple',
    },
    github: {
      clientId: 'ghid',
      clientSecret: 'ghs',
      redirectUri: 'https://broker.example/callback/github',
    },
  });
  return app;
}

describe('auth routes (shape + validation)', () => {
  it('rejects unknown provider on /auth/oauth/:provider/start', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/auth/oauth/facebook/start' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'unknown_provider' });
    await app.close();
  });

  it('redirects to google authorization url on /auth/oauth/google/start', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/auth/oauth/google/start' });
    expect(res.statusCode).toBe(302);
    const loc = res.headers['location'] as string;
    expect(loc).toContain('accounts.google.com');
    expect(loc).toContain('client_id=gcid');
    expect(loc).toContain('state=');
    expect(loc).toContain('code_challenge=');
    await app.close();
  });

  it('redirects to github authorization url on /auth/oauth/github/start', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/auth/oauth/github/start' });
    expect(res.statusCode).toBe(302);
    const loc = res.headers['location'] as string;
    expect(loc).toContain('github.com/login/oauth/authorize');
    expect(loc).toContain('client_id=ghid');
    await app.close();
  });

  it('redirects to apple authorization url on /auth/oauth/apple/start', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/auth/oauth/apple/start' });
    expect(res.statusCode).toBe(302);
    const loc = res.headers['location'] as string;
    expect(loc).toContain('appleid.apple.com');
    expect(loc).toContain('client_id=com.example.apple');
    await app.close();
  });

  it('rejects callback with unknown state', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/auth/oauth/google/callback?code=abc&state=unknown',
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_state' });
    await app.close();
  });

  it('rejects /auth/exchange with missing code', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/exchange',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects /auth/exchange with invalid code', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/exchange',
      payload: { code: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_code' });
    await app.close();
  });

  it('rejects /auth/refresh with missing token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects /auth/logout without bearer header', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
