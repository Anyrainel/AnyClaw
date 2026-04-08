import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { buildAuthUrl, exchangeCode, type GithubConfig } from '../../src/auth/oauth/github.js';

const cfg: GithubConfig = {
  clientId: 'gh-id',
  clientSecret: 'gh-secret',
  redirectUri: 'https://broker.example/callback/github',
};

describe('oauth/github', () => {
  let agent: MockAgent;
  let original: Dispatcher;

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

  it('buildAuthUrl contains required scopes', () => {
    const u = new URL(buildAuthUrl(cfg, 'state-1'));
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('scope')).toBe('read:user user:email');
  });

  it('exchangeCode selects primary+verified email', async () => {
    agent
      .get('https://github.com')
      .intercept({ path: '/login/oauth/access_token', method: 'POST' })
      .reply(200, { access_token: 'gh_at_123', token_type: 'bearer', scope: 'read:user,user:email' });
    const api = agent.get('https://api.github.com');
    api.intercept({ path: '/user', method: 'GET' }).reply(200, {
      id: 42,
      name: 'Octo Cat',
      avatar_url: 'https://gh/avatar',
    });
    api.intercept({ path: '/user/emails', method: 'GET' }).reply(200, [
      { email: 'not-primary@example.com', primary: false, verified: true },
      { email: 'unverified@example.com', primary: true, verified: false },
      { email: 'octo@example.com', primary: true, verified: true },
    ]);

    const profile = await exchangeCode(cfg, 'code-1');
    expect(profile).toEqual({
      sub: '42',
      email: 'octo@example.com',
      name: 'Octo Cat',
      avatar: 'https://gh/avatar',
    });
  });

  it('returns null email when no primary+verified exists', async () => {
    agent
      .get('https://github.com')
      .intercept({ path: '/login/oauth/access_token', method: 'POST' })
      .reply(200, { access_token: 'gh_at_456' });
    const api = agent.get('https://api.github.com');
    api.intercept({ path: '/user', method: 'GET' }).reply(200, { id: 7, name: null, avatar_url: null });
    api
      .intercept({ path: '/user/emails', method: 'GET' })
      .reply(200, [{ email: 'x@y.z', primary: true, verified: false }]);

    const profile = await exchangeCode(cfg, 'code-2');
    expect(profile.sub).toBe('7');
    expect(profile.email).toBeNull();
    expect(profile.name).toBeNull();
  });

  it('throws on token exchange failure', async () => {
    agent
      .get('https://github.com')
      .intercept({ path: '/login/oauth/access_token', method: 'POST' })
      .reply(401, {});
    await expect(exchangeCode(cfg, 'bad')).rejects.toThrow(/github token exchange failed/);
  });
});
