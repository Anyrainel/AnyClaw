# anyclaw-server

Server-side monorepo for AnyClaw. See docs/superpowers/specs/2026-04-04-anyclaw-design.md.

Packages:
- `shared` — crypto, snapshots, version store, worktrees, deploy manager, rollback manager
- `dispatch` — single Express app on :4100 (scaffold in Plan 1, MCP routes in Plan 2, REST + adapters in Plan 3)
- `tunnel-manager` — persistent WSS connection to broker (routing logic in Plan 1, real WSS in Plan 4)
- `logic-runner` — supervises agent-built logic service from `/data/prod/logic-build/` on :3000
- `prod-static` — serves `/data/prod/frontend-build/` on :5173 with SPA fallback
- `frontend-template` — Vite + React + Tailwind v4 seed copied into `/data/dev/` on first run
