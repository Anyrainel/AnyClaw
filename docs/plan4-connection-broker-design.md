# Plan 4: Connection Broker — Detailed Design

**Goal:** Build a lightweight cloud service that authenticates AnyRaven users, registers self-hosted server instances, and brokers connections between the mobile app and the user's host. The broker implements a phased tunnel strategy: **Phase 1 (launch): WSS relay with NaCl end-to-end encryption**, **Phase 2 (post-launch): WebRTC P2P with the broker reduced to signaling**.

**Guiding constraint:** The broker must be cheap to operate, stateless where possible, and must never be able to read the plaintext traffic it relays. In Phase 1 it forwards every byte between the mobile app and the user's host, so the design minimises per-user bandwidth and makes the transition to Phase 2 (P2P) a drop-in upgrade rather than a rewrite.

**Relationship to the user's host (process supervision, not containers):** Per the main spec's Process Architecture section, the user's side is a single host — one Docker container or a native install — running supervised processes: PocketBase, Tunnel Manager, Dispatch/MCP server, app-backend, and app-frontend server. The broker treats the user's side as a single endpoint: one persistent WSS connection per host, owned by the supervised **Tunnel Manager** process (`restart=always`). The broker relays opaque frames and does not know or care that multiple processes live behind the tunnel. Fan-out to the internal services (PocketBase on `127.0.0.1:8090`, Dispatch/MCP on `127.0.0.1:3000`, app-frontend on `127.0.0.1:4000`) is performed by the Tunnel Manager on the user's side, driven by an in-envelope `service` tag (see §7.4).

---

## 1. Overview

### 1.1 What the Broker Does

