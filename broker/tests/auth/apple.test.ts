import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { createLocalJWKSet } from 'jose';
import {
  buildAuthUrl,
  exchangeCode,
  signClientSecret,
  setAppleJwks,
  type AppleConfig,
} from '../../src/auth/oauth/apple.js';
import { makeEcKey, makeApplePkcs8, jwksJson, signIdToken, type LocalKey } from './oauth-helpers.js';

describe('oauth/apple', () => {
  let cfg: AppleConfig;
  let appleIdKey: LocalKey;
  let agent: MockAgent;
  let original: Dispatcher;

  beforeAll(async () => {
    const { pem } = await makeApplePkcs8();
    cfg = {
      clientId: 'com.example.anyclaw',
      teamId: 'TEAM1234',
      keyId: 'KEYABCD',
      privateKeyPem: pem,
      redirectUri: 'https://broker.example/callback/apple',
    };
    appleIdKey = await makeEcKey('apple-idtoken-kid');
    const jwks = await jwksJson(appleIdKey);
    setAppleJwks(createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]));
  });

  beforeEach(() => {
    original = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });
  afterEach(async () => {
    await agent.close();
    setGlobalDispatcher(original);
  });

  it('buildAuthUrl uses form_post response_mode', () => {
    const u = new URL(buildAuthUrl(cfg, 'state-1'));
    expect(u.searchParams.get('response_mode')).toBe('form_post');
    expect(u.searchParams.get('scope')).toBe('name email');
  });

  it('signClientSecret returns an ES256 JWT', async () => {
    const jwt = await signClientSecret(cfg);
    expect(jwt.split('.').length).toBe(3);
    const header = JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString('utf8')) as {
      alg: string;
      kid: string;
    };
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe(cfg.keyId);
  });

  it('returns nameFromCallback on first login and null thereafter', async () => {
    const idToken1 = await signIdToken(
      appleIdKey,
      { sub: 'apple-sub-1', email: 'alice@privaterelay.appleid.com' },
      'https://appleid.apple.com',
      cfg.clientId,
    );
    agent
      .get('https://appleid.apple.com')
      .intercept({ path: '/auth/token', method: 'POST' })
      .reply(200, { id_token: idToken1, access_token: 'at1' });

    const userJson = JSON.stringify({ name: { firstName: 'Jane', lastName: 'Doe' } });
    const round1 = await exchangeCode(cfg, 'code-1', userJson);
    expect(round1.sub).toBe('apple-sub-1');
    expect(round1.email).toBe('alice@privaterelay.appleid.com');
    expect(round1.nameFromCallback).toBe('Jane Doe');

    const idToken2 = await signIdToken(
      appleIdKey,
      { sub: 'apple-sub-1', email: 'alice@privaterelay.appleid.com' },
      'https://appleid.apple.com',
      cfg.clientId,
    );
    agent
      .get('https://appleid.apple.com')
      .intercept({ path: '/auth/token', method: 'POST' })
      .reply(200, { id_token: idToken2, access_token: 'at2' });

    const round2 = await exchangeCode(cfg, 'code-2', null);
    expect(round2.sub).toBe('apple-sub-1');
    expect(round2.nameFromCallback).toBeNull();
  });

  it('tolerates malformed user form field', async () => {
    const idToken = await signIdToken(
      appleIdKey,
      { sub: 'apple-sub-2', email: 'bob@example.com' },
      'https://appleid.apple.com',
      cfg.clientId,
    );
    agent
      .get('https://appleid.apple.com')
      .intercept({ path: '/auth/token', method: 'POST' })
      .reply(200, { id_token: idToken });
    const profile = await exchangeCode(cfg, 'c', '{not valid json');
    expect(profile.nameFromCallback).toBeNull();
  });
});
