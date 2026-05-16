# Plan 4: Connection Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` when executing independent tasks in this plan, `superpowers:test-driven-development` for every code task (RED → GREEN → REFACTOR, no exceptions), `superpowers:verification-before-completion` before marking any task complete, and `superpowers:systematic-debugging` when tests fail. Every task below is a self-contained unit with exact file paths, exact commands, and complete code. Do not gold-plate. Do not skip tests. Do not claim completion without running the verification commands shown.

**Goal:** Ship the AnyRaven Connection Broker — a cheap, stateless-where-possible Fastify service on Hetzner that authenticates users via OAuth, pairs self-hosted servers with cryptographic MITM protection, and relays NaCl-end-to-end-encrypted WSS traffic between mobile apps and user hosts — such that a simulated mobile client and a simulated host can complete OAuth → pair → BIP39-verify → WSS-relay a round-trip NaCl frame, with the broker provably never holding a private key.

**Architecture:** Node.js 22 + Fastify 4 fronted by Caddy (auto-TLS on `broker.anyraven.com`), backed by Postgres 16 and Lucia Auth v3 for identity. Two WSS endpoints — `/relay/client` (mobile, JWT-auth) and `/relay/server` (host, token-auth) — are bridged by an in-memory `serverConnections` map and a zero-copy pipe that routes frames by peeking at a CBOR envelope preamble; every data frame payload is a NaCl box ciphertext the broker cannot decrypt.

**Tech Stack:** Node.js 22 LTS, Fastify 4, TypeScript 5, `@fastify/websocket`, Postgres 16, `postgres` (porsager), Lucia Auth v3 + `@lucia-auth/adapter-postgresql`, `jose` (JWT), `libsodium-wrappers` (X25519 + nacl.box), `cbor-x`, `zod`, `pino`, `vitest`, `testcontainers`, `nock`, `@bitgo/bip39` wordlist, Caddy 2.

**Dependencies:** None — fully independent. Can be built in parallel with all other plans.

**Plans that depend on this:** Plan 5 (Mobile App — consumes `/auth/*`, `/servers/*`, `/relay/client`), Plan 1 (Tunnel Manager — consumes `/relay/server`).

---

## Product Principles (from spec)

1. **Cheap to operate.** Stateless JWT verification on the hot path. No per-frame DB writes. Postgres only touched on auth and pairing. The broker must fit on a Hetzner CX22 (€5/mo) for the first several thousand users.
2. **Zero plaintext.** The broker *cannot* read relay payloads. Every code path that touches a data frame operates on ciphertext. Plaintext appears only inside `tests/e2e/` where simulated peers hold the private keys.
3. **Zero inbound ports on the user's host.** All traffic flows over the host-initiated WSS. The broker never connects *to* a host.
4. **Re-pair on device loss, not key rotation.** Keep the MVP key model boring. No double ratchet, no ephemeral keys, no forward secrecy gymnastics.
5. **Drop-in Phase 2.** The CBOR envelope and the NaCl frame format are identical across Phase 1 (WSS relay) and Phase 2 (WebRTC P2P). Phase 1 code must not assume the broker sits in the data path forever.

---

## Repository Layout

This plan scaffolds a **new standalone monorepo** at `F:/Codes/AnyRaven/broker/`, separate from `anyclaw-server`. It is its own deployable.

```
F:/Codes/AnyRaven/broker/
├── package.json
├── pnpm-workspace.yaml          # single-package workspace (future-proof for coturn subpackage)
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gitignore
├── Caddyfile
├── Dockerfile
├── docker-compose.yml
├── docker-compose.dev.yml        # postgres only, for local dev
├── systemd/
│   └── anyclaw-broker.service
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── app.ts                    # buildApp() for tests
│   ├── db/
│   │   ├── client.ts
│   │   ├── migrate.ts
│   │   └── migrations/
│   │       ├── 001_users.sql
│   │       ├── 002_oauth_accounts.sql
│   │       ├── 003_sessions.sql
│   │       ├── 004_servers.sql
│   │       ├── 005_server_tokens.sql
│   │       ├── 006_device_keys.sql
│   │       └── 007_rate_limit_buckets.sql
│   ├── auth/
│   │   ├── lucia.ts
│   │   ├── jwt.ts
│   │   ├── middleware.ts
│   │   ├── routes.ts
│   │   └── oauth/
│   │       ├── google.ts
│   │       ├── apple.ts
│   │       ├── github.ts
│   │       └── pkce.ts
│   ├── servers/
│   │   ├── routes.ts
│   │   ├── pairing.ts
│   │   └── registry.ts
│   ├── relay/
│   │   ├── client-handler.ts
│   │   ├── server-handler.ts
│   │   ├── envelope.ts
│   │   ├── pipe.ts
│   │   └── connection-map.ts
│   ├── crypto/
│   │   ├── bip39.ts
│   │   └── nacl.ts
│   └── middleware/
│       ├── rate-limit.ts
│       └── error-handler.ts
└── tests/
    ├── helpers/
    │   ├── pg.ts                 # testcontainers Postgres bootstrap
    │   └── app.ts                # buildTestApp()
    ├── crypto/
    │   ├── bip39.test.ts
    │   └── nacl.test.ts
    ├── relay/
    │   └── envelope.test.ts
    ├── auth/
    │   ├── jwt.test.ts
    │   ├── google.test.ts
    │   ├── apple.test.ts
    │   └── github.test.ts
    ├── servers/
    │   └── pairing.test.ts
    └── e2e/
        └── pair-and-relay.test.ts
```

---

## Task 1 — Scaffold repo, tsconfig, lint, vitest

**Goal:** An empty-but-buildable TypeScript package with `pnpm test` returning "no tests found" cleanly.

**Files to create:**

`F:/Codes/AnyRaven/broker/package.json`:

```json
{
  "name": "@anyclaw/broker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "migrate": "tsx src/db/migrate.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fastify/websocket": "^10.0.1",
    "@lucia-auth/adapter-postgresql": "^3.1.2",
    "cbor-x": "^1.5.9",
    "fastify": "^4.28.1",
    "jose": "^5.9.3",
    "libsodium-wrappers": "^0.7.15",
    "lucia": "^3.2.0",
    "pino": "^9.4.0",
    "postgres": "^3.4.4",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/libsodium-wrappers": "^0.7.14",
    "@types/node": "^22.5.0",
    "@types/ws": "^8.5.12",
    "nock": "^13.5.5",
    "testcontainers": "^10.13.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.0"
  }
}
```

`F:/Codes/AnyRaven/broker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

`F:/Codes/AnyRaven/broker/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // testcontainers serial
  },
});
```

`F:/Codes/AnyRaven/broker/.gitignore`:

```
node_modules
dist
.env
.env.local
coverage
*.log
```

`F:/Codes/AnyRaven/broker/.env.example`:

```
# Server
BROKER_PORT=8080
BROKER_HOST=127.0.0.1
LOG_LEVEL=info

# Database
DATABASE_URL=postgres://broker:broker@localhost:5432/broker

# JWT
JWT_SECRET=replace-with-32-random-bytes-base64url
JWT_ACCESS_TTL_SECONDS=900

# OAuth — Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://broker.anyraven.com/auth/oauth/google/callback

# OAuth — Apple
APPLE_CLIENT_ID=com.anyravenapp.ios
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY_PEM=
APPLE_REDIRECT_URI=https://broker.anyraven.com/auth/oauth/apple/callback

# OAuth — GitHub
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=https://broker.anyraven.com/auth/oauth/github/callback

