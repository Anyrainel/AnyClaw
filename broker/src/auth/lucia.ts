import { Lucia } from 'lucia';
import { NodePostgresAdapter } from '@lucia-auth/adapter-postgresql';
import pg from 'pg';
import type { Config } from '../config.js';

/**
 * Lucia v3 wired against our Postgres `users` + `sessions` tables.
 *
 * Lucia's Postgres adapter only supports node-postgres Pools, so this module
 * owns its own small Pool. The rest of the broker uses postgres.js via
 * src/db/client.ts.
 */
export function createLucia(cfg: Pick<Config, 'databaseUrl'>): Lucia {
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl });
  const adapter = new NodePostgresAdapter(pool, {
    user: 'users',
    session: 'sessions',
  });
  return new Lucia(adapter, {
    sessionExpiresIn: { seconds: 60 * 60 * 24 * 30 } as unknown as import('lucia').TimeSpan,
    sessionCookie: { attributes: { secure: true } },
    getUserAttributes: (u: Record<string, unknown>) => ({
      email: u['email'] as string | null,
      displayName: u['display_name'] as string | null,
    }),
  });
}
