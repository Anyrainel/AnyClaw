# AnyClaw WireGuard Direct Connection Plan

## Goal
Enable native mobile apps (iOS/Android) to connect directly to user's self-hosted server via WireGuard VPN tunnel. Eliminate broker traffic relay to save costs. Broker only handles OAuth, server registry, and initial pairing.

## Architecture Overview

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Mobile App    │         │     Broker      │         │  User's Server  │
│ (iOS/Android)   │         │  (your cloud)   │         │  (self-hosted)  │
└────────┬────────┘         └────────┬────────┘         └────────┬────────┘
         │                           │                           │
         │  1. OAuth → JWT           │                           │
         │  2. GET /servers          │                           │
         │  (list my servers)        │                           │
         │                           │                           │
         │  3. Select server         │                           │
         │  4. Get connection info   │                           │
         │     (WireGuard pubkey,    │                           │
         │      endpoint, tunnel IP)  │                           │
         │                           │                           │
         │◀═════════════════════════════════════════════════════│
         │  5. Establish WireGuard tunnel                        │
         │     (direct UDP, NAT traversal)                      │
         │                           │                           │
         │◀═════════════════════════════════════════════════════│
         │  6. All API calls direct  │                           │
         │     HTTP over tunnel      │                           │
         │     to server:4100, :5173 │                           │
         │                           │                           │
         │                           │                           │
         │  ... server IP changes ...│                           │
         │                           │                           │
         │  7. Connection drops      │                           │
         │  8. Query broker for      │                           │
         │     updated endpoint      │                           │
         │  9. Re-establish tunnel   │                           │
