import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccess, type JwtConfig } from './jwt.js';
import { findSessionById } from './session.js';
import type { DB } from '../db/client.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export interface AuthenticateOptions {
  db: DB;
  jwtCfg: JwtConfig;
}

/**
 * Fastify preHandler that validates the bearer token and attaches
 * req.auth = { userId, sessionId }. Returns 401 on any validation failure.
 */
export function authenticate(opts: AuthenticateOptions) {
  return async function preHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'missing_bearer' });
      return;
    }
    const token = header.slice(7);
    let claims: { sub: string; sid: string };
    try {
      claims = await verifyAccess(opts.jwtCfg, token);
    } catch {
      reply.code(401).send({ error: 'invalid_token' });
      return;
    }
    const session = await findSessionById(opts.db, claims.sid);
    if (!session) {
      reply.code(401).send({ error: 'session_expired' });
      return;
    }
    req.auth = { userId: claims.sub, sessionId: claims.sid };
  };
}
