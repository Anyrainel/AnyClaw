import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { createLocalJWKSet } from 'jose';
import { buildAuthUrl, exchangeCode, setGoogleJwks, type GoogleConfig } from '../../src/auth/oauth/google.js';
import { makeRsaKey, jwksJson, signIdToken, type LocalKey } from './oauth-helpers.js';

const cfg: GoogleConfig = {
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret',
  redirectUri: 'https://broker.example/callback/google',
};

describe('oauth/google', () => {
  let key: LocalKey;
  let agent: MockAgent;
  let original: Dispatcher;

  beforeAll(async () => {
    key = await makeRsaKey('google-test-kid');
    const jwks = await jwksJson(key);
    setGoogleJwks(createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]));
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

  it('buildAuthUrl includes pkce and scopes', () => {
    const url = buildAuthUrl(cfg, 'state-abc', 'challenge-xyz');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe(cfg.clientId);
    expect(u.searchParams.get('state')).toBe('state-abc');
    expect(u.searchParams.get('code_challenge')).toBe('challenge-xyz');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toContain('openid');
  });

  it('exchangeCode parses id_token and returns profile', async () => {
    const idToken = await signIdToken(
      key,
      { sub: 'google-sub-1', email: 'alice@example.com', name: 'Alice', picture: 'https://img/1' },
      'https://accounts.google.com',
      cfg.clientId,
    );
    agent
      .get('https://oauth2.googleapis.com')
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, { id_token: idToken, access_token: 'at', token_type: 'Bearer' });

    const profile = await exchangeCode(cfg, 'auth-code', 'verifier');
    expect(profile).toEqual({
      sub: 'google-sub-1',
      email: 'alice@example.com',
      name: 'Alice',
      picture: 'https://img/1',
    });
  });

  it('throws on token exchange failure', async () => {
    agent
      .get('https://oauth2.googleapis.com')
      .intercept({ path: '/token', method: 'POST' })
      .reply(400, { error: 'invalid_grant' });
    await expect(exchangeCode(cfg, 'bad', 'v')).rejects.toThrow(/google token exchange failed/);
  });
});