```

## Components to Modify

### 1. Server (anyclaw-server)

#### New: WireGuard Service
- **Package**: `@anyclaw/wireguard` or built into `tunnel-manager`
- **Responsibilities**:
  - Generate server WireGuard keypair on first boot
  - Run WireGuard daemon (or userspace `wireguard-go`)
  - Assign tunnel IP (e.g., `10.64.0.1/24`)
  - Expose WireGuard public key, endpoint, tunnel IP to broker
  - Accept client public keys (from pairing)
  - Route HTTP services over tunnel interface

#### Modified: tunnel-manager
- **Current**: Connects to broker relay WebSocket
- **New**: 
  - Register with broker (provide WireGuard info, not relay)
  - Heartbeat to broker (status, current endpoint if known)
  - Handle client connection requests (add peer to WireGuard)

#### Modified: dispatch, prod-static, pocketbase
- **Current**: Listen on `0.0.0.0` (all interfaces)
- **New**: Also listen on WireGuard tunnel interface (`10.64.0.1`)
- HTTP services accessible via tunnel

### 2. Broker

#### Keep (minimal)
- OAuth routes (`/auth/*`)
- Server registry (`/servers`, `/servers/pair/*`)
- JWT auth
- Server heartbeat/status tracking

#### Remove/Deprecate
- WebSocket relay (`/relay/server`, `/relay/client`)
- ConnectionMap, envelope forwarding
- Byte-for-byte traffic relay

#### Add
- Server endpoint info in database:
  ```sql
  ALTER TABLE servers ADD COLUMN:
    wg_public_key TEXT,
    wg_endpoint TEXT,  -- "203.0.113.42:51820" or null if behind NAT
    wg_tunnel_ip TEXT, -- "10.64.0.1"
    last_wg_endpoint TEXT -- updated from heartbeat
  ```
- Client API: `GET /servers/:id/connection` → returns WireGuard config

### 3. Mobile App

#### New: WireGuard Module
- Use `react-native-wireguard-vpn`
- Expo config plugin (already available)
- Requires: prebuild/dev build (not Expo Go)

#### Modified: Connection Flow
```typescript
// New connection flow
async function connectToServer(serverId: string): Promise<void> {
  // 1. Get server connection info from broker
  const connInfo = await brokerApi.getConnectionInfo(serverId);
  
  // 2. Generate or load client keypair
  const clientKeys = await getOrGenerateClientKeys(serverId);
  
  // 3. Send client public key to server (via broker or direct)
  await brokerApi.registerClientKey(serverId, clientKeys.publicKey);
  
  // 4. Configure WireGuard
  const wgConfig: WireGuardConfig = {
    privateKey: clientKeys.privateKey,
    publicKey: connInfo.wgPublicKey,
    serverAddress: connInfo.wgEndpoint || connInfo.lastKnownIp,
    serverPort: connInfo.wgPort || 51820,
    address: '10.64.0.2/32', // client tunnel IP
    allowedIPs: ['10.64.0.0/24'], // only route tunnel traffic
    dns: [],
    mtu: 1420,
  };
  
  // 5. Connect
  await WireGuardVpnModule.connect(wgConfig);
  
  // 6. Store active tunnel
  await storeActiveTunnel(serverId, wgConfig);
}
```

#### Modified: API Client
```typescript
// Current: encrypted fetch to broker relay
// New: direct HTTP over WireGuard tunnel
class DirectApiClient {
  private baseUrl = 'http://10.64.0.1:4100'; // server tunnel IP
  
  async get<T>(path: string): Promise<T> {
    // Standard fetch, goes through WireGuard tunnel
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    return response.json();
  }
}
```

#### Modified: broker.ts
- Remove: `establishTunnel()` (no broker relay)
- Keep: `loginWithProvider()`, `fetchServers()`, `requestPairing()`
- Add: `getConnectionInfo()`, `registerClientKey()`

### 4. Pairing Flow

#### Current (broker relay)
1. Client generates keypair
2. Client sends public key to broker
3. Server gets public key from broker
4. Both encrypt traffic, broker relays bytes

#### New (WireGuard direct)
1. Client generates WireGuard keypair
2. Server generates WireGuard keypair (on boot)
3. Broker stores both public keys + server endpoint info
4. Client gets server info from broker
5. Client configures WireGuard, connects direct
6. Server adds client as WireGuard peer (on heartbeat or explicit API call)

#### QR Code Pairing (simplified)
```
Server shows QR:
{
  "server_id": "uuid",
  "wg_pubkey": "base64",
  "endpoint": "auto", // or "192.168.1.100:51820" for local
  "token": "pairing-token"
}

Client scans:
1. Decode QR
2. Get server info from broker (validate token)
3. Generate client keys
4. Register client key with broker
5. Connect WireGuard
```

## Implementation Phases

### Phase 1: Server WireGuard Setup
1. Add `wireguard-tools` or `wireguard-go` to Docker image
2. Generate server keys on first boot
3. Configure WireGuard interface (`wg0`)
4. Make HTTP services listen on tunnel IP
5. Report WireGuard info to broker on registration

### Phase 2: Broker Minimal Mode
1. Add WireGuard columns to database
2. Add `/servers/:id/connection` endpoint
3. Remove WebSocket relay routes (or make optional)
4. Update server heartbeat to accept endpoint info

### Phase 3: Mobile WireGuard Integration
1. Add `react-native-wireguard-vpn` dependency
2. Configure Expo plugin
3. Implement new connection flow
4. Replace broker relay API client with direct HTTP

### Phase 4: Testing
1. Local testing: server + mobile on same network
2. NAT testing: server behind router, mobile on cellular
3. End-to-end: full agent task execution

## Security Considerations

1. **Key exchange**: Public keys via broker (authenticated), private keys never leave device
2. **No broker traffic**: Broker only sees connection metadata, never user data
3. **NAT traversal**: WireGuard uses UDP, works through most NATs without config
4. **IP rotation**: If server IP changes, client queries broker for new endpoint
5. **Local network**: mDNS discovery as fallback when on same WiFi

## Open Questions

1. Should server run kernel WireGuard (requires privileged container) or userspace?
2. How to handle multiple clients per server (family members)?
3. Should we keep WebSocket relay as emergency fallback (disabled by default)?
4. iOS Packet Tunnel extension requires $99/year Apple Developer account — acceptable?
5. Android VPN service requires special permission — any Play Store issues?

## Files to Create/Modify

### New Files
- `anyclaw-server/packages/wireguard/src/index.ts`
- `anyclaw-server/packages/wireguard/src/config.ts`
- `mobile/lib/wireguard.ts`
- `mobile/lib/direct-api.ts`

### Modified Files
- `anyclaw-server/infra/Dockerfile` (add wireguard-tools)
- `anyclaw-server/infra/supervisord.conf` (add wireguard process)
- `anyclaw-server/packages/tunnel-manager/src/index.ts`
- `broker/src/servers/pairing.ts`
- `broker/src/db/migrate.ts`
- `mobile/lib/broker.ts`
- `mobile/lib/api.ts`
- `mobile/lib/connection/store.ts`
- `mobile/app.json` (add wireguard plugin)

## Next Steps

1. Decide on kernel vs userspace WireGuard
2. Implement server-side WireGuard setup
3. Update broker database schema
4. Test WireGuard library in mobile app
5. Integrate with existing connection flow
