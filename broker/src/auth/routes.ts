import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/client.js';
import {
  buildAuthUrl as googleAuthUrl,
  exchangeCode as googleExchange,
  type GoogleConfig,
  type GoogleProfile,
} from './oauth/google.js';
import {
  buildAuthUrl as appleAuthUrl,
  exchangeCode as appleExchange,
  type AppleConfig,
  type AppleProfile,
} from './oauth/apple.js';
import {
  buildAuthUrl as githubAuthUrl,
  exchangeCode as githubExchange,
  type GithubConfig,
  type GithubProfile,
} from './oauth/github.js';
import { newVerifier, challengeFor } from './oauth/pkce.js';
import { mintAccess, type JwtConfig } from './jwt.js';
import {
  createSession,
  findSessionById,
  findSessionByRefresh,
  touchSession,
  revokeSession,
  newOpaque,
} from './session.js';

/** In-memory state store for the authorization flow. 5-minute TTL. */
interface StateEntry {
  verifier: string;
  provider: 'google' | 'apple' | 'github';
  expiresAt: number;
}

/** In-memory one-time exchange-code store. 60-second TTL. */
interface ExchangeEntry {
  userId: string;
  sessionId: string;
  refreshToken: string;
  expiresAt: number;
}

const STATE_TTL_MS = 5 * 60 * 1000;
const EXCHANGE_TTL_MS = 60 * 1000;

export interface AuthRoutesOptions {
  db: DB;
  jwtCfg: JwtConfig;
  google: GoogleConfig;
  apple: AppleConfig;
  github: GithubConfig;
  /** Deep-link scheme for the mobile app. Default: 'anyraven://auth/success'. */
  mobileRedirect?: string;
}

type NormalizedProfile = {
  sub: string;
  email: string | null;
  name: string | null;
};

function normalizeGoogle(p: GoogleProfile): NormalizedProfile {
  return { sub: p.sub, email: p.email, name: p.name };
}
function normalizeGithub(p: GithubProfile): NormalizedProfile {
  return { sub: p.sub, email: p.email, name: p.name };
}
function normalizeApple(p: AppleProfile, nameFromCallback: string | null): NormalizedProfile {
  return { sub: p.sub, email: p.email ?? null, name: nameFromCallback };
}

