import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const base = {
    BROKER_PORT: '8080',
    BROKER_HOST: '127.0.0.1',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'a'.repeat(43),
    JWT_ACCESS_TTL_SECONDS: '900',
    GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REDIRECT_URI: 'https://b/c',
    APPLE_CLIENT_ID: 'x', APPLE_TEAM_ID: 'x', APPLE_KEY_ID: 'x',
    APPLE_PRIVATE_KEY_PEM: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    APPLE_REDIRECT_URI: 'https://b/c',
    GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'x', GITHUB_REDIRECT_URI: 'https://b/c',
    PROVIDER_TOKEN_ENC_KEY: 'a'.repeat(43),
  };

  it('parses a complete env', () => {
    const c = loadConfig(base);
    expect(c.port).toBe(8080);
    expect(c.jwt.accessTtlSeconds).toBe(900);
  });

  it('throws on missing DATABASE_URL', () => {
    const { DATABASE_URL, ...bad } = base;
    expect(() => loadConfig(bad)).toThrow(/DATABASE_URL/);
  });

  it('rejects short JWT_SECRET', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });
});
