# AnyClaw — Agent Guidance

AnyClaw is a self-evolving AI companion app. A coding agent builds and deploys a personalized full-stack web app; the user interacts via a mobile shell. **The project is not yet functional end-to-end** — broker↔tunnel-manager WSS integration and Docker validation are the remaining critical path items.

## Repo Layout

```
broker/            Fastify auth + WSS relay (Node 22, PostgreSQL)
mobile/            Expo companion app (iOS/Android/Web)
anyclaw-server/    Server monorepo (Node 20, npm workspaces)
  packages/
    shared/        Crypto, paths, snapshot/version/worktree/deploy managers
    dispatch/      Task orchestration + REST API (:4100)
    mcp-server/    MCP tools for coding agents (:4100/mcp)
    tunnel-manager WSS client to broker
    logic-runner   Supervises agent-built logic service (:3000)
    prod-static    Serves agent-built frontend (:5173)
    frontend-template  Vite+React+Tailwind v4 seed
docs/              Architecture design docs (plan1–plan6) + tasks/
```

## Running Tests

```bash
# anyclaw-server (all packages, fast — no external deps)
cd anyclaw-server && npm test
cd anyclaw-server && npm run typecheck

# Single package
cd anyclaw-server && npm run -w @anyclaw/shared test
cd anyclaw-server && npm run -w @anyclaw/dispatch test

# broker (requires Docker for testcontainers)
cd broker && npm test
cd broker && npm run typecheck

# mobile
cd mobile && npm test
cd mobile && npm run typecheck
```

## TypeScript Conventions

The `anyclaw-server` tsconfig enforces strict settings that trip up naive code:

- **`exactOptionalPropertyTypes: true`** — optional class fields must be typed `: T | undefined`, not `?: T`. The two are not interchangeable under this flag.
- **`noUncheckedIndexedAccess: true`** — array/object index access returns `T | undefined`. Always narrow before use.
- **`strict: true`** — all standard strict checks enabled.

These apply to all packages under `anyclaw-server/`. The `broker/` and `mobile/` projects have their own tsconfigs; check those before assuming the same flags.

## Key Patterns

**Test filesystem isolation** — All anyclaw-server packages resolve paths through `AnyClawPaths`. Tests override the data root via:
```typescript
process.env.ANYCLAW_DATA_ROOT = await mkdtemp(join(os.tmpdir(), "anyclaw-"));
```
Never hardcode `/data/` in test code.

**libsodium version pin** — `libsodium-wrappers` is pinned to `0.7.15` in both `anyclaw-server` and `broker`. Do not upgrade: `0.7.16` ships a broken ESM build (`libsodium.mjs` is missing from the package).

**Deploy flow** — `DeployManager` in `@anyclaw/shared` is the canonical deploy entry point. It runs: validate worktree → snapshot DB → merge to main → copy artifacts to prod → signal logic-runner restart. Never implement deploy logic outside this class.

**MCP bearer tokens** — Each agent task gets a unique token from `registerTaskToken(taskId)` in `@anyclaw/mcp-server`. Always call `revokeTaskToken(taskId)` on task completion or failure, including in error paths.

**Broker frames** — All mobile↔server traffic is CBOR-encoded NaCl-boxed envelopes. The broker forwards frames without decrypting them. Never put plaintext user data in broker-routed messages.

## Commit Conventions

Follow the patterns in git log:
- `feat(<scope>): description` — new feature
- `fix(<scope>): description` — bug fix
- `docs: description` — documentation only
- `plan<N>/task<M>: description` — implementation task (for plan-driven work)

Scopes: `mobile`, `dispatch`, `mcp`, `broker`, `shared`, `tunnel`, `infra`.

## What's WIP

- **Tunnel integration** — `tunnel-manager` has a reconnect stub. The real WSS handshake with the broker (frame relay, service routing) is not yet implemented. Requires Docker environment to validate.
- **Docker build** — `infra/Dockerfile` written but never built on Linux. Validate with `docker build -f anyclaw-server/infra/Dockerfile anyclaw-server/` before treating the container as deployable.
- **Broker OAuth** — OAuth provider credentials must be configured via environment variables. See `broker/.env.example`.

## Architecture References

- `docs/design.md` — product principles, design language, agent behavior rules
- `docs/plan1-server-infrastructure-design.md` — monorepo layout, package roles, filesystem layout
- `docs/plan2-mcp-server-design.md` — MCP tool specs and auth flow
- `docs/plan3-agent-dispatch-design.md` — task lifecycle, adapter interface
- `docs/plan4-connection-broker-design.md` — broker protocol, tunnel handshake
- `docs/plan5-mobile-app-design.md` — mobile screens, bridge protocol
- `docs/plan6-skills-deployment-design.md` — skills, packaging, deployment