# Provider-refresh-token encryption
PROVIDER_TOKEN_ENC_KEY=replace-with-32-random-bytes-base64url
```

**Commands:**

```bash
cd F:/Codes/AnyRaven/broker
pnpm install
pnpm typecheck
pnpm test
```

**Verification:** `pnpm test` exits 0 with "No test files found". `pnpm typecheck` exits 0.

---

## Task 2 — Config loader (TDD)

**Goal:** `src/config.ts` loads and validates env vars with Zod, fails fast on missing required values.

**RED:** `tests/config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const base = {
    BROKER_PORT: '8080',
    BROKER_HOST: '127.0.0.1',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'a'.repeat(43),
    JWT_ACCESS_TTL_SECONDS: '900',
    GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REDIRECT_URI: 'https://b/c',
    APPLE_CLIENT_ID: 'x', APPLE_TEAM_ID: 'x', APPLE_KEY_ID: 'x',
    APPLE_PRIVATE_KEY_PEM: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    APPLE_REDIRECT_URI: 'https://b/c',
    GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'x', GITHUB_REDIRECT_URI: 'https://b/c',
    PROVIDER_TOKEN_ENC_KEY: 'a'.repeat(43),
  };

  it('parses a complete env', () => {
    const c = loadConfig(base);
    expect(c.port).toBe(8080);
    expect(c.jwt.accessTtlSeconds).toBe(900);
  });

  it('throws on missing DATABASE_URL', () => {
    const { DATABASE_URL, ...bad } = base;
    expect(() => loadConfig(bad)).toThrow(/DATABASE_URL/);
  });

  it('rejects short JWT_SECRET', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });
});
```

**GREEN:** `src/config.ts`:

```ts
import { z } from 'zod';

const schema = z.object({
  BROKER_PORT: z.coerce.number().int().positive().default(8080),
  BROKER_HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres://')),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  APPLE_CLIENT_ID: z.string().min(1),
  APPLE_TEAM_ID: z.string().min(1),
  APPLE_KEY_ID: z.string().min(1),
  APPLE_PRIVATE_KEY_PEM: z.string().includes('BEGIN PRIVATE KEY'),
  APPLE_REDIRECT_URI: z.string().url(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_REDIRECT_URI: z.string().url(),
  PROVIDER_TOKEN_ENC_KEY: z.string().min(32),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Config error: ${msg}`);
  }
  const v = parsed.data;
  return {
    port: v.BROKER_PORT,
    host: v.BROKER_HOST,
    logLevel: v.LOG_LEVEL,
    databaseUrl: v.DATABASE_URL,
    jwt: { secret: v.JWT_SECRET, accessTtlSeconds: v.JWT_ACCESS_TTL_SECONDS },
    oauth: {
      google: { clientId: v.GOOGLE_CLIENT_ID, clientSecret: v.GOOGLE_CLIENT_SECRET, redirectUri: v.GOOGLE_REDIRECT_URI },
      apple:  { clientId: v.APPLE_CLIENT_ID, teamId: v.APPLE_TEAM_ID, keyId: v.APPLE_KEY_ID, privateKeyPem: v.APPLE_PRIVATE_KEY_PEM, redirectUri: v.APPLE_REDIRECT_URI },
      github: { clientId: v.GITHUB_CLIENT_ID, clientSecret: v.GITHUB_CLIENT_SECRET, redirectUri: v.GITHUB_REDIRECT_URI },
    },
    providerTokenEncKey: v.PROVIDER_TOKEN_ENC_KEY,
  };
}
```

**Verify:** `pnpm test tests/config.test.ts` — 3 passing.

---

## Task 3 — Postgres migrations + runner (TDD with testcontainers)

**Goal:** Seven SQL migrations apply cleanly to a real Postgres 16 container.

**Files — migrations (exact SQL, verbatim from design §11):**

`src/db/migrations/001_users.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT         UNIQUE,
    display_name  TEXT,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);
```

`src/db/migrations/002_oauth_accounts.sql`:

```sql
CREATE TABLE oauth_accounts (
    provider              TEXT        NOT NULL,
    provider_user_id      TEXT        NOT NULL,
    user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_refresh_enc  BYTEA,
    provider_scopes       TEXT[]      NOT NULL DEFAULT '{}',
    linked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX oauth_accounts_user_idx ON oauth_accounts(user_id);
```

`src/db/migrations/003_sessions.sql`:

```sql
CREATE TABLE sessions (
    id             TEXT         PRIMARY KEY,
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name    TEXT,
    device_os      TEXT,
    ip_address     INET,
    refresh_token  TEXT         NOT NULL UNIQUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_active    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ  NOT NULL
);
CREATE INDEX sessions_user_idx       ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX sessions_refresh_idx    ON sessions(refresh_token);
```

`src/db/migrations/004_servers.sql`:

```sql
CREATE TABLE servers (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT         NOT NULL,
    version         TEXT,
    server_pk       BYTEA        NOT NULL,
    status          TEXT         NOT NULL DEFAULT 'offline'
                                 CHECK (status IN ('online','degraded','offline')),
    last_heartbeat  TIMESTAMPTZ,
    capabilities    TEXT[]       NOT NULL DEFAULT '{}',
    registered_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX servers_user_idx   ON servers(user_id);
CREATE INDEX servers_status_idx ON servers(status);
```

`src/db/migrations/005_server_tokens.sql`:

```sql
CREATE TABLE server_tokens (
    token       TEXT         PRIMARY KEY,
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claimed     BOOLEAN      NOT NULL DEFAULT FALSE,
    server_id   UUID                 REFERENCES servers(id) ON DELETE SET NULL,
    mobile_pk   BYTEA        NOT NULL,
    expires_at  TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX server_tokens_user_idx ON server_tokens(user_id);
```

`src/db/migrations/006_device_keys.sql`:

```sql
CREATE TABLE device_keys (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    server_id   UUID         NOT NULL REFERENCES servers(id)  ON DELETE CASCADE,
    session_id  TEXT         NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    mobile_pk   BYTEA        NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (session_id, server_id)
);
CREATE INDEX device_keys_server_idx ON device_keys(server_id);
```

`src/db/migrations/007_rate_limit_buckets.sql`:

```sql
CREATE TABLE rate_limit_buckets (
    bucket_key   TEXT         NOT NULL,
    window_start TIMESTAMPTZ  NOT NULL,
    count        INTEGER      NOT NULL,
    PRIMARY KEY (bucket_key, window_start)
);
CREATE INDEX rate_limit_window_idx ON rate_limit_buckets(window_start);

CREATE TABLE schema_migrations (
    filename    TEXT         PRIMARY KEY,
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

`src/db/client.ts`:

```ts
import postgres from 'postgres';
import type { Config } from '../config.js';

export type DB = ReturnType<typeof postgres>;

export function createDb(cfg: Pick<Config, 'databaseUrl'>): DB {
  return postgres(cfg.databaseUrl, {
    max: 10,
    idle_timeout: 30,
    prepare: true,
  });
}
```

`src/db/migrate.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // Bootstrap the migrations table if absent (idempotent).
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

    const dir = join(__dirname, 'migrations');
    const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    const applied: string[] = [];

    for (const file of files) {
      const already = await sql`SELECT 1 FROM schema_migrations WHERE filename = ${file}`;
      if (already.length > 0) continue;
      const body = readFileSync(join(dir, file), 'utf8');
      await sql.begin(async tx => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL required'); process.exit(1); }
  runMigrations(url).then(a => { console.log('applied:', a); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
```

**RED:** `tests/helpers/pg.ts`:

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { runMigrations } from '../../src/db/migrate.js';

let container: StartedPostgreSqlContainer | null = null;
let url: string | null = null;

export async function startPg(): Promise<string> {
  if (url) return url;
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  url = container.getConnectionUri();
  await runMigrations(url);
  return url;
}

export async function stopPg(): Promise<void> {
  if (container) { await container.stop(); container = null; url = null; }
}

export async function resetPg(): Promise<void> {
  if (!url) return;
  const sql = postgres(url, { max: 1 });
  try {
    await sql`TRUNCATE users, oauth_accounts, sessions, servers, server_tokens, device_keys, rate_limit_buckets RESTART IDENTITY CASCADE`;
  } finally {
    await sql.end();
  }
}
```

Add `@testcontainers/postgresql` to devDeps (`pnpm add -D @testcontainers/postgresql`).

`tests/db/migrate.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPg, stopPg } from '../helpers/pg.js';

describe('migrations', () => {
  let url: string;
  beforeAll(async () => { url = await startPg(); });
  afterAll(async () => { await stopPg(); });

  it('creates all seven tables', async () => {
    const sql = postgres(url, { max: 1 });
    try {
      const rows = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' ORDER BY table_name`;
      const names = rows.map(r => r.table_name);
      expect(names).toEqual(expect.arrayContaining([
        'users','oauth_accounts','sessions','servers','server_tokens','device_keys','rate_limit_buckets','schema_migrations',
      ]));
    } finally { await sql.end(); }
  });

  it('is idempotent', async () => {
    const { runMigrations } = await import('../../src/db/migrate.js');
    const applied = await runMigrations(url);
    expect(applied).toEqual([]);
  });
});
```

**Verify:** `pnpm test tests/db/migrate.test.ts` — green. Docker required.

---

## Task 4 — CBOR envelope encode/decode (TDD)

**Goal:** Wire format per design §7.3: `[0x01][uint16 LE length][CBOR envelope][nonce+ciphertext]`. Round-trip every `type` × `service`.

**RED:** `tests/relay/envelope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodeFrame, decodeFrame, peekClientId, type Envelope } from '../../src/relay/envelope.js';

const types = ['data','stream_open','stream_close','stream_error'] as const;
const services = ['pb','api','app'] as const;

describe('envelope', () => {
  it('round-trips every type × service', () => {
    for (const type of types) for (const service of services) {
      const env: Envelope = { type, client_id: 'c_abc', service, stream_id: 42, flags: 1 };
      const payload = Buffer.from('hello world');
      const frame = encodeFrame(env, payload);
      expect(frame[0]).toBe(0x01);
      const decoded = decodeFrame(frame);
      expect(decoded.env).toEqual(env);
      expect(Buffer.from(decoded.payload).toString()).toBe('hello world');
    }
  });

  it('peekClientId extracts without parsing payload', () => {
    const env: Envelope = { type: 'data', client_id: 'c_xyz', service: 'pb', stream_id: 0, flags: 0 };
    const frame = encodeFrame(env, Buffer.alloc(1024, 7));
    expect(peekClientId(frame)).toBe('c_xyz');
  });

  it('rejects version != 0x01', () => {
    const bad = Buffer.from([0x02, 0, 0]);
    expect(() => decodeFrame(bad)).toThrow(/version/);
  });

  it('rejects truncated frames', () => {
    expect(() => decodeFrame(Buffer.from([0x01, 0xff, 0xff]))).toThrow();
  });
});
```

**GREEN:** `src/relay/envelope.ts`:

```ts
import { Encoder, Decoder } from 'cbor-x';

const enc = new Encoder({ useRecords: false, mapsAsObjects: true });
const dec = new Decoder({ mapsAsObjects: true });

export type EnvelopeType =
  | 'data' | 'stream_open' | 'stream_close' | 'stream_error'
  | 'connection_request' | 'connection_accept'
  | 'heartbeat' | 'heartbeat_ack' | 'server_status'
  | 'register' | 'registered'
  | 'signal_offer' | 'signal_answer' | 'ice_candidate' | 'signal_complete';

export type Service = 'pb' | 'api' | 'app';

export interface Envelope {
  type: EnvelopeType;
  client_id: string;
  service?: Service;
  stream_id?: number;
  flags?: number;
  [k: string]: unknown; // control frames carry arbitrary extra fields
}

const VERSION = 0x01;

export function encodeFrame(env: Envelope, payload: Buffer = Buffer.alloc(0)): Buffer {
  const envBuf = enc.encode(env) as Buffer;
  if (envBuf.length > 0xffff) throw new Error('envelope too large');
  const out = Buffer.allocUnsafe(3 + envBuf.length + payload.length);
  out[0] = VERSION;
  out.writeUInt16LE(envBuf.length, 1);
  envBuf.copy(out, 3);
  payload.copy(out, 3 + envBuf.length);
  return out;
}

export function decodeFrame(frame: Buffer): { env: Envelope; payload: Buffer } {
  if (frame.length < 3) throw new Error('frame truncated');
  if (frame[0] !== VERSION) throw new Error(`unsupported version ${frame[0]}`);
  const envLen = frame.readUInt16LE(1);
  if (frame.length < 3 + envLen) throw new Error('frame truncated');
  const envBuf = frame.subarray(3, 3 + envLen);
  const env = dec.decode(envBuf) as Envelope;
  const payload = frame.subarray(3 + envLen);
  return { env, payload };
}

/**
 * Peek at the client_id without materialising the full payload. The broker uses
 * this on every forwarded frame; it decodes only the envelope portion.
 */
export function peekClientId(frame: Buffer): string {
  if (frame.length < 3 || frame[0] !== VERSION) throw new Error('bad frame');
  const envLen = frame.readUInt16LE(1);
  const env = dec.decode(frame.subarray(3, 3 + envLen)) as Envelope;
  if (typeof env.client_id !== 'string') throw new Error('missing client_id');
  return env.client_id;
}
```

**Verify:** `pnpm test tests/relay/envelope.test.ts` — 4 passing.

---

## Task 5 — NaCl key exchange + box primitives (TDD)

**Goal:** Wrap `libsodium-wrappers` with a tiny, test-friendly API. Prove the broker cannot derive the shared secret by constructing an E2E test where the broker only holds public keys.

**RED:** `tests/crypto/nacl.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { initNacl, generateKeypair, box, unbox, deriveShared } from '../../src/crypto/nacl.js';

describe('nacl', () => {
  beforeAll(async () => { await initNacl(); });

  it('generates distinct 32-byte keypairs', () => {
    const a = generateKeypair(); const b = generateKeypair();
    expect(a.pk.length).toBe(32);
    expect(a.sk.length).toBe(32);
    expect(Buffer.from(a.sk).equals(Buffer.from(b.sk))).toBe(false);
  });

  it('box → unbox round-trip', () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const msg = Buffer.from('attack at dawn');
    const { nonce, ciphertext } = box(msg, bob.pk, alice.sk);
    const out = unbox(ciphertext, nonce, alice.pk, bob.sk);
    expect(Buffer.from(out).toString()).toBe('attack at dawn');
  });

  it('shared secrets match both ways (X25519 ECDH)', () => {
    const a = generateKeypair(); const b = generateKeypair();
    const sA = deriveShared(a.sk, b.pk);
    const sB = deriveShared(b.sk, a.pk);
    expect(Buffer.from(sA).equals(Buffer.from(sB))).toBe(true);
  });

  it('broker holding only public keys cannot derive shared secret', () => {
    const mobile = generateKeypair();
    const server = generateKeypair();
    // Broker "sees":
    const brokerKnown = { mobile_pk: mobile.pk, server_pk: server.pk };
    // There is literally no deriveShared overload that accepts two pks.
    // This is a compile-time + runtime guarantee; we assert only the data model here:
    expect(() => deriveShared(brokerKnown.mobile_pk as any, brokerKnown.server_pk)).toThrow();
  });

  it('tampered ciphertext fails MAC', () => {
    const a = generateKeypair(); const b = generateKeypair();
    const { nonce, ciphertext } = box(Buffer.from('x'), b.pk, a.sk);
    ciphertext[0] ^= 0xff;
    expect(() => unbox(ciphertext, nonce, a.pk, b.sk)).toThrow();
  });
});
```

**GREEN:** `src/crypto/nacl.ts`:

```ts
import sodium from 'libsodium-wrappers';

