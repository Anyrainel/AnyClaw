# broker

The AnyRaven connection broker. A cloud-hosted relay service that sits between the mobile app and each user's anyclaw-server instance. It handles user authentication, server pairing, and encrypted message relay — the broker itself never decrypts the payloads it forwards.

See [docs/plan4-connection-broker-design.md](../docs/plan4-connection-broker-design.md) for architecture details.

## Responsibilities

- **OAuth authentication** — Google, Apple, and GitHub via Lucia auth + JWT sessions.
- **Server pairing** — Issues server tokens and stores per-device public keys used for end-to-end encryption.
- **WebSocket relay** — Bidirectional binary frame relay between mobile clients and their paired anyclaw-server instances. Frames are CBOR-encoded NaCl-boxed envelopes; the broker does not decrypt them.
- **Rate limiting** — Per-IP and per-user token-bucket throttling.

## Tech Stack

| Concern | Choice |
|---|---|
| HTTP + WebSocket | Fastify 4 + @fastify/websocket |
| Auth | Lucia + OAuth (Google / Apple / GitHub) |
| Sessions | JWT (jose) |
| Database | PostgreSQL (via `postgres` client) |
| Frame encoding | CBOR (cbor-x) |
| Encryption | libsodium-wrappers |
| Runtime | Node.js 22+ |

## Project Layout

```
broker/
├── src/
│   ├── index.ts              Entry point (listen)
│   ├── app.ts                Fastify app factory
│   ├── relay/
│   │   ├── client-handler.ts  Mobile app WebSocket handler
│   │   ├── server-handler.ts  anyclaw-server WebSocket handler
│   │   ├── envelope.ts        Frame encode/decode
│   │   └── connection-map.ts  Active connection registry
│   ├── auth/
│   │   ├── routes.ts          /auth/* HTTP routes
│   │   ├── session.ts         Session create/validate
│   │   ├── jwt.ts             JWT sign/verify
│   │   ├── lucia.ts           Lucia adapter setup
│   │   └── oauth/             Provider-specific handlers
│   ├── db/
│   │   ├── client.ts          PostgreSQL connection
│   │   ├── migrate.ts         Migration runner
│   │   └── migrations/        SQL migration files
│   ├── crypto/
│   │   ├── nacl.ts            libsodium wrapper
│   │   └── bip39.ts           BIP39 seed for server tokens
│   └── middleware/
│       └── rate-limit.ts      Token bucket rate limiter
└── package.json
```

## Development

```bash
npm install
npm run migrate      # Apply PostgreSQL migrations
npm run dev          # tsx watch src/index.ts
npm run typecheck    # tsc --noEmit
npm test             # Vitest
```

## Production

```bash
npm run build        # tsc → dist/
npm start            # node dist/index.js
```

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth credentials |
| `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` | OAuth credentials |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth credentials |
| `PORT` | HTTP port (default `3000`) |