1. **Authenticates users** via OAuth (Google, Apple, GitHub — all three at launch, per spec decision #16).
2. **Issues broker JWTs** (15 minute access token + refresh endpoint) backed by opaque server-side session records (per spec decision #45).
3. **Registers self-hosted servers** against user accounts via a one-time pairing token with BIP39 MITM verification (per spec decision #32).
4. **Tracks server liveness** via heartbeats, surfacing `online` / `degraded` / `offline` state to the mobile app.
5. **Relays WSS traffic** between mobile clients and their paired hosts as opaque, NaCl-encrypted frames (Phase 1).
6. **Signals WebRTC** (Phase 2, post-launch) by forwarding SDP offers/answers and ICE candidates, then getting out of the data path.
7. **Runs coturn** for WebRTC TURN fallback (Phase 2).

### 1.2 What the Broker Does NOT Do

- **Never reads relay payloads.** All application-level traffic is NaCl-box encrypted end-to-end; the broker handles ciphertext only.
- **Never proxies unauthenticated requests.** No open relay. Every WS connection is tied to a session and a server the user owns.
- **Never stores user content.** Messages, tasks, code, DB contents live on the user's host. The broker only stores auth records, server metadata, and public keys.
- **Never holds long-term private keys for users or servers.** Private keys live in device secure storage / server filesystem only.
- **Never speaks HTTP to the user's host.** All traffic is tunneled over the one outbound WSS connection the Tunnel Manager opens. Zero inbound ports on the user's machine.
- **Never rotates NaCl keys automatically** in MVP (per spec decision #31). Device loss triggers a re-pair.
- **Does not host the agent, the coding workspace, or PocketBase.** Those are on the user's host.

---

## 2. Domain & Hosting

### 2.1 Domain

- **Apex domain:** `anyraven.com` (already purchased, per spec decision #15).
- **Broker hostname:** `broker.anyraven.com`.
- **DNS:** A/AAAA records point at the Hetzner VPS. TTL 300s for initial deployment, raise to 3600s once stable.
- **Wildcard TLS:** Not needed. Only one hostname for the broker. `broker.anyraven.com` covers REST + WSS on port 443.

### 2.2 VPS Provider: Hetzner (spec decision #44)

- **Location:** Hetzner US East (Ashburn, VA) datacenter — best peering for the initial US East user base (spec decision #18).
- **Initial size:** CX22 (2 vCPU shared, 4 GB RAM, 40 GB NVMe, 20 TB bandwidth). ~€5/mo. Sufficient for ~500 concurrent WS connections and <10,000 registered users.
- **Scale path:** Vertical first — CX32 (4 vCPU, 8 GB) then CX42 (8 vCPU, 16 GB). Horizontal when a single box saturates (see §12).
- **OS:** Ubuntu 24.04 LTS. cgroup v2 delegation enabled by default (matches the host-side systemd-user requirement from spec decision #25).

### 2.3 TLS: Caddy + Let's Encrypt

- **Reverse proxy:** Caddy 2.x listening on 443, fronting the Fastify broker on `127.0.0.1:8080`.
- **Certificates:** Automatic Let's Encrypt via Caddy's built-in ACME client. HTTP-01 challenge on port 80 with auto-redirect to 443.
- **WebSocket upgrade:** Caddy passes WS upgrades transparently; no special configuration needed beyond `reverse_proxy` (Caddy handles `Upgrade` and `Connection` headers automatically).
- **HSTS:** `max-age=31536000; includeSubDomains; preload`.

**Caddyfile:**

```caddy
broker.anyraven.com {
    encode gzip zstd
    reverse_proxy 127.0.0.1:8080
    header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    log {
        output file /var/log/caddy/broker.log
        format json
    }
}
```

### 2.4 Deployment Topology

```
Hetzner CX22 (broker.anyraven.com)
├── Caddy          (443 → 127.0.0.1:8080, auto TLS)
├── Fastify broker (Node 22 LTS, PM2-supervised)
├── Postgres 16    (local, unix socket, daily pg_dump to off-box storage)
├── Redis 7        (local, for rate limiting + relay connection map; see §12)
└── coturn         (Phase 2: UDP 3478, TLS 5349)
```

All five run under systemd on the host (no Docker Compose for MVP — simpler ops, tighter integration with journald/logrotate). The Fastify broker process is managed by `pm2-runtime` behind a systemd unit to get restart-on-failure + zero-downtime reload.

### 2.5 CI/CD

- **Source:** GitHub monorepo subdirectory `broker/`.
- **Pipeline:** GitHub Actions — on push to `main`: `pnpm install` → `pnpm test` → `pnpm build` → `rsync` the compiled JS + `package.json` to the VPS → `systemctl reload anyraven-broker.service`.
- **Migrations:** `pnpm migrate` step runs before reload. Migrations are forward-only SQL files under `src/db/migrations/`.
- **Rollback:** Previous build kept in `/opt/anyraven-broker/releases/<sha>/`. `systemctl reload` swaps the symlink. Rollback = swap symlink back + `systemctl reload`.

---

## 3. Auth System

### 3.1 Identity Provider: Lucia Auth v3

- **Library:** [`lucia`](https://lucia-auth.com) v3 (MIT, TypeScript, framework-agnostic) with a Postgres adapter.
- **Responsibilities:** password hashing (argon2id), opaque session token generation, cookie/header extraction. Everything else (OAuth, JWT issuance, refresh endpoints) is custom code in the broker.
- **Why Lucia:** thin, well-audited, and specifically designed to *not* impose framework conventions. It plays well with Fastify and with our "opaque session token on the server, short-lived JWT for the mobile client" model.

**Alternatives rejected:**
- **Auth.js (NextAuth)** — tightly coupled to Next.js, session model optimised for browser cookies not mobile bearer tokens.
- **Clerk / Auth0 / Supabase Auth** — external dependency cost, vendor lock-in for an auth-critical path, and we need custom pairing/JWT logic anyway.

### 3.2 OAuth-Only Registration (No Email/Password)

Per spec decision #16, the MVP ships with **OAuth only**: Google, Apple, GitHub. No email/password registration. This eliminates the email verification, password reset, and credential stuffing attack surfaces entirely. A later release may add email/password for users without any of the three providers; Lucia supports it natively.

### 3.3 JWT Model (Broker-Issued) — per spec decision #45

After OAuth validation, the broker issues its **own** JWT, decoupled from the upstream provider's access token:

- **Access token:** JWT, HS256-signed with a 256-bit server secret, 15 minute expiry. Carries `{ sub: user_id, sid: session_id, exp }`. Used as `Authorization: Bearer <jwt>` on every REST and WSS request.
- **Refresh token:** opaque 256-bit random, stored server-side in the `sessions` table. Returned once at login, persisted by the mobile app in `expo-secure-store`. Used against `POST /auth/refresh` to mint a new access token.
- **Revocation:** delete the session row → all future refresh attempts fail. Access tokens live for at most 15 minutes after revocation, which is the explicit tradeoff for statelessness on hot-path requests.
- **Provider refresh tokens:** Broker persists upstream provider refresh tokens server-side (encrypted, see §11) so the broker can re-validate user identity on long gaps. They never leave the broker.

### 3.4 Multi-Device Support

Each login creates a separate `sessions` row (one per device). There is no "device registration" step; logging in on a second phone produces a second session. Users can list and revoke sessions from the mobile app settings:

- `GET /auth/sessions` — list active sessions with `device_name`, `last_active`, `ip_address` (coarse, for audit).
- `POST /auth/logout` — revoke the current session.
- `POST /auth/logout-all` — revoke every session for the user (lost phone).

The mobile app stores the refresh token in `expo-secure-store` (iOS Keychain, Android Keystore).

---

## 4. OAuth Flow Detail

All three providers follow the same shape: **authorization code flow with PKCE**, initiated from the mobile app via `expo-auth-session`, with the broker acting as the OAuth client and issuing its own JWT on success.

### 4.1 Common Flow

```
Mobile App              Broker                 OAuth Provider
    |                     |                         |
 1. |-- GET /auth/oauth/:provider/start ----------->|
    |   (PKCE challenge generated on mobile)        |
    |                     |                         |
 2. |<-- 302 to provider consent URL ---------------|
    |   (with state, code_challenge, redirect_uri)  |
    |                     |                         |
 3. |== user approves in AuthSession browser ======>|
    |                     |                         |
 4. |<-- 302 to broker/auth/oauth/:provider/callback
    |                     |                         |
 5. |                     |-- POST /token --------->|
    |                     |   (code + verifier)     |
    |                     |<-- access + refresh ----|
    |                     |   + id_token            |
    |                     |                         |
 6. |                     |-- verify id_token       |
    |                     |   upsert user           |
    |                     |   create session        |
    |                     |   mint broker JWT       |
    |                     |                         |
 7. |<-- 302 to anyraven://auth/success#jwt=...&rt=...
    |   (deep link back to mobile app)              |
    |                     |                         |
 8. |-- POST /auth/exchange -----------------------
    |   (short-lived one-time code → JWT + refresh) |
```

Step 7 returns a one-time **exchange code** in the deep link rather than the JWT directly (deep link query parameters can leak to other apps). The mobile app immediately POSTs the code to `/auth/exchange` over HTTPS to retrieve the real JWT + refresh token pair.

### 4.2 Google

- **Endpoint:** `https://accounts.google.com/o/oauth2/v2/auth` (authorization), `https://oauth2.googleapis.com/token` (token).
- **Scopes:** `openid email profile`.
- **ID token verification:** JWKS from `https://www.googleapis.com/oauth2/v3/certs`, cached 24h. Verify `iss` = `https://accounts.google.com`, `aud` = Google client ID, `exp` > now.
- **User identity:** `sub` claim (stable Google user ID). Email from `email` claim.

### 4.3 Apple

- **Endpoint:** `https://appleid.apple.com/auth/authorize`, `https://appleid.apple.com/auth/token`.
- **Scopes:** `name email`.
- **Client secret:** Apple requires a **JWT-signed client secret** (not a static string). The broker signs a short-lived ES256 JWT with the Apple private key (`AuthKey_XXX.p8`) every time it calls `/auth/token`. Key ID, team ID, and private key stored as environment variables.
- **ID token verification:** JWKS from `https://appleid.apple.com/auth/keys`. Verify `iss` = `https://appleid.apple.com`.
- **First-login quirk (spec decision #46):** Apple only returns the user's name and email in the **first** authorization callback. Subsequent logins return only the `sub` claim. The broker must persist `name` and `email` into the `users` row on the first callback; on subsequent logins, the row is looked up by `(provider='apple', provider_user_id=sub)` and the existing name/email are reused. Missing this quirk produces anonymous accounts — the code path is covered by integration tests that simulate the second-login behaviour.
- **User identity:** `sub` claim. Email may be a relay email (`@privaterelay.appleid.com`) if the user chose "Hide My Email"; store it as-is.

### 4.4 GitHub

- **Endpoint:** `https://github.com/login/oauth/authorize`, `https://github.com/login/oauth/access_token`.
- **Scopes:** `read:user user:email`.
- **No ID token:** GitHub does not implement OIDC. After the token exchange, the broker calls `GET https://api.github.com/user` with the access token to retrieve the user profile, and `GET https://api.github.com/user/emails` to retrieve the primary verified email.
- **User identity:** `id` field (numeric GitHub user ID). Email: the one with `primary: true && verified: true`.

### 4.5 Refresh Endpoint

```
POST /auth/refresh
Body: { refresh_token: "<opaque-token>" }

→ 200 { access_token: "<jwt>", access_token_expires_in: 900 }
→ 401 { error: "invalid_refresh_token" }   (row deleted or never existed)
→ 401 { error: "expired" }                 (session row past expires_at)
```

The refresh token itself is **not rotated** on each use (keeps mobile logic simple). Sliding expiry: each successful refresh sets `sessions.last_active = now()` and extends `expires_at` to `now() + 30 days`.

---

## 5. Server Registration

### 5.1 Pairing Overview

A "server" in broker terminology is the user's entire AnyRaven host (one row per host, not per process). The Tunnel Manager process on the host owns the relationship: it holds the `server_token`, maintains the WSS connection, and presents the host to the broker.

### 5.2 Registration Flow

1. Install script runs on the user's host. It generates the host's X25519 long-lived keypair `(server_pk, server_sk)`, storing `server_sk` at `/data/.anyraven/server.key` with mode `0600` (owned by `anyraven-infra` user).
2. User completes the pairing flow (§6) in the mobile app, which provides the host with a `server_token`, the user's device public key `mobile_pk`, and a `broker_url`.
3. Tunnel Manager writes these to its config file, then opens `wss://broker.anyraven.com/relay/server?token=<server_token>`.
4. On first successful connect, the Tunnel Manager sends an in-band registration frame:
   ```json
   {
     "type": "register",
     "server_token": "<base64url>",
     "server_pk": "<base64url X25519 public key>",
     "server_name": "my-home-server",
     "version": "0.3.1",
     "capabilities": ["pocketbase", "dispatch", "app-frontend"]
   }
   ```
5. The broker validates `server_token` against the `server_tokens` table, upserts a row in `servers`, stores `server_pk`, marks the token as `claimed`, and returns:
   ```json
   {
     "type": "registered",
     "server_id": "<uuid>",
     "heartbeat_interval_ms": 30000
   }
   ```
6. The broker also relays the `server_pk` to the mobile app the next time it calls `GET /servers` so the app can derive the NaCl shared secret (see §8.3).

### 5.3 Heartbeat Protocol

Heartbeats flow over the **existing** Tunnel Manager WSS connection. No separate HTTP polling.

**Server → Broker (every 30s):**
```json
{
  "type": "heartbeat",
  "uptime_s": 3600,
  "active_connections": 1,
  "cpu_pct": 12,
  "mem_mb": 256,
  "version": "0.3.1"
}
```

**Broker → Server (ack):**
```json
{
  "type": "heartbeat_ack",
  "timestamp": "2026-04-06T12:00:00Z",
  "pending_clients": 0
}
```

`pending_clients` is the number of mobile connections currently waiting to speak to this server — it lets the host spin up resources (e.g. warm up Vite dev) before the first data frame arrives.

### 5.4 Liveness State Machine

| State      | Entry condition                                   | Mobile UI          |
|------------|---------------------------------------------------|--------------------|
| `online`   | Heartbeat received within the last 90s            | Green dot          |
| `degraded` | No heartbeat for 90s (but WSS still open)         | Yellow dot         |
| `offline`  | No heartbeat for 180s OR WSS closed               | Red dot, reconnect |

Transitions happen in a single background job (`health-checker`) that runs every 15s: `UPDATE servers SET status=... WHERE ...`. When status changes, the broker pushes a `server_status` control message to any connected mobile clients for that user so the UI reflects the new state within seconds.

---

## 6. Pairing UX

**Goal:** A brand new host and a brand new phone can be paired in under a minute with cryptographic MITM protection that the user visually confirms.

### 6.1 Token + Key Generation

1. User taps "Add server" in the mobile app.
2. App calls `POST /servers/pair/start` (authenticated). The broker creates a `server_tokens` row:
   - `token`: 256-bit random, base64url.
   - `user_id`: the authenticated user.
   - `claimed`: false.
   - `expires_at`: now + 24h.
3. Broker returns `{ server_token, broker_url: "wss://broker.anyraven.com/relay/server" }`.
4. App locally generates the device's X25519 long-lived keypair `(mobile_pk, mobile_sk)` via `libsodium-wrappers` and stores `mobile_sk` in `expo-secure-store` keyed by a placeholder `pending_pair_id` (rekeyed once the real `server_id` is known).
5. App constructs a pairing payload:
   ```json
   {
     "server_token": "<base64url>",
     "mobile_pk": "<base64url>",
     "broker_url": "wss://broker.anyraven.com/relay/server"
   }
   ```
6. App encodes the JSON as a QR code (mobile-side, no broker involvement) and also offers "copy as text" for users pairing a host they're SSH'd into.

### 6.2 Host-Side Claim

1. On the host, the user runs `anyraven pair` (an install-script-provided command).
2. The CLI either scans the QR via a terminal QR reader (`zbarimg` if an image is piped in), or accepts the pasted text.
3. The CLI writes the token + `mobile_pk` + `broker_url` into `/data/.anyraven/tunnel.conf`.
4. The CLI loads the already-generated `server_sk` and `server_pk` from `/data/.anyraven/server.key`.
5. The CLI computes the NaCl shared secret:
   ```
   shared_secret = X25519(server_sk, mobile_pk)
   ```
6. The CLI derives the 4-word BIP39 verification code from the shared secret:
   ```
   code = first_4_words_of_BIP39(first_44_bits_of_SHA256(shared_secret))
   ```
   This produces a code like `"ocean marble forest piano"`. Entropy = 44 bits — sufficient to defeat online MITM but short enough for a human to read aloud.
7. The CLI prints the code and the message: *"Confirm this code matches the one shown in your phone."*
8. The CLI then starts the Tunnel Manager (systemd unit), which opens the WSS connection and sends its `register` frame.

### 6.3 Mobile-Side Confirmation

1. Immediately after showing the QR, the mobile app polls `GET /servers/pair/status?token=<token>` every 2 seconds.
2. When the broker reports `claimed`, the app fetches the newly-registered `server_pk` via the same endpoint.
3. The app computes `shared_secret = X25519(mobile_sk, server_pk)` and derives the same 4-word BIP39 code.
4. The app displays: *"Does your server show: **ocean marble forest piano**?"* with **Confirm** and **Cancel** buttons.
5. **Confirm** → the app persists `(server_id, server_pk, mobile_sk, mobile_pk)` in secure storage, keyed by `server_id`. The pairing is now complete and the device can begin relaying.
6. **Cancel** → the app calls `DELETE /servers/:id` to remove the registration. The user can retry pairing.

**Why BIP39 (spec decision #32):** identical to the short-authentication-string pattern used by Signal, Threema, and WhatsApp. The 44-bit entropy provides ~17 trillion possible codes — an attacker running a MITM would need to brute force `server_pk` such that the derived code matches the victim's `mobile_pk` derivation, which requires on the order of `2^44` X25519 operations per target user.

---

## 7. Phase 1: WSS Relay

### 7.1 Endpoints

The broker exposes two WebSocket listeners under `broker.anyraven.com`:

| Endpoint                    | Caller                 | Auth                                           |
|-----------------------------|------------------------|------------------------------------------------|
| `/relay/client`             | Mobile app             | `Authorization: Bearer <jwt>` + `?server_id=`  |
| `/relay/server`             | Tunnel Manager on host | `?token=<server_token>` query param            |

The broker keeps two in-memory maps (both backed by Redis pub/sub when running multiple broker instances — see §12):

- `serverConnections: Map<server_id, WebSocket>` — one entry per registered host currently connected.
- `clientConnections: Map<client_id, { ws: WebSocket, server_id: string, user_id: string }>` — one entry per live mobile client.

### 7.2 Connection Establishment

1. Mobile app calls `GET /servers` over HTTPS → receives `[{ server_id, name, status, server_pk }]`.
2. User selects a server. The app opens `wss://broker.anyraven.com/relay/client?server_id=<id>` with `Authorization: Bearer <jwt>`.
3. Broker validates the JWT, confirms `server_id` belongs to the authenticated user, assigns a random `client_id`.
4. Broker looks up the server's WSS connection in `serverConnections`. If missing or `status != online` → broker closes the client WS with code `4001` reason `"server_offline"`.
5. If present, broker sends a control frame to the host:
   ```json
   { "type": "connection_request", "client_id": "c_abc123", "session_id": "<jwt-sid>" }
   ```
6. Host responds:
   ```json
   { "type": "connection_accept", "client_id": "c_abc123" }
   ```
7. Broker now treats `(client_ws, server_ws, client_id)` as a routable pair. All subsequent data frames from either side tagged with this `client_id` are forwarded through.

### 7.3 Multiplexing: In-Envelope Service Tag

Per spec decision #43, the Tunnel Manager demultiplexes across **three** internal services using an in-envelope `service` tag. The envelope is the **only** thing in the clear (aside from the control messages above) — the `payload` is the NaCl-encrypted blob.

**Data frame envelope (wire format):**

```typescript
// Binary frame, preamble is CBOR (chosen over JSON to save bytes for high-frequency frames):
// [0]         version byte = 0x01
// [1..=2]     envelope length (uint16 LE)
// [3..]       CBOR envelope { type, client_id, service, stream_id, flags }
// [N..]       encrypted payload: [24-byte nonce][ciphertext+MAC]
```

The envelope fields:

| Field       | Type     | Meaning                                                               |
|-------------|----------|-----------------------------------------------------------------------|
| `type`      | string   | `"data"`, `"stream_open"`, `"stream_close"`, `"stream_error"`         |
| `client_id` | string   | Demultiplexes across mobile clients on the host side                  |
| `service`   | enum     | `"pb"` (PocketBase), `"api"` (Dispatch/MCP), `"app"` (app-frontend)    |
| `stream_id` | uint32   | Per-`client_id` logical HTTP/SSE stream identifier                    |
| `flags`     | bitfield | `END_STREAM` bit for HTTP request/response delimiting                 |

**Why both `client_id` AND `service`:** `client_id` handles "multiple phones on one account", while `service` handles "which internal process on the host handles this frame". Both dimensions are needed and neither can be inferred from the other.

**Why `stream_id`:** the host-side Tunnel Manager holds long-lived HTTP connections to PocketBase and Dispatch/MCP (for SSE subscriptions). A single client can have multiple concurrent streams (e.g. one PocketBase REST call in flight while an SSE subscription is open). `stream_id` lets the client demultiplex responses to the right request handler without waiting for the previous stream to close.

### 7.4 Tunnel Manager Routing Table

On the host side, the Tunnel Manager handles an incoming encrypted frame as follows:

```
on_frame(envelope, ciphertext):
    if envelope.client_id not in known_clients:
        send stream_error(client_id, reason="unknown_client")
        return

    plaintext = nacl.box.open(ciphertext, envelope.nonce, mobile_pk[client_id], server_sk)

    match envelope.service:
        "pb"  -> forward to 127.0.0.1:8090 (PocketBase)
        "api" -> forward to 127.0.0.1:3000 (Dispatch/MCP server)
        "app" -> forward to 127.0.0.1:4000 (app-frontend server)

    on response from internal service:
        ciphertext = nacl.box(response_bytes, next_nonce, mobile_pk[client_id], server_sk)
        send frame with same client_id, service, stream_id
```

This table is fixed at build time. There are no subdomains, no Host headers, no DNS tricks — just a three-way switch inside the Tunnel Manager. The same routing applies unchanged when Phase 2 WebRTC replaces the broker relay; only the transport changes, not the envelope format.

### 7.5 Binary Passthrough

Both the client-side and the broker-side forwarding paths are **byte-for-byte copy loops**. The broker never parses the CBOR envelope; it only reads the `client_id` from a fixed offset in the preamble (uint16 length + CBOR tag scan for the `client_id` field) to look up the destination connection. This is a ~150-line hot loop and is the only code on the broker that touches per-frame data.

### 7.6 Reconnection

**Client-side (mobile):**
1. On WS close / error, app waits 1s then retries.
2. Exponential backoff: 1s, 2s, 4s, 8s, 16s, cap 30s. Jitter: ±25%.
3. On reconnect: broker assigns a new `client_id`, host treats it as a fresh session. In-flight requests are lost; the PocketBase JS SDK's auto-retry handles it.
4. If the app was backgrounded, reconnect happens on foreground. `expo-task-manager` is explicitly NOT used for background WS (battery-draining and unreliable per Expo docs).

**Server-side (host Tunnel Manager):**
1. On WS close, supervisord/systemd keeps the process alive (`restart=always`) and it reconnects with the same backoff schedule.
2. During the reconnect gap, all currently-attached mobile clients see their pipes collapse and enter their own reconnect loops.
3. When the host reconnects, broker sends a `server_reconnected` control frame to any waiting mobile clients and the pipes re-establish.

### 7.7 Backpressure

- Each WS has a 1 MB send buffer cap.
- When the downstream buffer exceeds 1 MB, the broker pauses `.read()` on the upstream socket (Node.js `ws` library: `socket.pause()`). TCP backpressure propagates naturally to the other end.
- Resume when the buffer drains below 512 KB.
- If the buffer hits 4 MB (downstream peer completely stuck), the broker closes both legs with code `1009` (message too big / policy violation) to free memory.

### 7.8 Keepalive

Both WS directions use protocol-level ping frames every 15 seconds. If no pong is received within 10 seconds, the connection is considered dead and torn down. This is entirely handled by the `ws` library (`ws.ping()` + `ws.on('pong', ...)`).

---

## 8. NaCl End-to-End Encryption

### 8.1 Primitives

- **Key agreement:** X25519 (Curve25519 ECDH).
- **AEAD:** XSalsa20-Poly1305, via `nacl.box` (high-level NaCl construction).
- **Nonce:** 24 bytes, counter-based with direction prefix (see §8.4).
- **Library (both sides):** [`libsodium-wrappers`](https://www.npmjs.com/package/libsodium-wrappers) (WASM build of libsodium — spec decision #30). Runs identically under Node.js on the host and under Hermes/JSC in React Native. No native modules to build for Expo prebuild.

### 8.2 Key Lifecycle (spec decision #31)

- **Mobile device key `(mobile_pk, mobile_sk)`:** generated during pairing (§6.1). Long-lived. Stored in `expo-secure-store` keyed by `server_id`. **Never rotated in MVP.**
- **Host key `(server_pk, server_sk)`:** generated during install. Long-lived. Stored at `/data/.anyraven/server.key` mode 0600. **Never rotated in MVP.**
- **Shared secret `S = X25519(mobile_sk, server_pk) = X25519(server_sk, mobile_pk)`:** derived on demand, cached in memory.
- **Device loss:** user revokes the session (§3.4) then re-pairs. The broker stores only public keys, so revocation is a single row delete in `device_keys`.

Forward secrecy, ephemeral keys, double-ratchet, periodic rotation — all **out of scope for MVP** per the locked decision.

### 8.3 Key Exchange Sequence Diagram

```
Mobile App                    Broker                     User's Host
    |                           |                              |
1.  | POST /servers/pair/start -|                              |
    |   (JWT)                   |                              |
    |<- server_token -----------|                              |
    |                           |                              |
2.  | libsodium.crypto_box_     |                              |
    |   keypair()               |                              |
    |   → (mobile_pk, mobile_sk)|                              |
    |   store mobile_sk in      |                              |
    |   expo-secure-store       |                              |
    |                           |                              |
3.  | [QR: token + mobile_pk]   |                              |
    |===========================|=========> user scans ========|
    |                           |                              |
4.  |                           |      load server_sk from     |
    |                           |      /data/.anyraven/         |
    |                           |      server.key              |
    |                           |                              |
5.  |                           |      crypto_scalarmult(      |
    |                           |        server_sk, mobile_pk) |
    |                           |        → shared_secret       |
    |                           |      derive 4-word BIP39     |
    |                           |      print to terminal       |
    |                           |                              |
6.  |                           |<- WSS /relay/server ---------|
    |                           |   register{ token,           |
    |                           |     server_pk, name, ... }   |
    |                           |                              |
    |                           |-> registered{server_id} ----|
    |                           |                              |
7.  | GET /servers/pair/status -|                              |
    |<- claimed:true,           |                              |
    |   server_id, server_pk ---|                              |
    |                           |                              |
8.  | crypto_scalarmult(        |                              |
    |   mobile_sk, server_pk)   |                              |
    |   → shared_secret         |                              |
    | derive 4-word BIP39       |                              |
    | display "confirm code"    |                              |
    |                           |                              |
9.  | user visually confirms    |                              |
    | codes match → persist     |                              |
    | (server_id, server_pk)    |                              |
    |                           |                              |
    | === pairing complete ===  |                              |
```

**Broker's view throughout:** `mobile_pk` (public), `server_pk` (public). It never sees `mobile_sk` or `server_sk`. Computing the shared secret requires at least one private key. Therefore the broker cannot derive `S` and cannot decrypt any frame.

### 8.4 Encrypted Frame Format

Every data frame payload (everything under the `service`-tagged envelope in §7.3) is encrypted:

```
[nonce: 24 bytes][ciphertext: plaintext_len + 16 bytes]
```

- Nonce is in the clear so the receiver can decrypt.
- The 16-byte Poly1305 MAC is prepended to the ciphertext by `nacl.box` automatically.
- Per-frame overhead: 24 (nonce) + 16 (MAC) = **40 bytes**. Negligible against typical 1-10 KB payloads.

**Sender:**
```typescript
const nonce = nextNonce(direction);     // see §8.5
const ct    = sodium.crypto_box_easy(plaintext, nonce, peerPk, mySk);
ws.send(Buffer.concat([nonce, ct]));
```

**Receiver:**
```typescript
const nonce = frame.subarray(0, 24);
const ct    = frame.subarray(24);
try {
  const pt = sodium.crypto_box_open_easy(ct, nonce, peerPk, mySk);
  dispatch(pt);
} catch (e) {
  log.warn({ client_id, envelope }, "nacl_decrypt_failed");
  // do NOT close the connection — could be in-flight corruption; let the next frame through
}
```

### 8.5 Nonce Management

Nonces must never repeat for the same keypair. Strategy: **counter-based with direction prefix**.

- **Mobile → host:** `nonce[0] = 0x01`, `nonce[1..=23]` = big-endian counter, starting at 0.
- **Host → mobile:** `nonce[0] = 0x02`, `nonce[1..=23]` = big-endian counter, starting at 0.

The direction prefix guarantees the two sides cannot collide even though both counters start at zero. The 23-byte counter (2^184 values) cannot overflow in practice.

**Across reconnects:** each side persists its "last used counter" in memory across WS reconnects **within a single app run**. On app cold start / host restart, the counter resets to 0 — but because NaCl box uses the direction prefix and we generate a **new ephemeral scope per session** (by mixing the session ID into the first byte after the direction prefix), reuse across cold starts is precluded:

```
nonce[0]    = direction (0x01 or 0x02)
nonce[1..5] = uint32 session epoch (incremented on every cold start, persisted)
nonce[5..24] = counter
```

Session epoch is persisted on the host at `/data/.anyraven/nonce-epoch` and in `expo-secure-store` on mobile. Cold start reads, increments, writes back, then uses the new value. This closes the theoretical reconnect-collision hole without requiring tight counter persistence on every frame.

### 8.6 What is NOT Encrypted (per spec decision #33)

- **Control frames** (`connection_request`, `connection_accept`, `heartbeat`, `server_status`, `stream_open`, `stream_close`): cleartext within the TLS tunnel. The broker must read these to route.
- **The in-envelope `service` tag and `client_id`**: cleartext for the same reason.
- **The prod static server's HTML/CSS/JS assets (`service: "app"`):** traffic is still wrapped in NaCl per the same envelope rules; spec decision #33 notes that the assets are "public-ish" but they still flow through the encrypted envelope in the MVP for implementation simplicity. A later optimisation may skip encryption for `service: "app"` responses to save CPU on the host.

### 8.7 Debug Mode (spec decision #34)

An opt-in toggle in mobile app settings labelled *"Developer: log decrypted traffic locally"*. When enabled:

- The mobile client writes decrypted frames to a rolling local log file (capped at 10 MB).
- The log file is visible only to the mobile app; it is never uploaded, never sent to the broker, and is wiped on logout.
- The host side has a symmetric env var `ANYRAVEN_DEBUG_DECRYPTED_LOG=1` that logs to `/data/.anyraven/debug/decrypted.log`.

This gives developers a troubleshooting path for connectivity issues without compromising the default privacy model.

---

## 9. Phase 2: WebRTC P2P (Post-Launch)

**Timing:** Launch ships with Phase 1 only (spec decision #17). Phase 2 development begins after launch. This section is deliberately lighter than Phase 1 — the design is locked enough to guarantee Phase 1 does not paint us into a corner.

### 9.1 Goal

Eliminate the broker from the data path. The broker becomes a signaling server only — it forwards SDP offers/answers and ICE candidates, then gets out of the way. Content flows directly between the mobile device and the host via an encrypted WebRTC data channel.

### 9.2 Signaling Over Existing WSS

The same WSS connections used for Phase 1 relay carry Phase 2 signaling messages. No new endpoints. The broker routes them identically to data frames, but the envelope `type` is `"signal_offer"`, `"signal_answer"`, or `"ice_candidate"`:

```typescript
{ type: "signal_offer",   client_id, sdp }
{ type: "signal_answer",  client_id, sdp }
{ type: "ice_candidate",  client_id, candidate, sdpMid, sdpMLineIndex }
{ type: "signal_complete",client_id, connection_type: "direct" | "relay" }
```

The `connection_type` field lets the broker record whether a TURN fallback was needed so we can measure P2P success rate.

### 9.3 React Native WebRTC

- **Library:** `react-native-webrtc` with the official Expo config plugin `@config-plugins/react-native-webrtc`.
- **Build:** `expo prebuild` + `eas build`. Not Expo Go. Development builds are required.
- **Host side:** Node.js `wrtc` (native addon built against libwebrtc). Compatible with Debian/Ubuntu binary packages — ships in our Docker image.

### 9.4 STUN / TURN

- **STUN:** Google public servers (`stun:stun.l.google.com:19302`, plus two fallback Cloudflare STUN endpoints).
- **TURN:** Self-hosted **coturn** on the same Hetzner VPS as the broker. coturn uses `--use-auth-secret` mode: the broker generates short-lived credentials (6 hour expiry) derived from a shared HMAC secret. Each `GET /servers` response includes current TURN credentials for the client and the host.
- **Cost:** ~10-15% of sessions fall back to TURN (industry norm for mixed consumer NAT). TURN bandwidth cost is comparable to Phase 1 relay but only for that minority.

### 9.5 Data Channel

Single reliable, ordered data channel named `"anyraven"`:
```typescript
pc.createDataChannel("anyraven", { ordered: true, maxRetransmits: null });
```

It carries the same framing format as Phase 1 (CBOR envelope + NaCl ciphertext). The Tunnel Manager on the host fans out to PocketBase/Dispatch/Prod exactly as in Phase 1 — the `service` tag and routing table are unchanged. DTLS (mandatory in WebRTC) provides transport-layer encryption; NaCl provides the E2E layer **above** DTLS so the design is uniform across Phase 1 and Phase 2 and the user's privacy guarantee survives a hypothetical TURN server compromise.

### 9.6 Fallback

- If WebRTC fails to establish within 10 seconds (ICE gathering + connectivity checks), the client transparently falls back to Phase 1 WSS relay.
- If a P2P channel is established but later drops for more than 5 seconds, fall back to WSS.
- The user sees a brief spinner but no manual intervention.
- The broker exposes a metric (`p2p_success_ratio`) so we can track regional patterns.

---

## 10. Security Model

### 10.1 Transport Security

- **REST + WSS:** HTTPS/WSS only. TLS 1.2+ via Caddy + Let's Encrypt. HSTS preload.
- **Phase 1:** TLS (transport) + NaCl box (E2E). Broker never sees plaintext. A broker compromise leaks metadata (who connected to what, when, how much data), not content.
- **Phase 2:** DTLS 1.2 (WebRTC mandatory) + NaCl box (E2E). Broker doesn't see data at all after signaling.

### 10.2 Authorisation

Every request is scoped to the authenticated user. Middleware enforces:

- JWT is valid, not expired, matches an active session.
- Any `server_id` the caller references belongs to `user_id` from the JWT.
- `server_tokens` are single-use and single-user.
- No admin API. Operational queries go through SSH + psql with audit logging in `pg_audit`.

### 10.3 Rate Limiting

Sliding-window counters in Redis (single key per `(ip, endpoint)` or `(user_id, endpoint)`):

| Endpoint                         | Limit                    | Window |
|----------------------------------|--------------------------|--------|
| `GET /auth/oauth/:provider/start`| 20 / IP                  | 1h     |
| `POST /auth/exchange`            | 20 / IP                  | 1h     |
| `POST /auth/refresh`             | 60 / session             | 1h     |
| `POST /servers/pair/start`       | 10 / user                | 1h     |
| `GET /servers/pair/status`       | 120 / user               | 5m     |
| `/relay/client` connects         | 5 concurrent / user      | —      |
| `/relay/server` connects         | 1 concurrent / server    | —      |
| Frames on any WS                 | 1000/sec (then backpressure) | —  |

### 10.4 Bandwidth Caps

- **Phase 1:** 1 GB/day per user of relay traffic. On exceed, broker sends a `rate_limited` control frame and closes the relay for 1 hour. Users hitting this are surfaced in the mobile app UI with *"Relay bandwidth exhausted — upgrade to direct P2P"* once Phase 2 ships.
- **Phase 2:** no cap (P2P doesn't touch broker bandwidth). TURN fallback traffic counts against a separate 5 GB/day cap.

### 10.5 Abuse Prevention

- **No open relay:** broker only forwards between authenticated users and their own registered servers. Connection attempts for other users' servers return 403.
- **Connection limits:** max 3 concurrent devices per user, max 2 registered servers per user (raise via support for early adopters).
- **IP blocklist:** >50 failed OAuth callbacks in 1 hour → block IP for 24h at the Caddy layer (`fail2ban`-style, maintained by a periodic SQL query).
- **Pairing token expiry:** 24h for unclaimed, single-use, deleted on claim.

### 10.6 Server Zero-Port Guarantee

The user's host **never listens on a public port**. The Tunnel Manager initiates an outbound WSS connection to the broker. All traffic flows over this single outbound connection. The host's firewall can `DROP` everything inbound. In Phase 2, WebRTC ICE also uses outbound-initiated UDP/TCP to STUN/TURN — still no inbound port required. This is the architectural property that lets AnyRaven run behind consumer NAT / carrier-grade NAT / corporate firewalls without any manual configuration.

---

## 11. Database Schema

Everything lives in a single Postgres 16 database on the broker VPS. All tables use `UUID` primary keys and `TIMESTAMPTZ` for timestamps.

### 11.1 `users`

```sql
CREATE TABLE users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT         UNIQUE,              -- nullable (Apple relay, etc.)
    display_name  TEXT,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);
```

### 11.2 `oauth_accounts`

Links one user to one or more OAuth providers. A user who signed up with Google can later link GitHub without duplicating the account.

```sql
CREATE TABLE oauth_accounts (
    provider              TEXT        NOT NULL,     -- 'google' | 'apple' | 'github'
    provider_user_id      TEXT        NOT NULL,
    user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_refresh_enc  BYTEA,                    -- AES-256-GCM, nullable (github doesn't give one)
    provider_scopes       TEXT[]      NOT NULL DEFAULT '{}',
    linked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX oauth_accounts_user_idx ON oauth_accounts(user_id);
```

### 11.3 `sessions`

```sql
CREATE TABLE sessions (
    id             TEXT         PRIMARY KEY,        -- opaque base64url, 32 random bytes
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name    TEXT,                            -- from User-Agent / custom header
    device_os      TEXT,                            -- 'ios' | 'android'
    ip_address     INET,
    refresh_token  TEXT         NOT NULL UNIQUE,    -- 32 random bytes, base64url
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_active    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ  NOT NULL
);

CREATE INDEX sessions_user_idx         ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx   ON sessions(expires_at);
CREATE INDEX sessions_refresh_idx      ON sessions(refresh_token);
```

Expired sessions are deleted hourly: `DELETE FROM sessions WHERE expires_at < now();`.

### 11.4 `servers`

One row per paired user host.

```sql
CREATE TABLE servers (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT         NOT NULL,
    version         TEXT,
    server_pk       BYTEA        NOT NULL,          -- 32-byte X25519 public key
    status          TEXT         NOT NULL DEFAULT 'offline'
                                 CHECK (status IN ('online','degraded','offline')),
    last_heartbeat  TIMESTAMPTZ,
    capabilities    TEXT[]       NOT NULL DEFAULT '{}',
    registered_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX servers_user_idx   ON servers(user_id);
CREATE INDEX servers_status_idx ON servers(status);
```

### 11.5 `server_tokens`

Single-use pairing tokens.

```sql
CREATE TABLE server_tokens (
    token       TEXT         PRIMARY KEY,           -- 32 random bytes, base64url
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claimed     BOOLEAN      NOT NULL DEFAULT FALSE,
    server_id   UUID                 REFERENCES servers(id) ON DELETE SET NULL,
    mobile_pk   BYTEA        NOT NULL,              -- published by the app, used by the host CLI
    expires_at  TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX server_tokens_user_idx ON server_tokens(user_id);
```

### 11.6 `device_keys`

One row per `(session, server)` pair, storing the mobile device's X25519 public key so the host can encrypt responses back.

```sql
CREATE TABLE device_keys (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    server_id   UUID         NOT NULL REFERENCES servers(id)  ON DELETE CASCADE,
    session_id  TEXT         NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    mobile_pk   BYTEA        NOT NULL,              -- 32-byte X25519 public key
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (session_id, server_id)
);

CREATE INDEX device_keys_server_idx ON device_keys(server_id);
```

### 11.7 `rate_limit_buckets`

Backed by Redis in production; the Postgres table is a cold-storage mirror for audit and for the in-memory fallback when Redis is unavailable.

```sql
CREATE TABLE rate_limit_buckets (
    bucket_key   TEXT         NOT NULL,             -- e.g. 'ip:1.2.3.4:login'
    window_start TIMESTAMPTZ  NOT NULL,
    count        INTEGER      NOT NULL,
    PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX rate_limit_window_idx ON rate_limit_buckets(window_start);
```

Retention: rows older than 24h are deleted nightly.

---

## 12. Scaling Considerations

### 12.1 Phase 1 Bandwidth

Estimated per active user per day:

| Traffic                              | Volume      |
|--------------------------------------|-------------|
| WebView asset loads (JS/CSS/images)  | ~10 MB      |
| PocketBase REST calls                | ~1.4 MB     |
| PocketBase SSE + dispatch progress   | ~0.6 MB     |
| **Total per user per day**           | **~12 MB**  |
| **Total per user per month**         | **~360 MB** |

### 12.2 Broker Bandwidth Cost Model

| Users   | Monthly bandwidth | Hetzner (20 TB included) | Overage cost |
|---------|-------------------|--------------------------|--------------|
| 100     | 36 GB             | Included                 | €0           |
| 1,000   | 360 GB            | Included                 | €0           |
| 10,000  | 3.6 TB            | Included                 | €0           |
| 50,000  | 18 TB             | Near cap                 | €0           |
| 100,000 | 36 TB             | 16 TB over               | ~€16         |

Hetzner CX22 includes 20 TB/month at no extra cost; overage is €1/TB. At 100k users we still pay less for bandwidth than the compute. **Phase 2 should land well before 100k users** to push most traffic off the broker regardless.

### 12.3 Compute

The relay is I/O-bound. A single Node.js process on 2 vCPUs handles ~500 concurrent WS connections before CPU saturation. At 30% concurrency (assumed) that is ~1,600 active users per box. Vertical scaling to CX32 (4 vCPU) doubles that to ~3,200.

### 12.4 Migration to WebRTC

**Trigger:** when bandwidth or concurrent-connections metrics show the broker CPU exceeding 60% sustained on CX42, begin the Phase 2 rollout. Expected at roughly 10,000-20,000 active users.

**Phase 2 broker load drops to:**
- Signaling only: ~5 KB per connection establishment, once per app session.
- TURN fallback: ~10-15% of sessions, full bandwidth but only for that minority.
- Net bandwidth reduction: **~85-90%** at the broker.

### 12.5 Horizontal Scaling

When a single broker box is not enough:

1. **Add broker instances** behind Caddy (or a Hetzner load balancer when we outgrow a single LB). Sessions are stateless (JWT-verified), so any instance can handle any REST call.
2. **Sticky WSS is not enough:** a mobile client might land on broker-A while the host's Tunnel Manager is on broker-B. Solution: **Redis pub/sub** with `serverConnections` as a Redis hash mapping `server_id → broker_instance_id`. Each broker subscribes to a topic `relay:<instance_id>`. Cross-instance relay publishes frames to the remote broker's topic; the remote broker delivers to the locally-held WS.
3. **Postgres:** move to Hetzner Managed Postgres (or self-hosted with streaming replication). Read replicas for `GET /servers` and session lookups.
4. **Multi-region:** when user distribution justifies it, deploy a second broker cluster in Hetzner Falkenstein (EU). Route by DNS geo (Cloudflare) or anycast.

### 12.6 Redis Usage Summary

| Key pattern                              | Purpose                              | TTL      |
|------------------------------------------|--------------------------------------|----------|
| `rl:ip:<ip>:<endpoint>`                  | Rate limit sliding window            | 1h       |
| `rl:user:<user_id>:<endpoint>`           | Per-user rate limits                 | 1h       |
| `server:<server_id>:instance`            | Which broker instance holds the WS   | 60s      |
| `bandwidth:<user_id>:<yyyy-mm-dd>`       | Daily bandwidth counter              | 48h      |
| `pubsub:relay:<instance_id>`             | Cross-instance frame forwarding      | —        |

---

## 13. Tech Stack

| Layer             | Choice                                     | Rationale                                                      |
|-------------------|--------------------------------------------|----------------------------------------------------------------|
| Runtime           | Node.js 22 LTS (TypeScript)                | Shares tooling with the rest of AnyRaven, I/O-bound workload    |
| HTTP framework    | Fastify 4                                  | Fast, first-class WS via `@fastify/websocket`, schema validation |
| WebSocket         | `ws` (via `@fastify/websocket`)            | Battle-tested, zero-copy forwarding, permessage-deflate        |
| Auth              | Lucia Auth v3                              | Thin, framework-agnostic, argon2id built in                    |
| JWT               | `jose`                                     | Well-audited JWT/JWS library, ES256 + HS256                    |
| Database          | Postgres 16                                | Multi-writer, mature, Hetzner managed path available           |
| DB client         | `postgres` (porsager/postgres)             | Zero-dep, prepared statements, pipelining                      |
| Cache / pub-sub   | Redis 7                                    | Rate limits, cross-instance relay routing                      |
| Crypto            | `libsodium-wrappers` (WASM)                | Spec decision #30, works identically on RN and Node            |
| Logging           | `pino`                                     | Fastify default, JSON structured, minimal overhead             |
| Metrics           | `@fastify/metrics` (Prometheus)            | Standard, Grafana-ready                                        |
| Migrations        | Hand-rolled SQL files + tiny runner        | No ORM needed, keeps schema in-repo and reviewable             |
| Reverse proxy     | Caddy 2                                    | Automatic Let's Encrypt, WS-friendly                           |
| Process manager   | systemd + pm2-runtime                      | Matches host-side supervision model                            |
| Container/host    | Ubuntu 24.04 on Hetzner CX22 (no Docker)   | Simpler ops for a single-purpose box                           |
| TURN (Phase 2)    | coturn                                     | Standard, self-hosted, `--use-auth-secret` mode                |

---

## 14. File Structure

```
broker/
├── package.json
├── tsconfig.json
├── pnpm-lock.yaml
├── Caddyfile
├── systemd/
│   └── anyraven-broker.service
├── src/
│   ├── index.ts                    # Fastify entrypoint, route registration
│   ├── config.ts                   # Env vars, secrets, defaults
│   ├── db/
│   │   ├── client.ts               # postgres.js client + helpers
│   │   ├── migrate.ts              # forward-only migration runner
│   │   └── migrations/
│   │       ├── 001_users.sql
│   │       ├── 002_oauth_accounts.sql
│   │       ├── 003_sessions.sql
│   │       ├── 004_servers.sql
│   │       ├── 005_server_tokens.sql
│   │       ├── 006_device_keys.sql
│   │       └── 007_rate_limit_buckets.sql
│   ├── auth/
│   │   ├── routes.ts               # /auth/* REST endpoints
│   │   ├── lucia.ts                # Lucia setup + Postgres adapter
│   │   ├── jwt.ts                  # Mint + verify broker JWT
│   │   ├── refresh.ts              # Refresh endpoint + sliding expiry
│   │   ├── session.ts              # Session CRUD
│   │   ├── middleware.ts           # Bearer token auth middleware
│   │   └── oauth/
│   │       ├── google.ts           # Google OIDC flow
│   │       ├── apple.ts            # Apple Sign In (ES256 client secret, first-login quirk)
│   │       ├── github.ts           # GitHub /user + /user/emails fetch
│   │       └── pkce.ts             # Shared PKCE helpers
│   ├── servers/
│   │   ├── routes.ts               # /servers/* REST endpoints
│   │   ├── pairing.ts              # Token generation + claim flow
│   │   ├── registry.ts             # Register + heartbeat + status
│   │   └── health-checker.ts       # Background job: degrade/offline transitions
│   ├── relay/
│   │   ├── client-handler.ts       # WSS /relay/client handler
│   │   ├── server-handler.ts       # WSS /relay/server handler
│   │   ├── envelope.ts             # CBOR envelope encode/decode
│   │   ├── pipe.ts                 # Zero-copy bidirectional forwarding
│   │   ├── connection-map.ts       # In-memory + Redis serverConnections
│   │   └── backpressure.ts         # Buffer watermarks, pause/resume
│   ├── signaling/                  # Phase 2 WebRTC
│   │   ├── handler.ts              # Signal message routing over existing WSS
│   │   └── turn-credentials.ts     # coturn short-lived credential generation
│   ├── crypto/
│   │   ├── aes-gcm.ts              # Provider refresh token encryption
│   │   └── bip39.ts                # 4-word verification code helpers (for /status response)
│   ├── middleware/
│   │   ├── rate-limit.ts           # Sliding window, Redis-backed
│   │   ├── error-handler.ts        # Centralised error mapping
│   │   └── logger.ts               # Request logging + correlation IDs
│   └── metrics/
│       └── prometheus.ts           # Counters, gauges, histograms
├── tests/
│   ├── auth/
│   │   ├── google.test.ts
│   │   ├── apple.test.ts           # First-login quirk regression test
│   │   ├── github.test.ts
│   │   ├── refresh.test.ts
│   │   └── session.test.ts
│   ├── servers/
│   │   ├── pair.test.ts
│   │   ├── register.test.ts
│   │   └── heartbeat.test.ts
│   ├── relay/
│   │   ├── connect.test.ts
│   │   ├── forward.test.ts
│   │   ├── envelope.test.ts
│   │   ├── reconnect.test.ts
│   │   └── backpressure.test.ts
│   ├── signaling/
│   │   └── webrtc.test.ts
│   └── e2e/
│       ├── pair-and-relay.test.ts  # Full flow: OAuth → pair → WSS relay with NaCl
│       └── multi-device.test.ts
└── .env.example
```

---

## 15. Testing Strategy

### 15.1 Unit Tests (vitest)

- **Auth:** JWT mint/verify round-trip, Apple client-secret JWT signing, PKCE verifier validation, refresh token sliding expiry.
- **Pairing:** server token generation, single-use enforcement, expiry cleanup, BIP39 derivation matches between mobile and host implementations (golden vectors).
- **Envelope:** CBOR encode/decode round-trip for every `type` × `service` combination, fuzz test with malformed frames.
- **Rate limiter:** sliding window edges, Redis failure fallback to in-memory.

### 15.2 Integration Tests (vitest + testcontainers)

Spin up Postgres + Redis in Docker for each test run. Each test exercises the full Fastify stack:

- **Auth flows:** mock OAuth provider endpoints (nock), verify full authorization-code → JWT → refresh cycle for Google, Apple (including first-login quirk), GitHub.
- **Pairing flow:** start pair → poll status → register (simulated host) → claim → verify shared-secret derivation produces matching BIP39 codes.
- **Heartbeat state machine:** fast-forward mock clock through the 90s/180s thresholds, assert the right UI-state control frames are emitted.

### 15.3 End-to-End Tests

- **Pair-and-relay:** full lifecycle. Test harness spins up a fake "host" that generates keys, connects to `/relay/server`, answers `connection_request`, and echoes every data frame. Mobile side (also simulated) runs the pairing flow, establishes a relay, and exchanges NaCl-encrypted frames through the real broker. Asserts decryption succeeds, nonce counters increment, and the broker never observes plaintext.
- **Multi-device:** same host, two simulated mobile clients, both relaying concurrently. Verifies `client_id` multiplexing and that cross-client frames are not delivered to the wrong recipient.
- **Reconnect:** kill the simulated host mid-session. Assert mobile clients see `server_offline`, the host reconnects with a new WSS, pairing is preserved (server_id stable), and new data frames flow.
- **Backpressure:** stream a 100 MB blob from host to mobile with a deliberately slow mobile receiver. Assert the broker pauses reading from the host and neither side OOMs.

### 15.4 Load Tests

- **k6** scripts drive 500 concurrent relay sessions for 10 minutes against a single CX22 instance, targeting typical PocketBase call patterns. Exit criteria: p95 latency < 150 ms, CPU < 70%, zero dropped frames.
- **Chaos:** kill Postgres mid-test, assert rate limiter falls back to in-memory and REST calls continue serving the happy path; restart Postgres, assert recovery within 10 seconds.

### 15.5 Security Tests

- **Fuzzing:** libfuzzer-style harness (via `jsfuzz`) on the envelope decoder and the NaCl frame decryption path.
- **Auth hardening:** verify rate limits via burst tests; confirm 401 on tampered JWTs; confirm 403 on cross-user `server_id` access.
- **Pairing MITM:** simulate a broker-in-the-middle swap of `mobile_pk` during pairing; assert the BIP39 codes do not match and therefore the user confirmation step would fail (documented manual check, since the test can't "see" what the user sees).
