import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/client.js';
import type { JwtConfig } from '../auth/jwt.js';
import { authenticate } from '../auth/middleware.js';

const PAIRING_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface PairingRoutesOptions {
  db: DB;
  jwtCfg: JwtConfig;
}

interface ServerRow {
  id: string;
  name: string;
  status: 'online' | 'degraded' | 'offline';
  last_heartbeat: Date | null;
  registered_at: Date;
  connection_mode: string | null;
  public_host: string | null;
  public_api_port: number | null;
  public_app_port: number | null;
  public_pb_port: number | null;
  public_use_tls: boolean | null;
  wg_public_key: string | null;
  wg_endpoint: string | null;
  wg_tunnel_ip: string | null;
  wg_port: number | null;
}

interface ServerTokenRow {
  token: string;
  claimed: boolean;
  server_id: string | null;
}

interface ConnectionInfo {
  server_id: string;
  connection_mode: string;
  public_endpoint?: {
    host: string;
    api_port: number;
    app_port: number;
    pb_port: number;
    use_tls: boolean;
  };
  wireguard?: {
    server_public_key: string;
    endpoint: string | undefined;
    port: number;
    tunnel_ip: string;
  };
}

/**
 * Pairing routes: start, status, list, delete, connection info. All require authentication.
 *
 * /servers/pair/start issues a one-time server pairing token the user pastes
 * into their self-hosted server setup. The server then calls the broker's
 * server-side registration endpoint (Task 12) with this token to complete
 * pairing.
 */
export const pairingRoutes: FastifyPluginAsync<PairingRoutesOptions> = async (
  app: FastifyInstance,
  opts: PairingRoutesOptions,
) => {
  const auth = authenticate({ db: opts.db, jwtCfg: opts.jwtCfg });

  app.post<{ Body: { mobile_pk?: string } }>(
    '/servers/pair/start',
    { preHandler: auth },
    async (req, reply) => {
      const userId = req.auth!.userId;
      const mobilePkB64 = req.body?.mobile_pk;
      if (!mobilePkB64) {
        return reply.code(400).send({ error: 'missing_mobile_pk' });
      }
      let mobilePk: Buffer;
      try {
        mobilePk = Buffer.from(mobilePkB64, 'base64');
        if (mobilePk.length !== 32) {
          return reply.code(400).send({ error: 'invalid_mobile_pk_length' });
        }
      } catch {
        return reply.code(400).send({ error: 'invalid_mobile_pk' });
      }
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + PAIRING_TOKEN_TTL_MS);
      await opts.db`
        INSERT INTO server_tokens (token, user_id, mobile_pk, expires_at)
        VALUES (${token}, ${userId}, ${mobilePk}, ${expiresAt})`;
      return reply.send({
        pairing_token: token,
        expires_at: expiresAt.toISOString(),
      });
    },
  );

  app.post<{ Body: { pairing_token?: string } }>(
    '/servers/pair/status',
    { preHandler: auth },
    async (req, reply) => {
      const userId = req.auth!.userId;
      const token = req.body?.pairing_token;
      if (!token) {
        return reply.code(400).send({ error: 'missing_pairing_token' });
      }
      const rows = await opts.db<ServerTokenRow[]>`
        SELECT token, claimed, server_id FROM server_tokens
        WHERE token = ${token} AND user_id = ${userId} AND expires_at > now()`;
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'token_not_found_or_expired' });
      }
      const row = rows[0]!;
      if (!row.claimed || !row.server_id) {
        return reply.send({ status: 'pending' });
      }
      const serverRows = await opts.db<ServerRow[]>`
        SELECT id, name, status, last_heartbeat, registered_at,
               connection_mode, public_host, public_api_port, public_app_port,
               public_pb_port, public_use_tls, wg_public_key, wg_endpoint,
               wg_tunnel_ip, wg_port
        FROM servers
        WHERE id = ${row.server_id} AND user_id = ${userId}`;
      if (serverRows.length === 0) {
        return reply.code(410).send({ error: 'server_removed' });
      }
      return reply.send({ status: 'paired', server: serverRows[0]! });
    },
  );

  app.get('/servers', { preHandler: auth }, async (req, reply) => {
    const userId = req.auth!.userId;
    const rows = await opts.db<ServerRow[]>`
      SELECT id, name, status, last_heartbeat, registered_at,
             connection_mode, public_host, public_api_port, public_app_port,
             public_pb_port, public_use_tls, wg_public_key, wg_endpoint,
             wg_tunnel_ip, wg_port
      FROM servers
      WHERE user_id = ${userId}
      ORDER BY registered_at DESC`;
    return reply.send({ servers: rows });
  });

  app.delete<{ Params: { id: string } }>(
    '/servers/:id',
    { preHandler: auth },
    async (req, reply) => {
      const userId = req.auth!.userId;
      const { id } = req.params;
      // Basic UUID shape check so stub DB doesn't see garbage.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(400).send({ error: 'invalid_server_id' });
      }
      const result = await opts.db`
        DELETE FROM servers WHERE id = ${id} AND user_id = ${userId}`;
      // postgres lib returns a result with count; when stubbed, just return ok
      void result;
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { id: string } }>('/servers/:id/connection', { preHandler: auth }, async (req, reply) => {
    const userId = req.auth!.userId;
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return reply.code(400).send({ error: 'invalid_server_id' });
    }
    const rows = await opts.db<ServerRow[]>`
      SELECT id, name, status, last_heartbeat, registered_at,
             connection_mode, public_host, public_api_port, public_app_port,
             public_pb_port, public_use_tls, wg_public_key, wg_endpoint,
             wg_tunnel_ip, wg_port
      FROM servers
      WHERE id = ${id} AND user_id = ${userId}`;
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'server_not_found' });
    }
    const s = rows[0]!;
    const info: ConnectionInfo = {
      server_id: s.id,
      connection_mode: s.connection_mode ?? 'broker_relay',
    };
    if (s.public_host) {
      info.public_endpoint = {
        host: s.public_host,
        api_port: s.public_api_port ?? 4100,
        app_port: s.public_app_port ?? 5173,
        pb_port: s.public_pb_port ?? 8090,
        use_tls: s.public_use_tls ?? true,
      };
    }
    if (s.wg_public_key) {
      info.wireguard = {
        server_public_key: s.wg_public_key,
        endpoint: s.wg_endpoint ?? undefined,
        port: s.wg_port ?? 51820,
        tunnel_ip: s.wg_tunnel_ip ?? '10.64.0.1',
      };
    }
    return reply.send(info);
  });
};
