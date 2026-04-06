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

**OAuth (Google, GitHub, Apple):**
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
  last_heartbeat  TIMESTAMPTZ,
  registered_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_servers_user ON servers(user_id);
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

1. **`wss://broker.anyclaw.io/relay/client`** -- mobile app connects here. Auth via `Authorization: Bearer <session_token>` in the WebSocket upgrade request headers (supported by all WS clients).
2. **`wss://broker.anyclaw.io/relay/server`** -- AnyClaw server connects here. Auth via `server_token` query parameter in the upgrade URL (since the server-side WS client controls the URL).

### 3.2 Connection Establishment

1. Mobile app authenticates with the broker REST API, receives list of user's servers via `GET /servers` (returns server_id, name, status).
2. User selects a server (or auto-selects the only one).
3. Mobile app opens a WebSocket to `wss://broker.anyclaw.io/relay/client?server_id=srv_abc123`.
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
- **Broker placement:** Deploy the broker on a provider with good peering (Fly.io or Cloudflare Workers with Durable Objects). Fly.io allows multi-region deployment so the broker instance is geographically close to the user.
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

- **Broker REST API:** HTTPS only. TLS termination at the load balancer (Fly.io provides automatic Let's Encrypt certs for `*.fly.dev` and custom domains).
- **Broker WebSocket:** WSS (WebSocket over TLS). Same TLS termination.
- **Phase 1 relay:** Both legs (client-to-broker and broker-to-server) are WSS. The broker sees the decrypted frames but does not inspect or log them. For defense-in-depth, the client and server can negotiate an additional encryption layer (NaCl box with a shared secret derived during pairing), but this is a Phase 2+ enhancement -- TLS is sufficient for MVP.
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

Fly.io includes 100 GB free outbound per month. At 1,000 users, Phase 1 relay is very affordable. At 100,000 users it costs $720/mo in bandwidth alone -- still manageable but Phase 2 should be live well before then.

**Compute cost:** The relay is CPU-cheap (it is just copying bytes between sockets). A single Fly.io machine (shared-cpu-1x, 256 MB RAM, $1.94/mo) can handle ~500 concurrent WebSocket connections. At 1,000 users with ~30% concurrent, that is 300 connections -- one machine suffices.

### 6.2 Phase 2 Cost Reduction

With WebRTC P2P, the broker handles only signaling:
- **Signaling traffic:** ~5 KB per connection establishment (SDP + ICE candidates). This happens once per session (when the app opens), not per request.
- **TURN fallback:** Estimated 10-15% of connections fail P2P hole-punching and fall back to TURN. TURN bandwidth is comparable to Phase 1 relay but only for that 10-15%.
- **Net reduction:** ~85-90% bandwidth reduction at the broker. The 100,000-user scenario drops from $720/mo to ~$72-108/mo.

### 6.3 Horizontal Scaling Strategy

Phase 1 (MVP, <1,000 users): single broker instance on Fly.io. Postgres on Fly.io (single instance, daily backups).

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

- **Platform:** Fly.io. Reasons: WebSocket-friendly (no timeout limits), multi-region, cheap, good CLI/CD integration.
- **Container:** Single Dockerfile. Node.js 22 LTS Alpine image. The broker binary is ~50 MB including node_modules.
- **CI/CD:** GitHub Actions. On push to `main`: build Docker image, run tests, deploy to Fly.io via `flyctl deploy`.
- **Monitoring:** Fly.io built-in metrics + Prometheus endpoint in Fastify. Key metrics: active WS connections, relay bytes/sec, auth requests/sec, P95 latency, error rate.
- **Logging:** Structured JSON logs (pino, Fastify's default logger). Ship to Fly.io log drain or Axiom (free tier: 500 MB/mo).

### 7.5 File Structure

```
anyclaw-broker/
├── package.json
├── tsconfig.json
├── Dockerfile
├── fly.toml
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
│   │       └── 004_server_tokens.sql
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
│   └── signaling/
│       └── webrtc.test.ts
└── .env.example
```

---

## 8. Technical Decisions Needed

### Decision 1: Domain and TLS Certificate Strategy

The broker needs a stable domain (e.g., `broker.anyclaw.io`). Do we purchase `anyclaw.io` now and use Cloudflare for DNS, or use a `*.fly.dev` subdomain for MVP and add a custom domain later? Custom domain adds trust (mobile app hardcodes the broker URL) but costs ~$12/year and requires DNS management.

**Recommendation:** Buy the domain now. The mobile app will hardcode `broker.anyclaw.io` and changing it later requires an app update.

### Decision 2: OAuth Provider Priority

Which OAuth providers to support at launch? Options:
- **Google only** -- covers ~70% of mobile users. Simplest to implement.
- **Google + Apple** -- Apple Sign-In is required by App Store policy if any OAuth is offered. So if we ship Google, we must also ship Apple.
- **Google + Apple + GitHub** -- GitHub appeals to the developer audience likely to self-host.

**Recommendation:** Google + Apple at launch (App Store compliance), GitHub in the first update.

### Decision 3: Phase 2 Timing

When do we invest in WebRTC P2P? Options:
- **Build Phase 2 before launch** -- more engineering work upfront, but lower operating costs from day one.
- **Launch with Phase 1 only, add Phase 2 at 500 users** -- ship faster, accept relay costs early.
- **Launch with Phase 1, begin Phase 2 development immediately after launch** -- overlap approach.

The answer depends on how long Phase 2 development takes (estimate: 2-3 weeks for signaling + react-native-webrtc integration + fallback logic + TURN setup) and whether the early user base will be small enough that relay costs are negligible.

### Decision 4: Broker Hosting Region

Where to deploy the initial broker instance? Options:
- **`iad` (Ashburn, Virginia)** -- lowest latency for US East users, good peering.
- **`ord` (Chicago)** -- central US, balanced latency.
- **Multi-region from day one** -- Fly.io makes this easy but adds operational complexity (database replication, connection routing).

**Recommendation:** Start with `iad`. Add regions when user distribution data justifies it.

### Decision 5: End-to-End Encryption in Phase 1

Should Phase 1 implement an additional encryption layer on top of TLS, so the broker cannot read relayed traffic even in principle? This would use a shared secret established during the server pairing step (derive a NaCl box keypair, store the public key on both sides).

**Tradeoff:** Adds ~200 lines of crypto code on both client and server, negligible performance impact (NaCl is fast), but adds complexity to debugging (can't inspect relay traffic for diagnostics). In Phase 2, WebRTC provides E2E encryption by default, making this moot.

**Recommendation:** Skip for Phase 1. TLS is sufficient and the broker is our own infrastructure. Prioritize shipping speed. Phase 2's DTLS provides true E2E without extra work.