async function upsertUser(
  db: DB,
  provider: 'google' | 'apple' | 'github',
  profile: NormalizedProfile,
): Promise<{ id: string; isNewLink: boolean }> {
  const existing = await db<Array<{ user_id: string }>>`
    SELECT user_id FROM oauth_accounts
    WHERE provider = ${provider} AND provider_user_id = ${profile.sub}`;
  if (existing.length > 0) {
    const userId = existing[0]!.user_id;
    await db`UPDATE users SET last_login_at = now() WHERE id = ${userId}`;
    return { id: userId, isNewLink: false };
  }
  let userId: string;
  if (profile.email) {
    const byEmail = await db<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${profile.email}`;
    if (byEmail.length > 0) {
      userId = byEmail[0]!.id;
    } else {
      const rows = await db<Array<{ id: string }>>`
        INSERT INTO users (email, display_name) VALUES (${profile.email}, ${profile.name})
        RETURNING id`;
      userId = rows[0]!.id;
    }
  } else {
    const rows = await db<Array<{ id: string }>>`
      INSERT INTO users (display_name) VALUES (${profile.name})
      RETURNING id`;
    userId = rows[0]!.id;
  }
  await db`
    INSERT INTO oauth_accounts (provider, provider_user_id, user_id)
    VALUES (${provider}, ${profile.sub}, ${userId})
    ON CONFLICT DO NOTHING`;
  return { id: userId, isNewLink: true };
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app: FastifyInstance,
  opts: AuthRoutesOptions,
) => {
  const states = new Map<string, StateEntry>();
  const exchanges = new Map<string, ExchangeEntry>();
  const mobileRedirect = opts.mobileRedirect ?? 'anyraven://auth/success';

  function purgeExpired(): void {
    const now = Date.now();
    for (const [k, v] of states) if (v.expiresAt < now) states.delete(k);
    for (const [k, v] of exchanges) if (v.expiresAt < now) exchanges.delete(k);
  }

  app.get<{ Params: { provider: string } }>('/auth/oauth/:provider/start', async (req, reply) => {
    purgeExpired();
    const provider = req.params.provider;
    if (provider !== 'google' && provider !== 'apple' && provider !== 'github') {
      return reply.code(404).send({ error: 'unknown_provider' });
    }
    const state = randomBytes(16).toString('base64url');
    const verifier = newVerifier();
    states.set(state, { verifier, provider, expiresAt: Date.now() + STATE_TTL_MS });

    let url: string;
    if (provider === 'google') {
      url = googleAuthUrl(opts.google, state, challengeFor(verifier));
    } else if (provider === 'apple') {
      url = appleAuthUrl(opts.apple, state);
    } else {
      url = githubAuthUrl(opts.github, state);
    }
    return reply.code(302).header('location', url).send();
  });

  async function handleCallback(
    req: FastifyRequest,
    reply: FastifyReply,
    provider: 'google' | 'apple' | 'github',
    code: string,
    state: string,
    appleName: string | null = null,
  ): Promise<FastifyReply> {
    purgeExpired();
    const entry = states.get(state);
    if (!entry || entry.provider !== provider) {
      return reply.code(400).send({ error: 'invalid_state' });
    }
    states.delete(state);

    let profile: NormalizedProfile;
    if (provider === 'google') {
      profile = normalizeGoogle(await googleExchange(opts.google, code, entry.verifier));
    } else if (provider === 'apple') {
      const p = await appleExchange(opts.apple, code, appleName);
      profile = normalizeApple(p, appleName);
    } else {
      profile = normalizeGithub(await githubExchange(opts.github, code));
    }

    const { id: userId, isNewLink } = await upsertUser(opts.db, provider, profile);

    // Apple first-login: only persist name from the callback if it's the first link.
    if (provider === 'apple' && isNewLink && appleName) {
      await opts.db`UPDATE users SET display_name = ${appleName} WHERE id = ${userId} AND display_name IS NULL`;
    }

    const session = await createSession(opts.db, userId, {
      ip: req.ip ?? null,
    });
    const oneTime = newOpaque(16);
    exchanges.set(oneTime, {
      userId,
      sessionId: session.id,
      refreshToken: session.refresh_token,
      expiresAt: Date.now() + EXCHANGE_TTL_MS,
    });
    return reply
      .code(302)
      .header('location', `${mobileRedirect}#code=${encodeURIComponent(oneTime)}`)
      .send();
  }

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>(
    '/auth/oauth/:provider/callback',
    async (req, reply) => {
      const provider = req.params.provider;
      if (provider !== 'google' && provider !== 'github') {
        return reply.code(404).send({ error: 'unknown_provider' });
      }
      const { code, state } = req.query;
      if (!code || !state) return reply.code(400).send({ error: 'missing_code_or_state' });
      return handleCallback(req, reply, provider, code, state);
    },
  );

  app.post<{ Body: { code?: string; state?: string; user?: string } }>(
    '/auth/oauth/apple/callback',
    async (req, reply) => {
      const { code, state, user } = req.body ?? {};
      if (!code || !state) return reply.code(400).send({ error: 'missing_code_or_state' });
      let appleName: string | null = null;
      if (user) {
        try {
          const parsed = JSON.parse(user) as { name?: { firstName?: string; lastName?: string } };
          const first = parsed.name?.firstName ?? '';
          const last = parsed.name?.lastName ?? '';
          appleName = [first, last].filter(Boolean).join(' ') || null;
        } catch {
          appleName = null;
        }
      }
      return handleCallback(req, reply, 'apple', code, state, appleName);
    },
  );

  app.post<{ Body: { code?: string } }>('/auth/exchange', async (req, reply) => {
    purgeExpired();
    const code = req.body?.code;
    if (!code) return reply.code(400).send({ error: 'missing_code' });
    const entry = exchanges.get(code);
    if (!entry) return reply.code(400).send({ error: 'invalid_code' });
    exchanges.delete(code);
    const access = await mintAccess(opts.jwtCfg, entry.userId, entry.sessionId);
    return reply.send({
      access_token: access,
      refresh_token: entry.refreshToken,
      access_token_expires_in: opts.jwtCfg.accessTtlSeconds,
    });
  });

  app.post<{ Body: { refresh_token?: string } }>('/auth/refresh', async (req, reply) => {
    const refresh = req.body?.refresh_token;
    if (!refresh) return reply.code(400).send({ error: 'missing_refresh_token' });
    const session = await findSessionByRefresh(opts.db, refresh);
    if (!session) return reply.code(401).send({ error: 'invalid_refresh_token' });
    await touchSession(opts.db, session.id);
    const access = await mintAccess(opts.jwtCfg, session.user_id, session.id);
    return reply.send({
      access_token: access,
      access_token_expires_in: opts.jwtCfg.accessTtlSeconds,
    });
  });

  app.post('/auth/logout', async (req, reply) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'missing_bearer' });
    }
    const token = auth.slice(7);
    // Best effort: decode the session ID from the access token and revoke it.
    try {
      const { verifyAccess } = await import('./jwt.js');
      const { sid } = await verifyAccess(opts.jwtCfg, token);
      const existing = await findSessionById(opts.db, sid);
      if (existing) await revokeSession(opts.db, existing.id);
    } catch {
      // Invalid token — treat as already logged out.
    }
    return reply.send({ ok: true });
  });
};
