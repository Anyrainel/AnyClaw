# Plan 4: Connection Broker -- Detailed Design

**Goal:** Build a lightweight cloud service that authenticates users, registers self-hosted server instances, and brokers connections between the mobile app and the user's server. The broker implements a phased tunnel strategy: Phase 1 WSS relay, Phase 2 WebRTC P2P with the broker reduced to signaling, Phase 3 Cloudflare Tunnel fallback.

**Guiding constraint:** The broker must be cheap to operate. In Phase 1 it relays all user traffic, so the design must minimize per-user bandwidth and make the transition to Phase 2 (P2P) as fast as possible.

---

## 1. Auth System

### 1.1 Identity Provider

Use **Lucia Auth v3** (MIT, TypeScript) with a Postgres adapter. Lucia is a thin session library -- it handles password hashing (argon2id), session tokens, and cookie/header management without imposing framework opinions. It runs inside the broker's Node.js process.

Alternative considered: **Auth.js (NextAuth)** -- rejected because it is tightly coupled to Next.js patterns and its session model is optimized for browser cookies, not mobile bearer tokens.

Alternative considered: **Managed auth (Clerk, Auth0)** -- rejected for Phase 1 to avoid external dependency costs and latency. Can revisit if user growth justifies it.

### 1.2 Registration and Login

**Email + password:**
1. `POST /auth/register` -- email, password. Lucia hashes with argon2id, stores user row. Returns a session token (opaque, 256-bit random, stored in Postgres `sessions` table).
2. `POST /auth/login` -- email, password. Validates credentials, creates session, returns token.
3. Email verification via a signed link (`POST /auth/verify-email?token=...`). Use Resend (transactional email API, free tier: 100 emails/day) for sending.

