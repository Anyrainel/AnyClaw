# AnyRaven

> **Work in progress — not functional yet.**

AnyRaven is a self-evolving AI companion app. A personal coding agent automatically designs, builds, and deploys a personalized full-stack web application; the user accesses it through a companion mobile app and submits feature requests in plain language. The agent handles clarification, implementation, testing, and deployment end-to-end.

AnyRaven is **agent-agnostic** — it does not bundle a coding agent. It provides infrastructure and a mobile shell that works with any MCP-compatible agent (Claude Code, OpenClaw, and others).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  mobile/              React Native companion app             │
│  (Expo, iOS/Android)  WebView, task submission, versions     │
└────────────────────────────┬────────────────────────────────┘
                             │ WSS (encrypted, via broker)
┌────────────────────────────▼────────────────────────────────┐
│  broker/              Connection relay + auth service        │
│  (Fastify, PostgreSQL) OAuth, pairing, binary frame relay   │
└────────────────────────────┬────────────────────────────────┘
                             │ WSS tunnel (tunnel-manager)
┌────────────────────────────▼────────────────────────────────┐
│  anyclaw-server/      Per-user server (Docker or bare host)  │
│  ├── dispatch         Task orchestration + REST API :4100    │
│  ├── mcp-server       MCP tools for coding agents            │
│  ├── tunnel-manager   Persistent WSS tunnel to broker        │
│  ├── app-backend     Supervises agent-built logic :3000     │
│  ├── app-frontend      Serves agent-built frontend :5173      │
│  ├── shared           Crypto, deploy, rollback, worktrees    │
│  ├── frontend-template Vite+React seed copied on first run   │
│  └── PocketBase       Database + realtime :8090              │
└─────────────────────────────────────────────────────────────┘
```

## Repository Layout

```
AnyRaven/
├── broker/             Auth + relay service (deploy to cloud)
├── mobile/             Expo companion app (iOS / Android / Web)
├── anyclaw-server/     Server monorepo (runs per-user, in Docker)
│   └── packages/
│       ├── shared/
│       ├── dispatch/
│       ├── mcp-server/
│       ├── tunnel-manager/
│       ├── app-backend/
│       ├── app-frontend/
│       └── frontend-template/
└── docs/               Architecture and design documentation
    ├── design.md                    Product overview and principles
    ├── plan1-server-infrastructure-design.md
    ├── plan2-mcp-server-design.md
    ├── plan3-agent-dispatch-design.md
    ├── plan4-connection-broker-design.md
    ├── plan5-mobile-app-design.md
    ├── plan6-skills-deployment-design.md
    ├── IMPLEMENTATION_NOTES.md
    ├── deployment/hetzner-phase1.md
    └── tasks/                       Completed implementation task lists
```

## Component READMEs

- [broker/README.md](broker/README.md)
- [mobile/README.md](mobile/README.md)
- [anyclaw-server/README.md](anyclaw-server/README.md)

## Key Design Decisions

- **Single container per user.** No multi-container split. One Docker container runs all five supervised processes via `supervisord`.
- **Agent-agnostic.** The dispatch layer has pluggable adapters. The MCP server speaks the standard protocol; any MCP-capable agent works.
- **End-to-end encrypted.** All mobile↔server traffic is NaCl-boxed through the broker. The broker sees only opaque binary frames.
- **Git-backed versioning.** Every deploy is a git commit. Rollback reverts both code and the SQLite snapshot taken before deployment.
- **User cannot see the code.** The only control surface is the mobile app. Errors must be explicit, versions must be descriptive, and every deploy must pass the full test cycle before promoting.

## Development Setup

After cloning, configure the git hooks:

```bash
bash scripts/setup-hooks.sh
```

Pre-commit runs typecheck + tests scoped to changed modules. Pre-push runs the full suite. Both can be skipped with `--no-verify` when Docker is unavailable (broker tests require Docker for testcontainers).

## Documentation

Start with [docs/design.md](docs/design.md) for product principles and design language, then the numbered plan docs for each subsystem's architecture.
