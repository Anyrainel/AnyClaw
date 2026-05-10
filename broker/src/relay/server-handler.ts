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
        const connMode = String(env.connection_mode ?? 'broker_relay');
        const publicHost = env.public_host ? String(env.public_host) : null;
        const publicApiPort = env.public_api_port ? Number(env.public_api_port) : null;
        const publicAppPort = env.public_app_port ? Number(env.public_app_port) : null;
        const publicPbPort = env.public_pb_port ? Number(env.public_pb_port) : null;
        const publicUseTls = env.public_use_tls !== undefined ? Boolean(env.public_use_tls) : null;
        const wgPublicKey = env.wg_public_key ? String(env.wg_public_key) : null;
        const wgEndpoint = env.wg_endpoint ? String(env.wg_endpoint) : null;
        const wgTunnelIp = env.wg_tunnel_ip ? String(env.wg_tunnel_ip) : null;
        const wgPort = env.wg_port ? Number(env.wg_port) : null;
        let claimedId = row.server_id as string | null;

        if (!claimedId) {
          const [s] = await db`
            INSERT INTO servers (
              user_id, name, version, server_pk, capabilities, status,
              last_heartbeat, connection_mode, public_host, public_api_port,
              public_app_port, public_pb_port, public_use_tls, wg_public_key,
              wg_endpoint, wg_tunnel_ip, wg_port
            )
            VALUES (
              ${row.user_id}, ${name}, ${version}, ${serverPk}, ${caps}, 'online',
              now(), ${connMode}, ${publicHost}, ${publicApiPort},
              ${publicAppPort}, ${publicPbPort}, ${publicUseTls}, ${wgPublicKey},
              ${wgEndpoint}, ${wgTunnelIp}, ${wgPort}
            )
            RETURNING id`;
          claimedId = s!.id as string;
          await db`UPDATE server_tokens SET claimed = true, server_id = ${claimedId} WHERE token = ${token}`;
        } else {
          await db`UPDATE servers SET status = 'online', last_heartbeat = now(), version = ${version},
            connection_mode = ${connMode}, public_host = ${publicHost},
            public_api_port = ${publicApiPort}, public_app_port = ${publicAppPort},
            public_pb_port = ${publicPbPort}, public_use_tls = ${publicUseTls},
            wg_public_key = ${wgPublicKey}, wg_endpoint = ${wgEndpoint},
            wg_tunnel_ip = ${wgTunnelIp}, wg_port = ${wgPort}
            WHERE id = ${claimedId}`;
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
        const connMode = env.connection_mode ? String(env.connection_mode) : undefined;
        const publicHost = env.public_host ? String(env.public_host) : undefined;
        const publicApiPort = env.public_api_port ? Number(env.public_api_port) : undefined;
        const publicAppPort = env.public_app_port ? Number(env.public_app_port) : undefined;
        const publicPbPort = env.public_pb_port ? Number(env.public_pb_port) : undefined;
        const publicUseTls = env.public_use_tls !== undefined ? Boolean(env.public_use_tls) : undefined;
        const wgPublicKey = env.wg_public_key ? String(env.wg_public_key) : undefined;
        const wgEndpoint = env.wg_endpoint ? String(env.wg_endpoint) : undefined;
        const wgTunnelIp = env.wg_tunnel_ip ? String(env.wg_tunnel_ip) : undefined;
        const wgPort = env.wg_port ? Number(env.wg_port) : undefined;

        await db`UPDATE servers SET status = 'online', last_heartbeat = now()
          ${connMode ? db`, connection_mode = ${connMode}` : db``}
          ${publicHost !== undefined ? db`, public_host = ${publicHost}` : db``}
          ${publicApiPort !== undefined ? db`, public_api_port = ${publicApiPort}` : db``}
          ${publicAppPort !== undefined ? db`, public_app_port = ${publicAppPort}` : db``}
          ${publicPbPort !== undefined ? db`, public_pb_port = ${publicPbPort}` : db``}
          ${publicUseTls !== undefined ? db`, public_use_tls = ${publicUseTls}` : db``}
          ${wgPublicKey !== undefined ? db`, wg_public_key = ${wgPublicKey}` : db``}
          ${wgEndpoint !== undefined ? db`, wg_endpoint = ${wgEndpoint}` : db``}
          ${wgTunnelIp !== undefined ? db`, wg_tunnel_ip = ${wgTunnelIp}` : db``}
          ${wgPort !== undefined ? db`, wg_port = ${wgPort}` : db``}
          WHERE id = ${serverId}`;
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