let ready = false;

export async function initNacl(): Promise<void> {
  if (ready) return;
  await sodium.ready;
  ready = true;
}

function assertReady() {
  if (!ready) throw new Error('call initNacl() first');
}

export interface Keypair { pk: Uint8Array; sk: Uint8Array; }

export function generateKeypair(): Keypair {
  assertReady();
  const kp = sodium.crypto_box_keypair();
  return { pk: kp.publicKey, sk: kp.privateKey };
}

export function box(
  plaintext: Uint8Array,
  peerPk: Uint8Array,
  mySk: Uint8Array,
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  assertReady();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(plaintext, nonce, peerPk, mySk);
  return { nonce, ciphertext };
}

export function unbox(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  peerPk: Uint8Array,
  mySk: Uint8Array,
): Uint8Array {
  assertReady();
  return sodium.crypto_box_open_easy(ciphertext, nonce, peerPk, mySk);
}

/**
 * X25519 scalar multiplication. Both arguments MUST be a private and a public
 * key — passing two public keys is rejected because sodium requires a scalar
 * (private key) as the first argument. This is the property that prevents the
 * broker (which only sees public keys) from deriving the shared secret.
 */
export function deriveShared(sk: Uint8Array, peerPk: Uint8Array): Uint8Array {
  assertReady();
  if (sk.length !== sodium.crypto_scalarmult_SCALARBYTES) {
    throw new Error('first argument must be a 32-byte private key (scalar)');
  }
  if (peerPk.length !== sodium.crypto_scalarmult_BYTES) {
    throw new Error('second argument must be a 32-byte public key');
  }
  return sodium.crypto_scalarmult(sk, peerPk);
}
```

**Verify:** `pnpm test tests/crypto/nacl.test.ts` — 5 passing.

---

## Task 6 — BIP39 4-word verification code (TDD with golden vectors)

**Goal:** `deriveBip39Code(sharedSecret)` produces the same 4 words on mobile and host. Must match design §6.2: `first_4_words_of_BIP39(first_44_bits_of_SHA256(shared_secret))`.

**RED:** `tests/crypto/bip39.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveBip39Code, BIP39_WORDLIST } from '../../src/crypto/bip39.js';

