import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { startPg, stopPg, isDockerAvailable } from './helpers/pg.js';
import type { FastifyInstance } from 'fastify';

const canDocker = await isDockerAvailable();

describe.skipIf(!canDocker)('buildApp + /healthz', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const databaseUrl = await startPg();
    const cfg = loadConfig({
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'x'.repeat(43),
      GOOGLE_CLIENT_ID: 'gcid',
      GOOGLE_CLIENT_SECRET: 'gcs',
      GOOGLE_REDIRECT_URI: 'https://broker.example/cb/google',
      APPLE_CLIENT_ID: 'com.example',
      APPLE_TEAM_ID: 'TEAM',
      APPLE_KEY_ID: 'KEY',
      APPLE_PRIVATE_KEY_PEM: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
      APPLE_REDIRECT_URI: 'https://broker.example/cb/apple',
      GITHUB_CLIENT_ID: 'ghid',
      GITHUB_CLIENT_SECRET: 'ghs',
      GITHUB_REDIRECT_URI: 'https://broker.example/cb/github',
      PROVIDER_TOKEN_ENC_KEY: 'k'.repeat(32),
    } as unknown as NodeJS.ProcessEnv);
    app = await buildApp(cfg);
  });

  afterAll(async () => {
    if (app) await app.close();
    await stopPg();
  });

  it('responds 200 with { ok: true } on GET /healthz', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
