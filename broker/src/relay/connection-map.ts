import type { WebSocket } from 'ws';

export interface ServerConn {
  ws: WebSocket;
  userId: string;
  serverId: string;
}

export interface ClientConn {
  ws: WebSocket;
  userId: string;
  serverId: string;
  clientId: string;
}

/**
 * Tracks live relay connections. The broker maintains exactly one
 * host-side connection per server_id and 0..N client-side connections
 * per paired (user, server).
 */
export class ConnectionMap {
  private servers = new Map<string, ServerConn>();
  private clients = new Map<string, ClientConn>();

  addServer(c: ServerConn): void {
    this.servers.set(c.serverId, c);
  }

  removeServer(serverId: string): void {
    this.servers.delete(serverId);
  }

  getServer(serverId: string): ServerConn | undefined {
    return this.servers.get(serverId);
  }

  hasServer(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  addClient(c: ClientConn): void {
    this.clients.set(c.clientId, c);
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  getClient(clientId: string): ClientConn | undefined {
    return this.clients.get(clientId);
  }

  clientsForServer(serverId: string): ClientConn[] {
    return Array.from(this.clients.values()).filter((c) => c.serverId === serverId);
  }

  serverCount(): number {
    return this.servers.size;
  }

  clientCount(): number {
    return this.clients.size;
  }

  clear(): void {
    this.servers.clear();
    this.clients.clear();
  }
}