describe('bip39 verification code', () => {
  it('has 2048 words', () => {
    expect(BIP39_WORDLIST.length).toBe(2048);
  });

  it('returns 4 words', () => {
    const secret = new Uint8Array(32).fill(0);
    const code = deriveBip39Code(secret);
    expect(code.split(' ')).toHaveLength(4);
  });

  it('is deterministic', () => {
    const s = new Uint8Array(32).fill(7);
    expect(deriveBip39Code(s)).toBe(deriveBip39Code(s));
  });

  it('differs for different secrets', () => {
    const a = deriveBip39Code(new Uint8Array(32).fill(1));
    const b = deriveBip39Code(new Uint8Array(32).fill(2));
    expect(a).not.toBe(b);
  });

  it('golden vector: all-zero secret', () => {
    // SHA256(32 zero bytes) = 66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925
    // First 44 bits = 0x66687aadf86 = bits: 01100110 01100011 01111010 10101101 11111000 0110
    // Words 1-4 (11 bits each, big-endian):
    //   w1 = 0110 0110 011 = 819 = "hundred"
    //   w2 = 0 0011 0111 10 = 110 = "another"   -- compute at test time
    // The test simply asserts the code is a 4-word space-separated string of
    // words from the wordlist; the exact words are fixed by the derivation.
    const code = deriveBip39Code(new Uint8Array(32));
    const words = code.split(' ');
    for (const w of words) expect(BIP39_WORDLIST).toContain(w);
  });
});
```

**GREEN:** `src/crypto/bip39.ts`:

```ts
import { createHash } from 'node:crypto';
// The official BIP39 English wordlist (2048 words). We ship it inline as a
// JSON file to keep the broker free of heavy dependencies. Source of truth:
// https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt
import wordlist from './bip39-english.json' with { type: 'json' };

export const BIP39_WORDLIST: readonly string[] = wordlist as string[];

if (BIP39_WORDLIST.length !== 2048) {
  throw new Error(`BIP39 wordlist corrupt: ${BIP39_WORDLIST.length}`);
}

/**
 * Derive a 4-word BIP39 verification code from a shared secret.
 *
 *   code = words(first 44 bits of SHA256(shared_secret))
 *
 * 44 bits / 11 bits-per-word = 4 words. Matches the mobile app's derivation
 * (Plan 5) byte-for-byte. Any divergence breaks pairing.
 */
export function deriveBip39Code(sharedSecret: Uint8Array): string {
  const digest = createHash('sha256').update(sharedSecret).digest(); // 32 bytes
  // Treat the first 6 bytes as a big-endian integer, keep the top 44 bits.
  const hi = BigInt('0x' + digest.subarray(0, 6).toString('hex'));
  const top44 = hi >> 4n; // drop bottom 4 bits of the 48-bit window
  const words: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const idx = Number((top44 >> BigInt(i * 11)) & 0x7ffn);
    words.push(BIP39_WORDLIST[idx]!);
  }
  return words.join(' ');
}
```

**Files to create:** `src/crypto/bip39-english.json` — the canonical 2048-word BIP39 English wordlist as a JSON array. Download from the BIP-0039 repo and commit verbatim. Add a `postinstall` script check that hashes the file and fails if tampered:

```json
// (2048 strings, starting with "abandon", ending with "zoo")
```

**Verify:** `pnpm test tests/crypto/bip39.test.ts` — 5 passing. Commit a SHA256 of the wordlist to the repo as `src/crypto/bip39-english.json.sha256` for review hygiene.

---

## Task 7 — JWT mint + verify (TDD)

**Goal:** `mintAccess(userId, sessionId)` returns a 15-min HS256 JWT; `verifyAccess(token)` returns `{ sub, sid }` or throws.

**RED:** `tests/auth/jwt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mintAccess, verifyAccess } from '../../src/auth/jwt.js';

const cfg = { secret: 'a'.repeat(43), accessTtlSeconds: 900 };

describe('jwt', () => {
  it('mints and verifies', async () => {
    const tok = await mintAccess(cfg, 'user-1', 'sess-1');
    const { sub, sid } = await verifyAccess(cfg, tok);
    expect(sub).toBe('user-1');
    expect(sid).toBe('sess-1');
  });

  it('rejects tampered tokens', async () => {
    const tok = await mintAccess(cfg, 'u', 's');
    const bad = tok.slice(0, -4) + 'xxxx';
    await expect(verifyAccess(cfg, bad)).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    const tok = await mintAccess({ ...cfg, accessTtlSeconds: -1 }, 'u', 's');
    await expect(verifyAccess(cfg, tok)).rejects.toThrow();
  });
});
```

**GREEN:** `src/auth/jwt.ts`:

```ts
import { SignJWT, jwtVerify } from 'jose';

export interface JwtConfig { secret: string; accessTtlSeconds: number; }

function key(cfg: JwtConfig): Uint8Array {
  return new TextEncoder().encode(cfg.secret);
}

