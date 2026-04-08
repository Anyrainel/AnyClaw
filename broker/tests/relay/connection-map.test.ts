import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionMap, type ServerConn, type ClientConn } from '../../src/relay/connection-map.js';

// Lightweight WebSocket stand-in — ConnectionMap stores references, it
// never actually calls methods on the socket.
type FakeWs = object;

function makeServer(id: string, userId: string): ServerConn {
  return { ws: {} as FakeWs as import('ws').WebSocket, userId, serverId: id };
}

function makeClient(clientId: string, serverId: string, userId: string): ClientConn {
  return { ws: {} as FakeWs as import('ws').WebSocket, userId, serverId, clientId };
}

describe('ConnectionMap', () => {
  let map: ConnectionMap;

  beforeEach(() => {
    map = new ConnectionMap();
  });

  it('tracks server connections', () => {
    map.addServer(makeServer('srv-1', 'u1'));
    expect(map.serverCount()).toBe(1);
    expect(map.hasServer('srv-1')).toBe(true);
    expect(map.getServer('srv-1')?.userId).toBe('u1');
    map.removeServer('srv-1');
    expect(map.serverCount()).toBe(0);
    expect(map.getServer('srv-1')).toBeUndefined();
  });

  it('tracks client connections', () => {
    map.addClient(makeClient('c_a', 'srv-1', 'u1'));
    map.addClient(makeClient('c_b', 'srv-1', 'u1'));
    map.addClient(makeClient('c_c', 'srv-2', 'u1'));
    expect(map.clientCount()).toBe(3);
    expect(map.getClient('c_a')?.serverId).toBe('srv-1');
  });

  it('filters clients by server', () => {
    map.addClient(makeClient('c_a', 'srv-1', 'u1'));
    map.addClient(makeClient('c_b', 'srv-1', 'u1'));
    map.addClient(makeClient('c_c', 'srv-2', 'u1'));
    const srv1Clients = map.clientsForServer('srv-1');
    expect(srv1Clients).toHaveLength(2);
    expect(srv1Clients.map((c) => c.clientId).sort()).toEqual(['c_a', 'c_b']);
  });

  it('overwrites an existing server registration by id', () => {
    map.addServer(makeServer('srv-1', 'u1'));
    map.addServer(makeServer('srv-1', 'u2')); // reconnect
    expect(map.serverCount()).toBe(1);
    expect(map.getServer('srv-1')?.userId).toBe('u2');
  });

  it('clear() removes all connections', () => {
    map.addServer(makeServer('srv-1', 'u1'));
    map.addClient(makeClient('c_a', 'srv-1', 'u1'));
    map.clear();
    expect(map.serverCount()).toBe(0);
    expect(map.clientCount()).toBe(0);
  });
});
