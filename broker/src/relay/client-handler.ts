import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { encodeFrame, peekClientId, type Envelope } from './envelope.js';
import type { DB } from '../db/client.js';
import type { JwtConfig } from '../auth/jwt.js';
import { verifyAccess } from '../auth/jwt.js';
import type { ConnectionMap } from './connection-map.js';

export function registerClientRelay(
  app: FastifyInstance,
  db: DB,
  connMap: ConnectionMap,
  jwtCfg: JwtConfig,
): void {
  app.get('/relay/client', { websocket: true }, async (ws, req) => {
    const auth = req.headers.authorization;
    const serverId = (req.query as { server_id?: string }).server_id;
    if (!auth?.startsWith('Bearer ') || !serverId) {
      ws.close(4000, 'missing_auth');
      return;
    }

    let userId: string;
    let sessionId: string;
    try {
      const v = await verifyAccess(jwtCfg, auth.slice(7));
      userId = v.sub;
      sessionId = v.sid;
    } catch {
      ws.close(4001, 'invalid_jwt');
      return;
    }

    // Confirm the session still exists + the user owns the server.
    const sessRows = await db`SELECT 1 FROM sessions WHERE id = ${sessionId} AND expires_at > now()`;
    if (sessRows.length === 0) {
      ws.close(4001, 'session_revoked');
      return;
    }
    const owned = await db`SELECT 1 FROM servers WHERE id = ${serverId} AND user_id = ${userId}`;
    if (owned.length === 0) {
      ws.close(4003, 'not_owned');
      return;
    }

    const srv = connMap.getServer(serverId);
    if (!srv) {
      ws.close(4004, 'server_offline');
      return;
    }

    const clientId = 'c_' + randomBytes(6).toString('base64url');
    connMap.addClient({ ws, userId, serverId, clientId });

    // Notify the host.
    srv.ws.send(
      encodeFrame({
        type: 'connection_request',
        client_id: clientId,
        session_id: sessionId,
      } as Envelope),
    );

    ws.on('message', (raw: Buffer) => {
      // Byte-for-byte forward to the paired host. Peek client_id only to
      // cheaply validate the client isn't forging someone else's id.
      try {
        if (peekClientId(raw) !== clientId) {
          ws.close(4002, 'client_id_mismatch');
          return;
        }
      } catch {
        return;
      }
      srv.ws.send(raw);
    });

    ws.on('close', () => {
      connMap.removeClient(clientId);
      srv.ws.send(
        encodeFrame({
          type: 'stream_close',
          client_id: clientId,
        } as Envelope),
      );
    });
  });
}