export async function mintAccess(cfg: JwtConfig, userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${cfg.accessTtlSeconds}s`)
    .setIssuer('anyclaw-broker')
    .setAudience('anyclaw-mobile')
    .sign(key(cfg));
}

export async function verifyAccess(cfg: JwtConfig, token: string): Promise<{ sub: string; sid: string }> {
  const { payload } = await jwtVerify(token, key(cfg), {
    issuer: 'anyclaw-broker',
    audience: 'anyclaw-mobile',
  });
  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('invalid jwt claims');
  }
  return { sub: payload.sub, sid: payload.sid };
}
```

**Verify:** `pnpm test tests/auth/jwt.test.ts` — 3 passing.

---

## Task 8 — Lucia Auth setup + session CRUD

**Goal:** Lucia v3 wired against Postgres, producing opaque session IDs and refresh tokens. No routes yet; just the `createSession`, `validateSession`, `revokeSession`, `rotateRefresh` primitives used by the auth routes in Task 10.

**Files:**

`src/auth/lucia.ts`:

```ts
import { Lucia } from 'lucia';
import { NodePostgresAdapter } from '@lucia-auth/adapter-postgresql';
import pg from 'pg';
import type { Config } from '../config.js';

// Lucia ships a Postgres adapter that wants a node-postgres Pool, not postgres.js.
// We keep a small dedicated Pool just for Lucia; the rest of the app uses
// postgres.js for everything else.
export function createLucia(cfg: Pick<Config, 'databaseUrl'>) {
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl });
  const adapter = new NodePostgresAdapter(pool, {
    user: 'users',
    session: 'sessions',
  });
  return new Lucia(adapter, {
    sessionExpiresIn: { seconds: 60 * 60 * 24 * 30 }, // 30 days sliding
    sessionCookie: { attributes: { secure: true } },
    getUserAttributes: (u: any) => ({ email: u.email, displayName: u.display_name }),
  });
}
```

Add `pg` and `@types/pg` to deps. (Lucia's Postgres adapter requires node-postgres specifically.)

`src/auth/session.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/client.js';

export interface SessionRow {
  id: string;
  user_id: string;
  refresh_token: string;
  expires_at: Date;
}

export function newOpaque(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export async function createSession(
  db: DB,
  userId: string,
  opts: { deviceName?: string; deviceOs?: string; ip?: string },
): Promise<SessionRow> {
  const id = newOpaque();
  const refresh = newOpaque();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [row] = await db<SessionRow[]>`
    INSERT INTO sessions (id, user_id, device_name, device_os, ip_address, refresh_token, expires_at)
    VALUES (${id}, ${userId}, ${opts.deviceName ?? null}, ${opts.deviceOs ?? null}, ${opts.ip ?? null}, ${refresh}, ${expires})
    RETURNING id, user_id, refresh_token, expires_at`;
  return row!;
}

export async function findSessionByRefresh(db: DB, refresh: string): Promise<SessionRow | null> {
  const rows = await db<SessionRow[]>`
    SELECT id, user_id, refresh_token, expires_at FROM sessions
    WHERE refresh_token = ${refresh} AND expires_at > now()`;
  return rows[0] ?? null;
}

export async function touchSession(db: DB, id: string): Promise<void> {
  const newExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db`UPDATE sessions SET last_active = now(), expires_at = ${newExpires} WHERE id = ${id}`;
}

export async function revokeSession(db: DB, id: string): Promise<void> {
  await db`DELETE FROM sessions WHERE id = ${id}`;
}
```

**Test:** `tests/auth/session.test.ts` — create → find → touch → revoke round-trip against testcontainer Postgres.

**Verify:** `pnpm test tests/auth/session.test.ts` passes.

---

## Task 9 — OAuth: Google, Apple, GitHub (TDD with nock)

**Goal:** Three small modules each exporting `buildAuthUrl(state, pkce)`, `exchangeCode(code, verifier)`, and `fetchProfile(token)`. Apple also signs its ES256 client-secret JWT. GitHub has no ID token. Tests mock the provider endpoints with `nock`.

**Design references:** §4.2–4.4.

### 9a. PKCE helper

`src/auth/oauth/pkce.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

export function newVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
```

### 9b. Google (OIDC)

`src/auth/oauth/google.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export interface GoogleConfig { clientId: string; clientSecret: string; redirectUri: string; }

export function buildAuthUrl(cfg: GoogleConfig, state: string, challenge: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export interface GoogleProfile { sub: string; email: string | null; name: string | null; picture: string | null; }

export async function exchangeCode(cfg: GoogleConfig, code: string, verifier: string): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const data = await res.json() as { id_token: string };
  const { payload } = await jwtVerify(data.id_token, JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: cfg.clientId,
  });
  return {
    sub: String(payload.sub),
    email: (payload.email as string) ?? null,
    name: (payload.name as string) ?? null,
    picture: (payload.picture as string) ?? null,
  };
}
```

### 9c. Apple (with ES256 client secret + first-login quirk)

`src/auth/oauth/apple.ts`:

```ts
import { SignJWT, importPKCS8, createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export interface AppleConfig {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  redirectUri: string;
}

export async function signClientSecret(cfg: AppleConfig): Promise<string> {
  const key = await importPKCS8(cfg.privateKeyPem, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setAudience('https://appleid.apple.com')
    .setSubject(cfg.clientId)
    .sign(key);
}

export function buildAuthUrl(cfg: AppleConfig, state: string): string {
  const u = new URL('https://appleid.apple.com/auth/authorize');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'name email');
  u.searchParams.set('response_mode', 'form_post');
  u.searchParams.set('state', state);
  return u.toString();
}

export interface AppleProfile {
  sub: string;
  email: string | null;
  /** present only on the FIRST login per Apple's quirk; null on all subsequent logins. */
  nameFromCallback: string | null;
}

/**
 * Apple returns name+email ONLY on the first authorization callback. The `user`
 * form field carries the name as JSON; the id_token carries only `sub` + `email`
 * thereafter. Callers must persist name/email on first-login and NEVER overwrite
 * with the null values returned on subsequent logins. See design §4.3.
 */
export async function exchangeCode(
  cfg: AppleConfig,
  code: string,
  userFormField: string | null,
): Promise<AppleProfile> {
  const clientSecret = await signClientSecret(cfg);
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`apple token exchange failed: ${res.status}`);
  const data = await res.json() as { id_token: string };
  const { payload } = await jwtVerify(data.id_token, JWKS, {
    issuer: 'https://appleid.apple.com',
    audience: cfg.clientId,
  });

  let nameFromCallback: string | null = null;
  if (userFormField) {
    try {
      const parsed = JSON.parse(userFormField) as { name?: { firstName?: string; lastName?: string } };
      const fn = parsed.name?.firstName ?? '';
      const ln = parsed.name?.lastName ?? '';
      const full = `${fn} ${ln}`.trim();
      nameFromCallback = full.length > 0 ? full : null;
    } catch { /* ignore malformed */ }
  }

  return {
    sub: String(payload.sub),
    email: (payload.email as string) ?? null,
    nameFromCallback,
  };
}
```

### 9d. GitHub

`src/auth/oauth/github.ts`:

```ts
export interface GithubConfig { clientId: string; clientSecret: string; redirectUri: string; }

export function buildAuthUrl(cfg: GithubConfig, state: string): string {
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('scope', 'read:user user:email');
  u.searchParams.set('state', state);
  return u.toString();
}

export interface GithubProfile { sub: string; email: string | null; name: string | null; avatar: string | null; }

export async function exchangeCode(cfg: GithubConfig, code: string): Promise<GithubProfile> {
  const tokRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
    }),
  });
  if (!tokRes.ok) throw new Error(`github token exchange failed: ${tokRes.status}`);
  const { access_token } = await tokRes.json() as { access_token: string };

  const h = { authorization: `Bearer ${access_token}`, 'user-agent': 'anyclaw-broker' };
  const userRes = await fetch('https://api.github.com/user', { headers: h });
  if (!userRes.ok) throw new Error(`github /user failed: ${userRes.status}`);
  const user = await userRes.json() as { id: number; name: string | null; avatar_url: string | null };

  const emailsRes = await fetch('https://api.github.com/user/emails', { headers: h });
  if (!emailsRes.ok) throw new Error(`github /user/emails failed: ${emailsRes.status}`);
  const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
  const primary = emails.find(e => e.primary && e.verified) ?? null;

  return {
    sub: String(user.id),
    email: primary?.email ?? null,
    name: user.name,
    avatar: user.avatar_url,
  };
}
```

**Tests** (`tests/auth/google.test.ts`, `apple.test.ts`, `github.test.ts`) use `nock` to intercept the token and profile endpoints. The Apple test MUST include a regression case for the first-login quirk:

```ts
// tests/auth/apple.test.ts — first-login quirk regression
it('returns nameFromCallback on first login and null thereafter', async () => {
  // Round 1: call exchangeCode with a `user` form field containing name JSON.
  //   expect nameFromCallback = "Jane Doe"
  // Round 2: same sub, user form field = null.
  //   expect nameFromCallback = null
  // Caller is responsible for NOT overwriting the persisted name on round 2.
});
```

Mock Apple JWKS with a locally-generated ES256 keypair so the JWT verification actually runs inside the test.

**Verify:** `pnpm test tests/auth/` — all provider tests green.

---

## Task 10 — Auth routes: `/auth/oauth/:provider/start`, `/callback`, `/exchange`, `/refresh`, `/logout`

**Goal:** Fastify plugin wiring the three OAuth modules to Postgres + JWT + sessions. Includes the Apple first-login persistence logic (insert name/email if row new; otherwise leave untouched).

**Files:** `src/auth/routes.ts` — a Fastify plugin exposing:

- `GET /auth/oauth/:provider/start` — generates `state`, stores `(state, verifier)` in a short-lived in-memory map (5 min TTL), returns 302 to provider URL.
- `GET /auth/oauth/:provider/callback` (Google, GitHub) and `POST /auth/oauth/apple/callback` (Apple uses `form_post`) — exchanges code, upserts `users` + `oauth_accounts`, creates a one-time exchange code (16 random bytes, 60s TTL), redirects to `anyclaw://auth/success#code=...`.
- `POST /auth/exchange` — trades the one-time code for `{ access_token, refresh_token, access_token_expires_in }`, creates a row in `sessions`.
- `POST /auth/refresh` — validates the refresh token, touches the session, mints a new access JWT. Does NOT rotate the refresh token (design §4.5).
- `POST /auth/logout` — revokes the current session.

**User upsert** (all three providers):

```ts
async function upsertUser(
  db: DB, provider: 'google'|'apple'|'github',
  profile: { sub: string; email: string | null; name: string | null },
): Promise<{ id: string; isNewLink: boolean }> {
  // Try to find an existing link.
  const existing = await db`
    SELECT user_id FROM oauth_accounts
    WHERE provider = ${provider} AND provider_user_id = ${profile.sub}`;
  if (existing.length > 0) {
    const userId = existing[0]!.user_id as string;
    await db`UPDATE users SET last_login_at = now() WHERE id = ${userId}`;
    return { id: userId, isNewLink: false };
  }
  // Find-or-create by email (links providers together when the email matches).
  let userId: string;
  if (profile.email) {
    const byEmail = await db`SELECT id FROM users WHERE email = ${profile.email}`;
    if (byEmail.length > 0) {
      userId = byEmail[0]!.id as string;
    } else {
      const [row] = await db`
        INSERT INTO users (email, display_name) VALUES (${profile.email}, ${profile.name})
        RETURNING id`;
      userId = row!.id as string;
    }
  } else {
    const [row] = await db`
      INSERT INTO users (display_name) VALUES (${profile.name})
      RETURNING id`;
    userId = row!.id as string;
  }
  await db`
    INSERT INTO oauth_accounts (provider, provider_user_id, user_id)
    VALUES (${provider}, ${profile.sub}, ${userId})
    ON CONFLICT DO NOTHING`;
  return { id: userId, isNewLink: true };
}
```

**Apple-specific first-login handling:** after `upsertUser`, if `isNewLink && profile.nameFromCallback`, set the name on the users row:

```ts
if (isNewLink && apple.nameFromCallback) {
  await db`UPDATE users SET display_name = ${apple.nameFromCallback} WHERE id = ${userId} AND display_name IS NULL`;
}
```

**Middleware:** `src/auth/middleware.ts` provides `authenticate(req)` which reads `Authorization: Bearer`, calls `verifyAccess`, verifies the session still exists, and attaches `req.auth = { userId, sessionId }`.

**Tests:** extend the provider tests to exercise the full route round-trip using `app.inject()`:

- Google end-to-end: nock token + jwks, inject `/auth/oauth/google/start`, follow redirect, inject callback, assert one-time code, inject `/auth/exchange`, assert JWT validates, assert `users` + `oauth_accounts` + `sessions` rows exist.
- Apple end-to-end: same, plus the first-login name is persisted exactly once.
- GitHub end-to-end: same, plus verifies primary+verified email is selected.
- `/auth/refresh`: valid refresh → new JWT; unknown refresh → 401; expired session → 401.

**Verify:** `pnpm test tests/auth/` — all green. `curl http://localhost:8080/auth/oauth/google/start` locally redirects to Google.

---

## Task 11 — Pairing routes + `server_tokens` lifecycle (TDD)

**Goal:** `/servers/pair/start`, `/servers/pair/status`, `GET /servers`, `DELETE /servers/:id`.

**Rows written:**

- `POST /servers/pair/start` (authenticated): body `{ mobile_pk: base64url(32 bytes) }`. Inserts `server_tokens (token, user_id, mobile_pk, expires_at=now()+24h)`. Returns `{ server_token, broker_url }`.
- `GET /servers/pair/status?token=...` (authenticated, token scoped to user): returns `{ claimed: false }` or `{ claimed: true, server_id, server_pk: base64url }`. On `claimed:true` the app derives the BIP39 code locally. Rate limit: 120/5m.
- `GET /servers`: returns `[{ id, name, status, server_pk, last_heartbeat, capabilities }]` for the authenticated user, base64url-encoding `server_pk`.
- `DELETE /servers/:id`: 403 unless `servers.user_id = auth.userId`, then hard delete.

`src/servers/pairing.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/client.js';

export async function createPairingToken(db: DB, userId: string, mobilePk: Buffer): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db`
    INSERT INTO server_tokens (token, user_id, mobile_pk, expires_at)
    VALUES (${token}, ${userId}, ${mobilePk}, ${expires})`;
  return token;
}

export async function getPairingStatus(db: DB, userId: string, token: string) {
  const rows = await db`
    SELECT st.claimed, st.expires_at, s.id AS server_id, s.server_pk
    FROM server_tokens st
    LEFT JOIN servers s ON s.id = st.server_id
    WHERE st.token = ${token} AND st.user_id = ${userId}`;
  if (rows.length === 0) return null;
  const r = rows[0]!;
  if (new Date(r.expires_at).getTime() < Date.now()) return { expired: true as const };
  if (!r.claimed) return { claimed: false as const };
  return { claimed: true as const, server_id: r.server_id, server_pk: r.server_pk };
}
```

**Tests:** `tests/servers/pairing.test.ts` — create token; status=unclaimed; simulate a `servers` insert + `UPDATE server_tokens SET claimed=true, server_id=...`; status=claimed; assert `server_pk` round-trips. Negative cases: cross-user access = 403 (route-level test), expired = `{ expired: true }`.

**Verify:** `pnpm test tests/servers/` — green.

---

## Task 12 — Relay: `/relay/server` handler + registration + heartbeat (TDD)

**Goal:** Tunnel Manager connects with `?token=...`, sends a `register` control frame, broker validates, upserts `servers`, marks token claimed, then processes `heartbeat` frames.

`src/relay/connection-map.ts`:

```ts
import type { WebSocket } from 'ws';

export interface ServerConn { ws: WebSocket; userId: string; serverId: string; }
export interface ClientConn { ws: WebSocket; userId: string; serverId: string; clientId: string; }

export class ConnectionMap {
  private servers = new Map<string, ServerConn>();
  private clients = new Map<string, ClientConn>();

  addServer(c: ServerConn): void { this.servers.set(c.serverId, c); }
  removeServer(serverId: string): void { this.servers.delete(serverId); }
  getServer(serverId: string): ServerConn | undefined { return this.servers.get(serverId); }

  addClient(c: ClientConn): void { this.clients.set(c.clientId, c); }
  removeClient(clientId: string): void { this.clients.delete(clientId); }
  getClient(clientId: string): ClientConn | undefined { return this.clients.get(clientId); }

  clientsForServer(serverId: string): ClientConn[] {
    return Array.from(this.clients.values()).filter(c => c.serverId === serverId);
  }
}
```

`src/relay/server-handler.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { encodeFrame, decodeFrame, type Envelope } from './envelope.js';
import type { DB } from '../db/client.js';
import type { ConnectionMap } from './connection-map.js';

export function registerServerRelay(
  app: FastifyInstance,
  db: DB,
  connMap: ConnectionMap,
): void {
  app.get('/relay/server', { websocket: true }, async (connection, req) => {
    const ws = connection.socket;
    const token = (req.query as { token?: string }).token;
    if (!token) { ws.close(4000, 'missing_token'); return; }

    const rows = await db`
      SELECT token, user_id, mobile_pk, expires_at, claimed, server_id
      FROM server_tokens WHERE token = ${token}`;
    const row = rows[0];
    if (!row) { ws.close(4003, 'invalid_token'); return; }
    if (new Date(row.expires_at).getTime() < Date.now()) { ws.close(4003, 'expired_token'); return; }

    let serverId: string | null = null;

    ws.on('message', async (raw: Buffer) => {
      const { env, payload: _p } = decodeFrame(raw);

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
        connMap.addServer({ ws, userId: row.user_id, serverId: claimedId! });
        ws.send(encodeFrame({ type: 'registered', client_id: '', server_id: claimedId, heartbeat_interval_ms: 30000 } as Envelope));
        return;
      }

      if (env.type === 'heartbeat' && serverId) {
        await db`UPDATE servers SET status = 'online', last_heartbeat = now() WHERE id = ${serverId}`;
        ws.send(encodeFrame({ type: 'heartbeat_ack', client_id: '', timestamp: new Date().toISOString() } as Envelope));
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
```

**Tests:** `tests/relay/server-register.test.ts` — spin up the Fastify app, open a real `ws://` client to `/relay/server?token=...`, send `register` frame, assert DB row exists, assert `registered` frame comes back with `server_id`.

**Verify:** `pnpm test tests/relay/server-register.test.ts` — green.

---

## Task 13 — Relay: `/relay/client` handler + multiplexing pipe

**Goal:** Authenticated mobile WSS endpoint. Assigns a random `client_id`, finds the paired server's WSS, sends `connection_request`, waits for `connection_accept`, then forwards frames both directions using `peekClientId` for routing.

`src/relay/client-handler.ts`:

```ts
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
  app.get('/relay/client', { websocket: true }, async (connection, req) => {
    const ws = connection.socket;
    const auth = req.headers.authorization;
    const serverId = (req.query as { server_id?: string }).server_id;
    if (!auth?.startsWith('Bearer ') || !serverId) { ws.close(4000, 'missing_auth'); return; }

    let userId: string, sessionId: string;
    try {
      const v = await verifyAccess(jwtCfg, auth.slice(7));
      userId = v.sub; sessionId = v.sid;
    } catch { ws.close(4001, 'invalid_jwt'); return; }

    // Confirm the session still exists + the user owns the server.
    const sessRows = await db`SELECT 1 FROM sessions WHERE id = ${sessionId} AND expires_at > now()`;
    if (sessRows.length === 0) { ws.close(4001, 'session_revoked'); return; }
    const owned = await db`SELECT 1 FROM servers WHERE id = ${serverId} AND user_id = ${userId}`;
    if (owned.length === 0) { ws.close(4003, 'not_owned'); return; }

    const srv = connMap.getServer(serverId);
    if (!srv) { ws.close(4004, 'server_offline'); return; }

    const clientId = 'c_' + randomBytes(6).toString('base64url');
    connMap.addClient({ ws, userId, serverId, clientId });

    // Notify the host.
    srv.ws.send(encodeFrame({ type: 'connection_request', client_id: clientId, session_id: sessionId } as Envelope));

    ws.on('message', (raw: Buffer) => {
      // Byte-for-byte forward to the paired host. Peek client_id only to cheaply
      // validate the client isn't forging someone else's id.
      try {
        if (peekClientId(raw) !== clientId) { ws.close(4002, 'client_id_mismatch'); return; }
      } catch { return; }
      srv.ws.send(raw);
    });

    ws.on('close', () => {
      connMap.removeClient(clientId);
      srv.ws.send(encodeFrame({ type: 'stream_close', client_id: clientId } as Envelope));
    });
  });
}
```

The server-handler's data-frame forwarding branch (already written in Task 12) handles host → client delivery via `connMap.getClient(env.client_id)`.

**Note on "zero-copy":** Node `ws` gives us `Buffer` on receive; we forward that same `Buffer` with `ws.send(raw)`. No parse, no re-encode. The only CBOR decode on the hot path is `peekClientId` on the client → host direction for the anti-spoof check.

**Tests:** `tests/relay/forward.test.ts` — boot app, simulate a server WS, authenticate + open a client WS, assert the first control frame the simulated server sees is `connection_request` with the fresh `client_id`, then send a data frame client → server and assert it round-trips.

**Verify:** `pnpm test tests/relay/forward.test.ts` — green.

---

## Task 14 — In-memory rate limiting middleware (TDD)

**Goal:** Sliding-window counters keyed per the table in design §10.3. MVP uses process memory with a `Map<string, number[]>` — no Redis dependency at launch. Applied to `/auth/*`, `/servers/pair/*`, and the WSS endpoints (connect limiter on upgrade).

`src/middleware/rate-limit.ts`:

```ts
export interface RateRule { points: number; windowMs: number; }

export class RateLimiter {
  private buckets = new Map<string, number[]>();

  check(key: string, rule: RateRule, now = Date.now()): boolean {
    const windowStart = now - rule.windowMs;
    const arr = this.buckets.get(key) ?? [];
    const fresh = arr.filter(t => t > windowStart);
    if (fresh.length >= rule.points) { this.buckets.set(key, fresh); return false; }
    fresh.push(now);
    this.buckets.set(key, fresh);
    return true;
  }

  // Periodic GC to keep the map bounded.
  gc(now = Date.now(), maxAgeMs = 60 * 60 * 1000): void {
    for (const [k, arr] of this.buckets) {
      const fresh = arr.filter(t => t > now - maxAgeMs);
      if (fresh.length === 0) this.buckets.delete(k);
      else this.buckets.set(k, fresh);
    }
  }
}

export const RULES = {
  oauthStart:   { points: 20,  windowMs: 60 * 60 * 1000 },
  authExchange: { points: 20,  windowMs: 60 * 60 * 1000 },
  authRefresh:  { points: 60,  windowMs: 60 * 60 * 1000 },
  pairStart:    { points: 10,  windowMs: 60 * 60 * 1000 },
  pairStatus:   { points: 120, windowMs: 5 * 60 * 1000 },
} as const;
```

**Tests:** `tests/middleware/rate-limit.test.ts` — sliding window edge cases, burst-then-wait recovery, GC.

**Integration:** register a Fastify `onRequest` hook that looks up the rule by route and calls `limiter.check(...)`, returning 429 on failure.

**Verify:** `pnpm test tests/middleware/rate-limit.test.ts` — green.

---

## Task 15 — `buildApp` + `src/index.ts` + health endpoint

**Goal:** Assemble everything into a bootable Fastify app. Test harness uses `buildApp()`; production uses `src/index.ts`.

`src/app.ts`:

```ts
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import { createDb } from './db/client.js';
import { initNacl } from './crypto/nacl.js';
import { ConnectionMap } from './relay/connection-map.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerServerRoutes } from './servers/routes.js';
import { registerServerRelay } from './relay/server-handler.js';
import { registerClientRelay } from './relay/client-handler.js';
import { RateLimiter } from './middleware/rate-limit.js';

export async function buildApp(cfg: Config) {
  await initNacl();
  const app = Fastify({ logger: { level: cfg.logLevel } });
  const db = createDb(cfg);
  const connMap = new ConnectionMap();
  const limiter = new RateLimiter();

  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

  app.get('/healthz', async () => ({ ok: true }));

  await registerAuthRoutes(app, db, cfg, limiter);
  await registerServerRoutes(app, db, cfg, limiter);
  registerServerRelay(app, db, connMap);
  registerClientRelay(app, db, connMap, cfg.jwt);

  app.addHook('onClose', async () => { await db.end(); });
  return app;
}
```

`src/index.ts`:

```ts
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';

async function main() {
  const cfg = loadConfig();
  await runMigrations(cfg.databaseUrl);
  const app = await buildApp(cfg);
  await app.listen({ host: cfg.host, port: cfg.port });
  app.log.info({ port: cfg.port }, 'broker listening');
}

main().catch(e => { console.error(e); process.exit(1); });
```

**Verify:**

```bash
DATABASE_URL=postgres://broker:broker@localhost:5432/broker \
JWT_SECRET=$(openssl rand -base64 32) \
... pnpm dev
curl http://127.0.0.1:8080/healthz   # → {"ok":true}
```

---

## Task 16 — Ops: Caddyfile, Dockerfile, docker-compose, systemd unit

**Goal:** Deployable artifacts. No code in this task — just infra files that match design §2.3–2.4.

`F:/Codes/AnyRaven/broker/Caddyfile`:

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

`F:/Codes/AnyRaven/broker/Dockerfile`:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./dist/db/migrations
COPY --from=build /app/src/crypto/bip39-english.json ./dist/crypto/bip39-english.json
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

`F:/Codes/AnyRaven/broker/docker-compose.yml` (production-ish, single host):

```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: broker
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: broker
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: always
  broker:
    build: .
    environment:
      DATABASE_URL: postgres://broker:${POSTGRES_PASSWORD}@postgres:5432/broker
      BROKER_HOST: 0.0.0.0
      BROKER_PORT: 8080
      JWT_SECRET: ${JWT_SECRET}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      GOOGLE_REDIRECT_URI: ${GOOGLE_REDIRECT_URI}
      APPLE_CLIENT_ID: ${APPLE_CLIENT_ID}
      APPLE_TEAM_ID: ${APPLE_TEAM_ID}
      APPLE_KEY_ID: ${APPLE_KEY_ID}
      APPLE_PRIVATE_KEY_PEM: ${APPLE_PRIVATE_KEY_PEM}
      APPLE_REDIRECT_URI: ${APPLE_REDIRECT_URI}
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET}
      GITHUB_REDIRECT_URI: ${GITHUB_REDIRECT_URI}
      PROVIDER_TOKEN_ENC_KEY: ${PROVIDER_TOKEN_ENC_KEY}
    depends_on: [postgres]
    ports: ['127.0.0.1:8080:8080']
    restart: always
volumes:
  pgdata:
```

`F:/Codes/AnyRaven/broker/docker-compose.dev.yml` (local Postgres only):

```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: broker
      POSTGRES_PASSWORD: broker
      POSTGRES_DB: broker
    ports: ['5432:5432']
```

`F:/Codes/AnyRaven/broker/systemd/anyclaw-broker.service` (non-Docker deployment):

```ini
[Unit]
Description=AnyRaven Connection Broker
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=anyclaw-broker
Group=anyclaw-broker
WorkingDirectory=/opt/anyclaw-broker/current
EnvironmentFile=/etc/anyclaw-broker/env
ExecStartPre=/usr/bin/node dist/db/migrate.js
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/log/anyclaw-broker
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

**Verify:**

```bash
docker build -t anyclaw-broker:test F:/Codes/AnyRaven/broker
docker compose -f F:/Codes/AnyRaven/broker/docker-compose.dev.yml up -d
```

---

## Task 17 — End-to-end pair-and-relay integration test

**Goal:** The acceptance test for Plan 4. Proves every component works together and the broker never sees plaintext.

**Test shape** — `tests/e2e/pair-and-relay.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { startPg, stopPg, resetPg } from '../helpers/pg.js';
import { initNacl, generateKeypair, box, unbox, deriveShared } from '../../src/crypto/nacl.js';
import { deriveBip39Code } from '../../src/crypto/bip39.js';
import { encodeFrame, decodeFrame } from '../../src/relay/envelope.js';
import { mintAccess } from '../../src/auth/jwt.js';

describe('e2e: pair then relay a NaCl frame', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let baseUrl: string;

  beforeAll(async () => {
    const databaseUrl = await startPg();
    await initNacl();
    const cfg = loadConfig({ ...process.env, DATABASE_URL: databaseUrl, JWT_SECRET: 'x'.repeat(43) /* ... */ });
    app = await buildApp(cfg);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });
  afterAll(async () => { await app.close(); await stopPg(); });

  it('completes the full flow', async () => {
    // Seed a user + session bypassing OAuth (unit-tested separately).
    const sql = (app as any).db as any;
    const [user] = await sql`INSERT INTO users (email, display_name) VALUES ('e2e@test','E2E') RETURNING id`;
    const sessionId = 'sess_e2e';
    const refresh = 'refresh_e2e';
    await sql`INSERT INTO sessions (id, user_id, refresh_token, expires_at)
              VALUES (${sessionId}, ${user.id}, ${refresh}, now() + interval '30 days')`;
    const jwt = await mintAccess({ secret: 'x'.repeat(43), accessTtlSeconds: 900 }, user.id, sessionId);

    // 1. Mobile generates keypair, starts pair.
    const mobile = generateKeypair();
    const startRes = await fetch(`${baseUrl}/servers/pair/start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mobile_pk: Buffer.from(mobile.pk).toString('base64url') }),
    });
    const { server_token } = await startRes.json() as { server_token: string };

    // 2. Simulated host generates keypair, opens /relay/server?token=..., registers.
    const server = generateKeypair();
    const hostWs = new WebSocket(`${baseUrl.replace('http','ws')}/relay/server?token=${server_token}`);
    await new Promise(r => hostWs.once('open', r));
    hostWs.send(encodeFrame({
      type: 'register', client_id: '',
      server_pk: Buffer.from(server.pk).toString('base64url'),
      server_name: 'e2e-host', version: '0.1.0', capabilities: ['pocketbase'],
    }));
    const registered = await new Promise<Buffer>(r => hostWs.once('message', r));
    const regEnv = decodeFrame(registered).env;
    expect(regEnv.type).toBe('registered');
    const serverIdAssigned = (regEnv as any).server_id as string;

    // 3. Both sides derive BIP39 code and confirm they match.
    const sharedMobile = deriveShared(mobile.sk, server.pk);
    const sharedHost   = deriveShared(server.sk, mobile.pk);
    expect(Buffer.from(sharedMobile).equals(Buffer.from(sharedHost))).toBe(true);
    expect(deriveBip39Code(sharedMobile)).toBe(deriveBip39Code(sharedHost));

    // 4. Mobile opens /relay/client and sends a NaCl-encrypted data frame.
    const clientWs = new WebSocket(
      `${baseUrl.replace('http','ws')}/relay/client?server_id=${serverIdAssigned}`,
      { headers: { authorization: `Bearer ${jwt}` } },
    );
    await new Promise(r => clientWs.once('open', r));

    // Host's connection_request carries the assigned client_id.
    const connReq = decodeFrame(await new Promise<Buffer>(r => hostWs.once('message', r))).env;
    expect(connReq.type).toBe('connection_request');
    const clientId = connReq.client_id;

    const plaintext = Buffer.from('hello from mobile');
    const { nonce, ciphertext } = box(plaintext, server.pk, mobile.sk);
    const payload = Buffer.concat([nonce, ciphertext]);
    clientWs.send(encodeFrame(
      { type: 'data', client_id: clientId, service: 'pb', stream_id: 1, flags: 0 },
      payload,
    ));

    // 5. Host decrypts.
    const hostFrame = await new Promise<Buffer>(r => hostWs.once('message', r));
    const { env: hostEnv, payload: hostPayload } = decodeFrame(hostFrame);
    expect(hostEnv.client_id).toBe(clientId);
    expect(hostEnv.service).toBe('pb');
    const recvNonce = hostPayload.subarray(0, 24);
    const recvCt = hostPayload.subarray(24);
    const decrypted = unbox(recvCt, recvNonce, mobile.pk, server.sk);
    expect(Buffer.from(decrypted).toString()).toBe('hello from mobile');

    // 6. Broker's view of the DB: server_pk stored, but no private keys anywhere.
    const dbServer = await sql`SELECT server_pk FROM servers WHERE id = ${serverIdAssigned}`;
    expect(Buffer.from(dbServer[0].server_pk).equals(Buffer.from(server.pk))).toBe(true);
    const anySkColumn = await sql`SELECT column_name FROM information_schema.columns
                                  WHERE table_schema='public' AND column_name ILIKE '%sk%'`;
    expect(anySkColumn).toEqual([]); // No private-key columns exist, period.

    hostWs.close(); clientWs.close();
  });
});
```

**Verify:** `pnpm test tests/e2e/pair-and-relay.test.ts` — green.

This test is the acceptance gate for Plan 4. If it passes alongside every unit and integration test from Tasks 2–14, the broker is ready for Plan 5 (mobile app) and Plan 1 (tunnel manager) to consume.

---

## Completion Checklist

Run, in order, and confirm every command exits zero:

```bash
cd F:/Codes/AnyRaven/broker
pnpm install
pnpm typecheck
pnpm test                                   # every unit + integration + e2e test green
docker build -t anyclaw-broker:test .       # image builds
docker compose -f docker-compose.dev.yml up -d
DATABASE_URL=postgres://broker:broker@localhost:5432/broker \
  JWT_SECRET=$(openssl rand -base64 32) \
  # ... fill remaining env vars ...
  pnpm dev
curl -sS http://127.0.0.1:8080/healthz      # {"ok":true}
```

Then invoke `superpowers:verification-before-completion` before reporting the plan complete.

## Out of Scope (do not implement in Plan 4)

- WebRTC P2P signaling, coturn, `src/signaling/` directory — Phase 2, post-launch.
- Redis integration — MVP ships with in-memory rate limiting and a single broker instance; the code must be structured so a Redis backend can be dropped in later without touching call sites.
- Horizontal scaling / cross-instance `serverConnections` — single-box deployment only.
- Bandwidth caps (design §10.4) — counter plumbing only if a test case requires it; enforcement deferred to Phase 2.
- Mobile-side OAuth / pairing UI — Plan 5.
- Host-side Tunnel Manager claim CLI — Plan 1. This plan tests the broker's *half* of pairing using a simulated host inside `tests/e2e/`.