**OAuth (Google, Apple, GitHub — all three at launch):**
1. `GET /auth/oauth/:provider` -- redirects to provider's consent screen.
2. `GET /auth/oauth/:provider/callback` -- receives authorization code, exchanges for ID token, upserts user by provider+subject, creates session.
3. On mobile: use `expo-auth-session` (Expo's managed OAuth flow with AuthSession.startAsync). The mobile app opens the broker's OAuth URL in an in-app browser, receives the callback redirect with the session token.

Lucia supports linking multiple OAuth providers to a single user via its `oauth_account` table (provider + provider_user_id -> user_id). A user who registers with email can later link Google/GitHub without creating a duplicate account.

### 1.3 Session Tokens and Multi-Device

Sessions are opaque bearer tokens, not JWTs. Rationale: sessions can be revoked instantly by deleting the row, which matters when a phone is lost. JWTs require short expiry + refresh dance to approximate revocability.

**Token lifecycle:**
- Token returned as JSON in login/register response body (not a cookie -- mobile apps use `Authorization: Bearer <token>` header).
- Session expiry: 30 days. Sliding window: each API call that validates the session extends expiry by 30 days if less than 15 days remain.
- `POST /auth/logout` -- deletes the session row.
- `POST /auth/logout-all` -- deletes all sessions for the user (lost phone scenario).
- `GET /auth/sessions` -- lists active sessions with device name, last active timestamp, IP (for the user to audit).

**Multi-device:** A single user can have multiple active sessions (phone, tablet, second phone). Each session is independent. There is no "device registration" step -- a new login creates a new session. The mobile app stores the token in `expo-secure-store` (Keychain on iOS, Keystore on Android).

### 1.4 Database Schema (Auth)

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE,
  password_hash TEXT,          -- NULL for OAuth-only users
  email_verified BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE oauth_accounts (
  provider         TEXT NOT NULL,       -- 'google', 'github', 'apple'
  provider_user_id TEXT NOT NULL,
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,           -- 256-bit random token (base64url)
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT,                      -- e.g. "iPhone 15 Pro" (from User-Agent or app metadata)
  ip_address  INET,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  last_active TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

A background job runs hourly to `DELETE FROM sessions WHERE expires_at < now()`.

---

## 2. Server Registration

### 2.1 Registration Flow

When a self-hosted AnyClaw server starts, it registers with the broker:

1. The server reads its config file which contains: `broker_url`, `user_email`, `server_token`. The `server_token` is generated during initial setup (a one-time pairing step in the mobile app that creates a token scoped to the user).
2. `POST /servers/register` with body `{ server_token, server_name, version, capabilities }`.
   - The broker validates `server_token` against the `server_tokens` table (links to a user_id).
   - Creates or updates a row in the `servers` table.
   - Returns `{ server_id, heartbeat_interval_ms: 30000, wss_relay_url }`.
3. The server opens a persistent WebSocket to the relay URL (Phase 1) or to the signaling endpoint (Phase 2).

**Server token pairing (one-time setup):**
- In the mobile app settings, user taps "Add Server".
- App calls `POST /servers/create-token` (authenticated). Returns a `server_token` (single-use, 24-hour expiry) and a QR code / copyable string.
- User pastes the token into the server's config file or scans the QR code on the machine running the server.
- On first heartbeat with that token, the token is marked as "claimed" and bound to that server_id. It cannot be reused.

### 2.2 Heartbeat Protocol

After registration, the server sends heartbeats over its existing WebSocket connection (not separate HTTP calls -- avoids connection overhead).

**Heartbeat message (server -> broker):**
```json
{
  "type": "heartbeat",
  "server_id": "srv_abc123",
  "uptime_s": 3600,
  "active_connections": 1,
  "cpu_pct": 12,
  "mem_mb": 256,
  "version": "0.3.1"
}
```

**Heartbeat interval:** 30 seconds. The broker expects a heartbeat within 90 seconds (3x interval). If missed:
1. After 90s: mark server as `degraded`. Mobile app shows a yellow indicator.
2. After 180s: mark server as `offline`. Mobile app shows a red indicator and "Server unreachable" message.
3. When a heartbeat arrives again: mark server as `online`. Mobile app reconnects automatically.

**Broker -> server pong:**
```json
{
  "type": "heartbeat_ack",
  "timestamp": "2026-04-05T12:00:00Z",
  "pending_connections": 0
}
```

The `pending_connections` field tells the server how many mobile clients are waiting to connect. This lets the server prepare resources.

### 2.3 Database Schema (Servers)

```sql
CREATE TABLE server_tokens (
  token       TEXT PRIMARY KEY,            -- random 256-bit base64url
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  claimed     BOOLEAN DEFAULT FALSE,
  server_id   UUID,                        -- set when claimed
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE servers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  version         TEXT,
  status          TEXT DEFAULT 'offline',  -- 'online', 'degraded', 'offline'
  server_pk       TEXT,                    -- X25519 public key (base64url), set during registration
  last_heartbeat  TIMESTAMPTZ,
  registered_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_servers_user ON servers(user_id);

CREATE TABLE device_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  server_id   UUID REFERENCES servers(id) ON DELETE CASCADE,
  session_id  TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  mobile_pk   TEXT NOT NULL,              -- X25519 public key (base64url) for this device-server pair
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_device_keys_server ON device_keys(server_id);
```

---

## 3. Phase 1: WSS Relay

### 3.1 Architecture

```
Mobile App          Connection Broker              User's Server
    |                      |                            |
    |-- WSS connect ------>|                            |
    |   (Bearer token)     |                            |
    |                      |<--- WSS (persistent) ------|
    |                      |     (server_token)         |
    |                      |                            |
    |== encrypted frames =>|== encrypted frames =======>|
    |<= encrypted frames ==|<= encrypted frames =======|
```

The broker runs two WebSocket listener endpoints:

1. **`wss://broker.anyclawapp.com/relay/client`** -- mobile app connects here. Auth via `Authorization: Bearer <session_token>` in the WebSocket upgrade request headers (supported by all WS clients).
2. **`wss://broker.anyclawapp.com/relay/server`** -- AnyClaw server connects here. Auth via `server_token` query parameter in the upgrade URL (since the server-side WS client controls the URL).

### 3.2 Connection Establishment

1. Mobile app authenticates with the broker REST API, receives list of user's servers via `GET /servers` (returns server_id, name, status).
2. User selects a server (or auto-selects the only one).
3. Mobile app opens a WebSocket to `wss://broker.anyclawapp.com/relay/client?server_id=srv_abc123`.
4. Broker validates the session token and checks that `server_id` belongs to the authenticated user.
5. Broker looks up the server's existing WebSocket connection. If found and `status=online`:
   - Broker sends a `connection_request` message to the server's WebSocket.
   - Server responds with `connection_accept`.
   - Broker creates a bidirectional pipe: frames from the client WS are forwarded to the server WS and vice versa.
6. If the server is offline, broker returns a WebSocket close frame with code `4001` and reason `"server_offline"`. The mobile app shows the reconnect screen.

### 3.3 Protocol Messages

All messages are JSON. Binary payloads (file uploads, images) are sent as binary WebSocket frames and forwarded without parsing.

**Control messages (broker <-> client, broker <-> server):**

```typescript
// Client -> Broker (upgrade header carries auth)
// No explicit auth message needed; auth happens during WS handshake

// Broker -> Client
{ type: "connected", server_id: string, server_name: string }
{ type: "server_offline", server_id: string }
{ type: "server_reconnected", server_id: string }
{ type: "error", code: string, message: string }

// Broker -> Server
{ type: "connection_request", client_id: string, session_id: string }
{ type: "client_disconnected", client_id: string }

// Server -> Broker
{ type: "connection_accept", client_id: string }
{ type: "connection_reject", client_id: string, reason: string }
```

**Data messages (relayed transparently):**

```typescript
// Client -> Broker -> Server (and reverse)
// Wrapped in a thin envelope for multiplexing:
{ type: "data", client_id: string, payload: any }

// Binary frames: forwarded as-is with a 4-byte client_id prefix for multiplexing
// [client_id: 4 bytes][payload: rest of frame]
```

**Multiplexing:** A single server WS connection serves multiple mobile clients. The `client_id` in data messages lets the server route responses to the correct mobile app session. The broker strips the envelope when forwarding to the client (each client gets a dedicated WS, so no multiplexing needed on the client side).

### 3.4 Latency Optimization

- **Single hop:** The broker does not parse or transform data frames. It reads from one WS and writes to the other. The relay loop is ~100 lines of code.
- **Binary frames preferred:** For PocketBase API calls (which are HTTP-over-WS), the mobile app sends binary frames containing the serialized HTTP request. The server deserializes and routes to PocketBase locally. This avoids JSON parsing overhead in the relay.
- **Broker placement:** Initial deployment on a single VPS in US East (iad) for best peering with the largest user base. Migrate to Fly.io for multi-region when user distribution justifies it.
- **Backpressure:** If the server WS buffer exceeds 1 MB, the broker pauses reading from the client WS (TCP backpressure propagates naturally). Resume when buffer drains below 512 KB.
- **Ping/pong:** Both client and server WS connections use WebSocket protocol-level pings every 15 seconds. If a pong is not received within 10 seconds, the connection is considered dead and torn down.

### 3.5 Reconnection

**Client reconnection:**
1. On WS close or error, the mobile app waits 1 second and retries.
2. Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
3. On reconnect, the broker re-establishes the pipe to the server. Pending in-flight requests are lost (the PocketBase client in the WebView retries automatically via its SDK).
4. If the app was backgrounded (iOS/Android), reconnection happens when the app returns to foreground. `expo-task-manager` is NOT used for background WS -- it is unreliable and battery-draining. The app simply reconnects on foreground.

**Server reconnection:**
1. If the server's WS to the broker drops, the server reconnects with exponential backoff (same schedule as client).
2. During server reconnect, all connected mobile clients see `server_offline` and enter the reconnect screen.
3. When the server reconnects, the broker sends `server_reconnected` to all waiting clients, who then re-establish their data pipes.

---

## 4. Phase 2: WebRTC P2P

### 4.1 Goal

Eliminate the broker from the data path. The broker becomes a signaling server only: it helps the mobile app and server exchange SDP offers/answers and ICE candidates, then steps out.

### 4.2 React Native WebRTC Setup

**Library:** `react-native-webrtc` (npm: `react-native-webrtc@latest`, ~125k weekly downloads).

**Expo compatibility:** The package provides an official Expo config plugin via `@config-plugins/react-native-webrtc`. This requires:
- `expo prebuild` (generates native iOS/Android projects). This means development builds, not Expo Go.
- Adding to `app.json`:
  ```json
  {
    "expo": {
      "plugins": [
        "@config-plugins/react-native-webrtc"
      ]
    }
  }
  ```
- The plugin automatically configures iOS permissions (`NSCameraUsageDescription`, `NSMicrophoneUsageDescription` -- even though AnyClaw only uses data channels, the plugin requests them; these can be overridden to data-only in a custom config plugin fork if App Store review objects).
- No full ejection required. `expo prebuild` + `eas build` handles the native compilation.

**Server side:** The AnyClaw server (Node.js) uses the `wrtc` npm package (WebRTC for Node.js, based on Google's libwebrtc). This runs as a native addon -- compatible with the Docker-based server deployment.

### 4.3 Signaling Protocol

Signaling messages flow through the broker's existing WebSocket connections.

```
Mobile App              Broker                 User's Server
    |                     |                         |
    |-- signal_offer ---->|--- signal_offer ------->|
    |                     |                         |
    |<-- signal_answer ---|<-- signal_answer -------|
    |                     |                         |
    |-- ice_candidate --->|--- ice_candidate ------>|
    |<-- ice_candidate ---|<-- ice_candidate -------|
    |                     |                         |
    |<========= WebRTC data channel ===============>|
    |           (broker not involved)               |
```

**Signaling messages:**

```typescript
// Client -> Broker -> Server
{
  type: "signal_offer",
  client_id: string,
  server_id: string,
  sdp: string                // SDP offer (RTCSessionDescription.sdp)
}

// Server -> Broker -> Client
{
  type: "signal_answer",
  client_id: string,
  sdp: string                // SDP answer
}

// Bidirectional (trickle ICE)
{
  type: "ice_candidate",
  client_id: string,
  server_id: string,
  candidate: string,         // ICE candidate string
  sdpMid: string,
  sdpMLineIndex: number
}

// Server -> Broker -> Client (signaling complete)
{
  type: "signal_complete",
  client_id: string,
  connection_type: "direct" | "relay"  // whether TURN was needed
}
```

### 4.4 STUN/TURN Infrastructure

**STUN:** Use Google's free public STUN servers (`stun:stun.l.google.com:19302`) for ICE candidate gathering. STUN is lightweight (single UDP packet exchange) and does not relay traffic.

**TURN:** Required when both the mobile device and the server are behind symmetric NATs (hole-punching fails). TURN relays media through a server, but unlike the Phase 1 WSS relay, TURN is a standardized protocol with wide availability.

**TURN deployment options (ranked):**
1. **Self-hosted coturn** on the same Fly.io/cloud infrastructure as the broker. Cost: ~$5-15/mo for a small VM. Gives full control over bandwidth accounting.
2. **Cloudflare TURN** (part of Cloudflare Calls, free tier available). Reduces operational burden but adds a dependency.
3. **Twilio TURN** (pay-per-GB). Simple API for credential generation but expensive at scale ($0.40/GB).

Recommendation: start with self-hosted coturn. A single coturn instance handles thousands of concurrent TURN sessions.

**TURN credential rotation:** The broker generates short-lived TURN credentials (valid 6 hours) using coturn's `--use-auth-secret` mode. The broker returns TURN credentials as part of the signaling response so the mobile app and server both have valid credentials before starting ICE.

### 4.5 Data Channel Design

A single WebRTC data channel named `"anyclaw"` carries all traffic:

```typescript
const dataChannel = peerConnection.createDataChannel("anyclaw", {
  ordered: true,          // preserve message order (HTTP semantics need this)
  maxRetransmits: null,   // reliable delivery (no packet loss)
});
```

The channel carries the same message format as the Phase 1 WSS relay (JSON control messages + binary data frames), minus the multiplexing envelope (since P2P is 1:1 between a single client and server).

**Fallback logic:** If the WebRTC data channel fails to establish within 10 seconds, or if it drops and cannot reconnect within 5 seconds, the client falls back to Phase 1 WSS relay automatically. The user sees a brief loading indicator but no manual intervention is needed.

### 4.6 Multiple Devices with WebRTC

Each mobile device establishes its own independent WebRTC peer connection to the server. The server maintains N peer connections for N connected devices. Since AnyClaw is single-user (one user, multiple devices), N is expected to be 1-3.

---

## 5. Security Model

### 5.1 TLS Everywhere

- **Broker REST API:** HTTPS only. TLS termination via Let's Encrypt (certbot/Caddy on the VPS, or at the load balancer after migrating to Fly.io).
- **Broker WebSocket:** WSS (WebSocket over TLS). Same TLS termination.
- **Phase 1 relay:** Both legs (client-to-broker and broker-to-server) are WSS. On top of TLS, all relayed traffic is encrypted end-to-end using NaCl box (Curve25519 + XSalsa20 + Poly1305). The broker cannot read relayed content even if compromised. See section 5.6 for the key exchange protocol.
- **Phase 2 WebRTC:** DTLS is mandatory in the WebRTC spec. All data channel traffic is encrypted peer-to-peer. The broker never sees the plaintext.

### 5.2 Authorization Model

Every request is scoped to the authenticated user:
- A session token can only access servers belonging to that user.
- The broker verifies `user_id` matches on every relay connection and signaling message.
- Server tokens are scoped to a single user and single server after claiming.
- There is no admin API. Operational tasks (user lookup, server list) use direct database queries with audit logging.

### 5.3 Rate Limiting

Implemented at the broker's HTTP/WS layer using a sliding window counter in Redis (or in-memory if Redis is not yet deployed):

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /auth/register` | 5 per IP | 1 hour |
| `POST /auth/login` | 10 per IP | 15 minutes |
| `POST /auth/login` (per account) | 5 failed attempts | 15 minutes (then lockout for 15 min) |
| `POST /servers/create-token` | 10 per user | 1 hour |
| WebSocket connections per user | 5 concurrent | -- |
| WebSocket messages per connection | 1000 per second | -- (backpressure handles sustained load) |

After 5 failed login attempts on an account, the account is locked for 15 minutes. The user can still reset their password via email.

### 5.4 Abuse Prevention

- **No open relay:** The broker only relays traffic between authenticated users and their own registered servers. It does not accept arbitrary WebSocket connections.
- **Bandwidth cap (Phase 1):** Each user's relay traffic is capped at 1 GB/day. If exceeded, the broker sends a `rate_limited` control message and closes the relay. Users hitting this cap are encouraged to upgrade to Phase 2 (WebRTC) which has no broker-side bandwidth cost.
- **Connection limits:** Maximum 3 concurrent mobile devices per user. Maximum 2 registered servers per user.
- **Server token expiry:** Unclaimed server tokens expire after 24 hours. Claimed tokens do not expire but can be revoked by the user.
- **IP-based blocking:** If an IP generates excessive failed auth attempts (>50 in an hour), block it for 24 hours at the load balancer level.

### 5.5 Server Zero-Port Guarantee

The user's server never listens on a public port. It initiates an outbound WebSocket connection to the broker. All traffic flows over this outbound connection. The server's firewall can block all inbound traffic. In Phase 2, WebRTC ICE handles NAT traversal via STUN/TURN -- still no inbound port required.

---

## 6. Scaling Considerations

### 6.1 Phase 1 Bandwidth Cost

Estimate per active user:
- **WebView traffic:** The agent-built React app is served from the user's server. Each page load is ~500 KB (JS bundle + assets). Assume 20 page loads/day = 10 MB/day.
- **API traffic:** PocketBase REST calls. Each call is ~2 KB request + ~5 KB response. Assume 200 API calls/day = 1.4 MB/day.
- **Realtime:** PocketBase SSE subscriptions. ~1 KB per event, ~100 events/day = 100 KB/day.
- **Total per user per day:** ~12 MB.
- **Total per user per month:** ~360 MB.

**Bandwidth cost at scale (Phase 1 relay, all traffic through broker):**

| Users | Monthly bandwidth | Cost (Fly.io: $0.02/GB outbound) |
|-------|------------------|----------------------------------|
| 100 | 36 GB | $0.72 |
| 1,000 | 360 GB | $7.20 |
| 10,000 | 3.6 TB | $72.00 |
| 100,000 | 36 TB | $720.00 |

At 1,000 users, Phase 1 relay bandwidth is very affordable. At 100,000 users it costs ~$720/mo in bandwidth alone -- still manageable but Phase 2 should be live well before then.

**Compute cost:** The relay is CPU-cheap (it is just copying bytes between sockets). A single VPS (2 vCPU, 2 GB RAM, US East) can handle ~500 concurrent WebSocket connections. At 1,000 users with ~30% concurrent, that is 300 connections -- one machine suffices. After migrating to Fly.io, a shared-cpu-1x machine ($1.94/mo) handles the same load.

### 6.2 Phase 2 Cost Reduction

With WebRTC P2P, the broker handles only signaling:
- **Signaling traffic:** ~5 KB per connection establishment (SDP + ICE candidates). This happens once per session (when the app opens), not per request.
- **TURN fallback:** Estimated 10-15% of connections fail P2P hole-punching and fall back to TURN. TURN bandwidth is comparable to Phase 1 relay but only for that 10-15%.
- **Net reduction:** ~85-90% bandwidth reduction at the broker. The 100,000-user scenario drops from $720/mo to ~$72-108/mo.

### 6.3 Horizontal Scaling Strategy

Phase 1 (MVP, <1,000 users): single VPS in US East (iad) running Docker Compose (broker + Postgres). Postgres with daily backups. TLS via Let's Encrypt (Caddy or certbot). Domain: `broker.anyclawapp.com`.

Phase 1.5 (scaling trigger): Migrate to Fly.io when the single VPS becomes a bottleneck or multi-region is needed. Fly.io provides anycast routing, automatic TLS, and easy multi-region deployment. The Docker-based setup makes this migration straightforward.

Phase 2 (1,000-10,000 users):
- Multiple broker instances behind Fly.io's anycast routing.
- WebSocket connections are sticky (Fly.io handles this via `fly-replay` header).
- Shared state (session validation, server registry) via Postgres. Connection mapping (which broker instance holds which server's WS) via Redis pub/sub.
- If client connects to broker-A but the server's WS is on broker-B, broker-A publishes to Redis, broker-B receives and forwards.

Phase 3 (>10,000 users):
- Postgres read replicas for auth lookups.
- Dedicated TURN cluster.
- Regional broker deployments (US, EU, Asia).

---

## 7. Tech Stack

### 7.1 Broker Runtime: Node.js (TypeScript)

**Why Node.js over Go or Rust:**
- The rest of the AnyClaw server stack is Node.js + TypeScript. Using the same language for the broker means shared types, shared tooling (eslint, vitest, tsconfig), and a smaller mental overhead for contributors.
- The `ws` npm package is highly optimized for WebSocket relay workloads (zero-copy buffer forwarding, permessage-deflate).
- The broker is I/O-bound (shuttling bytes between sockets), not CPU-bound. Node.js's event loop handles this well.
- If the broker becomes a bottleneck, the relay hot path (~100 lines) can be rewritten as a native addon in Rust (via napi-rs) without changing the rest of the codebase.

**Go counterargument:** Go's goroutine model handles many concurrent connections more naturally than Node.js. If we expect >50,000 concurrent WebSocket connections on a single instance, Go (with `gobwas/ws` for low-allocation WS handling) would be the better choice. At AnyClaw's expected scale (<10,000 users for the first year), Node.js is sufficient.

**Framework:** Fastify (not Express). Fastify has better performance, built-in schema validation (via JSON Schema / Typebox), and first-class WebSocket support via `@fastify/websocket`.

### 7.2 Database: Postgres

**Why Postgres over SQLite:**
- The broker is a multi-process cloud service. SQLite's single-writer limitation makes it unsuitable for concurrent writes from multiple broker instances.
- Managed Postgres is available on every cloud provider. Fly.io Postgres (actually Supabase-powered) is $0/mo for 1 GB.
- Postgres handles session lookups, server registry queries, and rate limiting counters efficiently with proper indexes.

**Schema summary:**
- `users` -- ~1 KB per row. At 100,000 users: ~100 MB.
- `sessions` -- ~200 bytes per row. At 300,000 sessions: ~60 MB.
- `servers` -- ~200 bytes per row. At 100,000 servers: ~20 MB.
- Total: well under 1 GB for the foreseeable future.

### 7.3 Cache / Rate Limiting: In-Memory (then Redis)

For MVP, rate limiting counters and connection maps live in-process (a `Map<string, number[]>` with sliding window expiry). This works with a single broker instance.

When scaling to multiple instances, add Redis (Fly.io Upstash, or self-hosted on Fly). Redis stores:
- Rate limiting counters (sliding window sorted sets).
- Connection map: `server_id -> broker_instance_id` so that cross-instance relay works.
- Pub/sub channel for relay forwarding between broker instances.

### 7.4 Deployment

- **Platform (initial):** Single VPS in US East (iad) with Docker Compose. Reasons: simplest to operate, cheapest to start, need to co-host with OpenClaw. Migrate to Fly.io when multi-region or auto-scaling is needed.
- **Platform (future):** Fly.io. WebSocket-friendly (no timeout limits), multi-region, cheap, good CLI/CD integration.
- **Container:** Single Dockerfile. Node.js 22 LTS Alpine image. The broker binary is ~50 MB including node_modules. Docker Compose orchestrates broker + Postgres on the VPS.
- **TLS:** Caddy as reverse proxy (automatic Let's Encrypt for `broker.anyclawapp.com`). On Fly.io migration, TLS moves to the load balancer.
- **CI/CD:** GitHub Actions. On push to `main`: build Docker image, run tests, deploy via SSH to VPS (later: `flyctl deploy`).
- **Monitoring:** Prometheus endpoint in Fastify. Key metrics: active WS connections, relay bytes/sec, auth requests/sec, P95 latency, error rate. On VPS: Grafana Cloud free tier or Axiom.
- **Logging:** Structured JSON logs (pino, Fastify's default logger). Ship to Axiom (free tier: 500 MB/mo).

### 7.5 File Structure

```
anyclaw-broker/
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml              # Broker + Postgres for VPS deployment
├── Caddyfile                       # Reverse proxy + auto TLS for broker.anyclawapp.com
├── fly.toml                        # For future Fly.io migration
├── src/
│   ├── index.ts                  # Fastify server entrypoint
│   ├── config.ts                 # Environment variables, defaults
│   ├── db/
│   │   ├── client.ts             # Postgres client (pg or postgres.js)
│   │   ├── migrate.ts            # Migration runner
│   │   └── migrations/
│   │       ├── 001_users.sql
│   │       ├── 002_sessions.sql
│   │       ├── 003_servers.sql
│   │       ├── 004_server_tokens.sql
│   │       └── 005_device_keys.sql
│   ├── auth/
│   │   ├── routes.ts             # /auth/* REST endpoints
│   │   ├── lucia.ts              # Lucia auth setup
│   │   ├── oauth.ts              # OAuth provider configs
│   │   └── middleware.ts         # Session validation middleware
│   ├── servers/
│   │   ├── routes.ts             # /servers/* REST endpoints
│   │   ├── registry.ts           # Server registration + heartbeat logic
│   │   └── health-checker.ts     # Background job: mark stale servers offline
│   ├── relay/
│   │   ├── client-handler.ts     # WSS handler for mobile app connections
│   │   ├── server-handler.ts     # WSS handler for AnyClaw server connections
│   │   ├── pipe.ts               # Bidirectional frame forwarding
│   │   └── connection-map.ts     # In-memory (later Redis) server->WS mapping
│   ├── signaling/
│   │   ├── handler.ts            # WebRTC signaling message routing
│   │   └── turn-credentials.ts   # Short-lived TURN credential generation
│   ├── crypto/
│   │   ├── nacl.ts               # NaCl box encrypt/decrypt helpers
│   │   ├── key-exchange.ts       # X25519 key generation + shared secret derivation
│   │   └── nonce.ts              # Counter-based nonce management
│   └── middleware/
│       ├── rate-limit.ts         # Sliding window rate limiter
│       └── error-handler.ts      # Centralized error handling
├── tests/
│   ├── auth/
│   │   ├── register.test.ts
│   │   ├── login.test.ts
│   │   └── oauth.test.ts
│   ├── relay/
│   │   ├── connect.test.ts
│   │   ├── forward.test.ts
│   │   └── reconnect.test.ts
│   ├── signaling/
│   │   └── webrtc.test.ts
│   └── crypto/
│       ├── nacl.test.ts
│       └── key-exchange.test.ts
└── .env.example
```

---

## 8. Technical Decisions (Resolved)

All five open decisions from the original design have been resolved by the main spec's locked decisions.

| # | Decision | Resolution | Source |
|---|----------|------------|--------|
| 1 | Domain and TLS | `anyclawapp.com` purchased. Broker at `broker.anyclawapp.com`. TLS via Let's Encrypt (Caddy on VPS, load balancer on Fly.io). | Spec decision #15 |
| 2 | OAuth providers | Google + Apple + GitHub at launch. Apple required by App Store. GitHub for developer early-adopter audience. | Spec decision #16 |
| 3 | Phase 2 timing | Launch with WSS relay only. Begin Phase 2 (WebRTC P2P) development after launch. | Spec decision #17 |
| 4 | Broker region | US East (iad). Add regions when user distribution justifies it. | Spec decision #18 |
| 5 | E2E encryption | YES -- NaCl box encryption on top of TLS in Phase 1. Broker cannot read relayed traffic. See section 5.6 for protocol. | Spec decision #19 |

Additional locked decision affecting this design:

| # | Decision | Resolution | Source |
|---|----------|------------|--------|
| 6 | Cloud hosting | Single VPS with Docker Compose first. Migrate to Fly.io later. VPS needs to host OpenClaw alongside AnyClaw. | Spec decision #22 |

---

## 5.6 NaCl End-to-End Encryption (Phase 1)

### 5.6.1 Goal

All data relayed through the broker in Phase 1 is encrypted end-to-end using NaCl box (Curve25519 key agreement + XSalsa20-Poly1305 authenticated encryption). The broker forwards opaque ciphertext. Even a compromised broker learns nothing about the content of relayed messages.

### 5.6.2 Cryptographic Primitives

- **Key agreement:** Curve25519 (X25519 ECDH)
- **Authenticated encryption:** XSalsa20-Poly1305 (NaCl `crypto_box`)
- **Nonce:** 24 bytes, incremented per message (see 5.6.5)
- **Library (mobile/client):** `tweetnacl` (npm, pure JS, audited, 0 dependencies) or `libsodium-wrappers` (npm, WASM build of libsodium)
- **Library (server):** `libsodium-wrappers` (npm) or `sodium-native` (npm, native binding, faster)

### 5.6.3 Key Exchange Protocol

The key exchange happens during the server pairing step (when the user adds a self-hosted server to their account). The broker facilitates the exchange but never learns the shared secret.

**Pairing flow (extended with key exchange):**

```
Mobile App                    Broker                     User's Server
    |                           |                              |
    |  1. POST /servers/        |                              |
    |     create-token          |                              |
    |  (authenticated)          |                              |
    |                           |                              |
    |  <- server_token +        |                              |
    |     broker_relay_pubkey   |                              |
    |                           |                              |
    |  2. Generate ephemeral    |                              |
    |     X25519 keypair:       |                              |
    |     (mobile_pk, mobile_sk)|                              |
    |                           |                              |
    |  3. Display to user:      |                              |
    |     server_token +        |                              |
    |     mobile_pk (QR/copy)   |                              |
    |                           |                              |
    |                           |   4. User pastes/scans       |
    |                           |      server_token + mobile_pk|
    |                           |      into server config      |
    |                           |                              |
    |                           |   5. Server generates its own|
    |                           |      X25519 keypair:         |
    |                           |      (server_pk, server_sk)  |
    |                           |                              |
    |                           |   6. Server computes shared  |
    |                           |      secret:                 |
    |                           |      shared = X25519(        |
    |                           |        server_sk, mobile_pk) |
    |                           |                              |
    |                           |   7. POST /servers/register  |
    |                           |      { server_token,         |
    |                           |        server_pk, ... }      |
    |                           |                              |
    |  8. GET /servers          |                              |
    |     (includes server_pk   |                              |
    |      for each server)     |                              |
    |                           |                              |
    |  9. Mobile computes       |                              |
    |     shared secret:        |                              |
    |     shared = X25519(      |                              |
    |       mobile_sk, server_pk)|                             |
    |                           |                              |
    |  (shared secrets match    |                              |
    |   via Diffie-Hellman)     |                              |
```

**Why the broker cannot learn the shared secret:**
- The broker sees `mobile_pk` (in step 3, embedded in the pairing token/QR) and `server_pk` (in step 7, sent during registration).
- The broker never sees `mobile_sk` or `server_sk` (private keys that never leave the devices).
- Computing the shared secret requires one private key + the other's public key (X25519 Diffie-Hellman). The broker has neither private key.

**Key storage:**
- **Mobile app:** `mobile_sk` is stored in `expo-secure-store` (iOS Keychain / Android Keystore), keyed by `server_id`. `mobile_pk` can be derived from `mobile_sk` or stored alongside it.
- **Server:** `server_sk` is stored in the server's config directory with filesystem permissions restricted to the server process. Not stored in PocketBase (which the agent can access).
- **Broker:** Stores only `mobile_pk` and `server_pk` (public keys). These are not secret.

### 5.6.4 Encrypted Message Format

All data frames in the Phase 1 relay are encrypted before being sent over the WebSocket:

```
Encrypted frame layout:
[nonce: 24 bytes][ciphertext: N bytes (includes 16-byte Poly1305 MAC)]
```

The sender:
1. Serializes the plaintext message (JSON for control messages, raw bytes for binary frames).
2. Generates the next nonce (see 5.6.5).
3. Calls `nacl.box(plaintext, nonce, recipientPublicKey, senderSecretKey)` to produce ciphertext.
4. Sends `nonce || ciphertext` as a binary WebSocket frame.

The receiver:
1. Reads the first 24 bytes as the nonce.
2. Calls `nacl.box.open(ciphertext, nonce, senderPublicKey, recipientSecretKey)` to recover plaintext.
3. If decryption fails (MAC check), drops the frame and logs a warning. Does not close the connection (could be a transient corruption).

**Overhead:** 24 bytes (nonce) + 16 bytes (MAC) = 40 bytes per frame. Negligible for typical messages (1-10 KB).

### 5.6.5 Nonce Management

Nonces must never repeat for the same key pair. Strategy: **counter-based nonces with direction prefix.**

- Mobile-to-server nonces: first byte = `0x01`, remaining 23 bytes = big-endian counter starting at 0.
- Server-to-mobile nonces: first byte = `0x02`, remaining 23 bytes = big-endian counter starting at 0.

The direction prefix ensures that even if both sides start their counters at 0, nonces never collide. The 23-byte counter space (2^184) will never overflow in practice.

Counters reset to 0 each time a new WebSocket connection is established (reconnect). This is safe because the same key pair is reused, but nonce reuse is avoided because the counters always increment within a connection, and a reconnect resets both sides' counters simultaneously.

### 5.6.6 Multi-Device Considerations

Each mobile device generates its own X25519 keypair during pairing. The server stores multiple `(device_id, mobile_pk)` pairs. When the server receives an encrypted frame from the broker, the broker's multiplexing envelope (`client_id`) identifies which device sent it, and the server uses the corresponding `mobile_pk` for decryption.

### 5.6.7 Control Messages vs. Data Messages

**Control messages** (broker <-> client, broker <-> server) such as `connection_request`, `server_offline`, and `heartbeat` are NOT encrypted with NaCl. They are broker-level protocol messages that the broker must read to function. These travel over TLS only.

**Data messages** (client <-> server, relayed through broker) are always NaCl-encrypted. The broker forwards them as opaque binary blobs. The multiplexing envelope (`type: "data"` + `client_id`) is kept in the clear so the broker can route, but the `payload` field is replaced with the encrypted blob:

```typescript
// What the broker sees for a data message:
{
  type: "data",
  client_id: "c_abc123",
  encrypted: true,
  payload: <binary: nonce || ciphertext>
}
```

---

## 9. New Gaps

The following new technical decisions emerged from the locked decisions above, particularly from the NaCl E2E encryption requirement.

### Gap 1: NaCl Key Rotation

The current design generates one X25519 keypair per device-server pair during the initial pairing step. These keys are used indefinitely. Questions:

- **Should keys rotate?** Long-lived keys mean a compromised `mobile_sk` exposes all future traffic. Periodic rotation (e.g., weekly) limits the window.
- **Rotation mechanism:** If keys rotate, how does the new public key reach the other side? The broker can relay public keys, but the old shared secret should be used to authenticate the rotation (sign the new public key with the old key to prevent MITM during rotation).
- **Forward secrecy:** NaCl box with static keys does not provide forward secrecy. A compromised private key exposes all past traffic that was recorded. Should we add an ephemeral key exchange per session (like a double-ratchet or just ephemeral X25519 per connection)?

### Gap 2: Key Backup and Recovery

- **What happens if the user loses their phone?** The `mobile_sk` is in the Keychain/Keystore and may not survive a device wipe. The user would need to re-pair the server (generate new keys). Is this acceptable UX, or do we need encrypted key backup?
- **Multi-device key independence:** Each device has its own keypair. Losing one device does not affect others. But a server-side key loss (disk failure) requires ALL devices to re-pair. Should the server key be included in the server backup strategy?

### Gap 3: Pairing Token Transport Security

- The pairing flow sends `mobile_pk` via QR code or copyable string. If the user copies it through a compromised clipboard (clipboard sniffing malware), an attacker could substitute their own public key (MITM).
- **Mitigation options:** (a) Display a short verification code on both sides (derived from the shared secret) that the user visually confirms. (b) Accept the risk -- clipboard MITM is a local-device-compromise scenario where the attacker likely has broader access anyway.

### Gap 4: NaCl Library Choice

- `tweetnacl` (pure JS) vs. `libsodium-wrappers` (WASM) vs. `sodium-native` (native binding). Need to decide per platform:
  - Mobile (React Native): `tweetnacl` is simplest (no native code), but is it fast enough for encrypting every relayed frame? Benchmarking needed.
  - Server (Node.js): `sodium-native` is fastest but adds a native dependency to the Docker image. `libsodium-wrappers` is WASM and works everywhere.

### Gap 5: Debugging Encrypted Relay Traffic

- With NaCl encryption, the broker cannot inspect relay traffic for diagnostics. How do we debug connectivity issues?
- **Options:** (a) A debug mode flag that temporarily disables E2E encryption (opted in by the user). (b) Client-side and server-side logging of decrypted traffic (local only, never on the broker). (c) Rely on connection-level metrics (frame counts, byte counts, error rates) without content inspection.

### Gap 6: Nonce Counter Persistence Across Reconnects

- Section 5.6.5 says counters reset to 0 on reconnect. If the same WebSocket connection drops and reconnects very quickly, there is a theoretical risk of nonce reuse if frames were in-flight during the drop.
- **Safer alternative:** Persist the last-used nonce counter and always start above it. But this adds state management complexity. Need to evaluate whether the theoretical risk justifies the complexity.

### Gap 7: VPS Provider Selection

- The locked decision says "single VPS first" but does not specify the provider. Options: Hetzner (cheapest, EU and US datacenters), DigitalOcean, Linode/Akamai, Vultr, OVH.
- Selection criteria: US East availability, Docker support, bandwidth pricing, reliability, SSH-based deploy simplicity.
