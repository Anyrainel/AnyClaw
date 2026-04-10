import type { FastifyInstance } from 'fastify';
import { encodeFrame, decodeFrame, type Envelope } from './envelope.js';
import type { DB } from '../db/client.js';
import type { ConnectionMap } from './connection-map.js';

export function registerServerRelay(
  app: FastifyInstance,
  db: DB,
  connMap: ConnectionMap,
): void {
  app.get('/relay/server', { websocket: true }, async (ws, req) => {
    const token = (req.query as { token?: string }).token;
    if (!token) { ws.close(4000, 'missing_token'); return; }

    const rows = await db`
      SELECT token, user_id, mobile_pk, expires_at, claimed, server_id
      FROM server_tokens WHERE token = ${token}`;
    const row = rows[0];
    if (!row) { ws.close(4003, 'invalid_token'); return; }
    if (new Date(row.expires_at as string).getTime() < Date.now()) {
      ws.close(4003, 'expired_token');
      return;
    }

    let serverId: string | null = null;

    ws.on('message', async (raw: Buffer) => {
      const { env } = decodeFrame(raw);

      if (env.type === 'register') {
        const name = String(env.server_name ?? 'server');
        const version = String(env.version ?? '');
        const serverPk = Buffer.from(String(env.server_pk), 'base64url');
        const caps = (env.capabilities as string[]) ?? [];
        let claimedId = row.server_id as string | null;

        if (!claimedId) {
          const [s] = await db`
            INSERT INTO servers (user_id, name, version, server_pk, capabilities, status, last_heartbeat)
            VALUES (${row.user_id}, ${name}, ${version}, ${serverPk}, ${caps}, 'online', now())
            RETURNING id`;
          claimedId = s!.id as string;
          await db`UPDATE server_tokens SET claimed = true, server_id = ${claimedId} WHERE token = ${token}`;
        } else {
          await db`UPDATE servers SET status = 'online', last_heartbeat = now(), version = ${version} WHERE id = ${claimedId}`;
        }

        serverId = claimedId;
        connMap.addServer({ ws, userId: row.user_id as string, serverId: claimedId });
        ws.send(
          encodeFrame({
            type: 'registered',
            client_id: '',
            server_id: claimedId,
            heartbeat_interval_ms: 30000,
          } as Envelope),
        );
        return;
      }

      if (env.type === 'heartbeat' && serverId) {
        await db`UPDATE servers SET status = 'online', last_heartbeat = now() WHERE id = ${serverId}`;
        ws.send(
          encodeFrame({
            type: 'heartbeat_ack',
            client_id: '',
            timestamp: new Date().toISOString(),
          } as Envelope),
        );
        return;
      }

      // Data frames and client_id-tagged control frames: forward to the target client.
      if (env.client_id) {
        const cc = connMap.getClient(env.client_id);
        if (cc && cc.serverId === serverId) cc.ws.send(raw);
      }
    });

    ws.on('close', async () => {
      if (serverId) {
        connMap.removeServer(serverId);
        await db`UPDATE servers SET status = 'offline' WHERE id = ${serverId}`;
      }
    });
  });
}
