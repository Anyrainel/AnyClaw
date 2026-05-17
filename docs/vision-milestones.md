# AnyRaven Vision Milestones

This document tracks the path from the current MVP deployment to the full
self-evolving app experience. Each milestone must produce evidence from the
`proclaw-test` deployment before it is considered done.

## Operating Principles

- The template is deployed once for real users. Template refresh scripts are
  only for current MVP iteration on the baseline.
- Real product work happens in the deployed live app repo at `/data/dev`.
- Agent-authored app changes must be git-tracked, buildable, deployable, and
  observable from AnyRaven.
- Docker owns the stable runtime boundary. App deploys should promote artifacts
  and restart app services, not rebuild the entire infra image.
- Use plain runtime names:
  - `app-frontend`: built SPA assets served at `:5173`
  - `app-backend`: agent-authored backend runtime served at `:3000`
  - `dispatch`: AnyRaven control-plane API at `:4100`

## Current Baseline Evidence

Verified on `proclaw-test`:

- `scripts/e2e-smoke.sh` passed.
- `app-frontend`, `app-backend`, `dispatch`, `pocketbase`, and
  `tunnel-manager` are supervised and running.
- `http://127.0.0.1:5173/` is reachable as the canonical app surface.
- `http://127.0.0.1:4100/api/health` is reachable.
- Dispatch can create, list, and read a task.

Local verification:

- `npm run build`
- `npm run typecheck`
- `npx vitest run arch.test.ts packages/shared/test/paths.test.ts packages/shared/test/deployManager.test.ts packages/shared/test/rollbackManager.test.ts packages/app-backend/test/fallback.test.ts packages/app-backend/test/runner.test.ts packages/app-frontend/test/server.test.ts packages/frontend-template/test/welcome.test.ts packages/frontend-template/test/examples-dir.test.ts`

## Milestone 1: Live App Deployment Contract

Goal: agent-authored frontend/backend changes in `/data/dev` can be promoted to
the running app services without rebuilding Docker.

Scope:

- Finalize the app repo layout expected under `/data/dev`.
- Define canonical build outputs:
  - frontend: `/data/dev/dist` promoted to `/data/prod/app-frontend`
  - backend: `/data/dev/app-backend` or `/data/dev/app-backend/dist` promoted to `/data/prod/app-backend`
- Make `scripts/deploy-live-app.sh` the explicit MVP deployment path.
- Surface deploy status and errors in dispatch task records.
- Replace no-op app-backend restart hooks with real supervisor restart hooks.

Evidence:

- Start from a clean `proclaw-test` container.
- Change `/data/dev` frontend text, commit it, run deploy, refresh `:5173`, and see the change.
- Add a minimal `/data/dev/app-backend/index.js`, deploy, and verify `:3000` responds.
- Confirm no Docker rebuild happens during app deploy.
- Confirm git history records the app change.

## Milestone 2: AnyRaven Control Plane UX

Goal: the AnyRaven tab is the user-facing mechanism for evolving the app.

Scope:

- Keep three baseline tabs: Home, Tutorial, AnyRaven.
- AnyRaven overview shows current work, recent feature requests, and history.
- Drill-ins for settings, work history, and feature request sessions.
- New feature request flow supports progress, clarification, cancel, done,
  failed, commit, and deployment status.
- Settings includes connections/services, appearance, density, theme, and
  future agent defaults.

Evidence:

- Frontend tests cover all three tabs and AnyRaven drill-ins.
- Browser/mobile viewport smoke confirms no text overlap.
- Creating a feature request in the UI creates a dispatch task.
- Task progress from dispatch appears in the AnyRaven tab without refresh.

## Milestone 3: Agent Work Loop Reliability

Goal: the agent can safely implement app changes from a user request with a
high success rate.

Scope:

- Task creates isolated worktree from `/data/dev`.
- Agent receives the right app contract, style guide, deploy instructions, and
  allowed tools.
- Agent runs focused tests/builds before deploy.
- Clarifications are routed through AnyRaven.
- Failed work leaves the live app untouched.

Evidence:

- Request: "change the Home tab copy" completes without manual intervention.
- Request: "add a simple local app feature" completes with commit and deploy.
- Failed build path is simulated and leaves `:5173` unchanged.
- Task history shows progress, error, commit, and deployment fields.

## Milestone 4: App Backend Runtime

Goal: users can ask for features that require backend endpoints, and the mobile
client has a stable route to call them.

Scope:

- Define `/api/app/*` routing to `app-backend`.
- Keep `/api/anyraven/*` or equivalent for control-plane APIs.
- Add app-backend health/readiness checks.
- Add sandbox/resource boundaries for agent-authored backend code.
- Define persistence rules: when to use PocketBase collections vs app-backend
  code.

Evidence:

- Deploy a minimal app-backend endpoint and reach it through the intended route.
- App frontend can call app-backend through the stable route.
- Backend crash returns controlled failure and supervisor recovers/falls back.
- AnyRaven shows backend deploy health.

## Milestone 5: Mobile Client Integration

Goal: the mobile client can discover, load, and interact with the current
deployed app.

Scope:

- Define the mobile app manifest/discovery response.
- Mobile knows app frontend URL, app backend URL, AnyRaven/control API URL, and
  compatibility/version info.
- Connection settings in AnyRaven map to actual mobile connectivity state.
- Decide WebView vs native shell boundaries for the free canvas.

Evidence:

- Mobile client connects to `proclaw-test`.
- Mobile loads the current app frontend.
- Mobile can submit a feature request through AnyRaven/control APIs.
- Mobile survives app deploy/reload without manual reconfiguration.

## Milestone 6: Versioning, Rollback, and Safety

Goal: every app evolution is reversible and inspectable.

Scope:

- Version app-frontend and app-backend deploys together.
- Snapshot PocketBase when schema/data changes.
- Implement rollback for frontend, backend, and DB snapshot.
- Show version history and rollback status in AnyRaven.

Evidence:

- Deploy version A, deploy version B, rollback to A.
- Frontend, backend, and DB state match the selected version.
- Rollback event appears in task/version history.

## Milestone 7: Production Serving Shape

Goal: user's own server has a serious production serving model.

Scope:

- Replace MVP Vite dev serving with app-frontend static serving for production.
- Keep dev/HMR mode only for local/MVP iteration.
- Add cache policy: immutable hashed assets, no-cache `index.html`.
- Decide reverse proxy shape for `/`, `/api/app/*`, and `/api/anyraven/*`.
- Add TLS/domain assumptions for a real server.

Evidence:

- `APP_FRONTEND_SERVER_MODE=static` serves a deployed build from `/data/prod/app-frontend`.
- Unknown SPA routes fall back to `index.html`.
- Hashed assets get long-lived cache headers.
- API routes remain separate and reachable.

## Milestone 8: End-to-End Demo

Goal: prove the complete AnyRaven loop.

Scenario:

1. Fresh user gets the baseline template.
2. User opens AnyRaven and asks for a small app feature.
3. Agent edits the live app repo in an isolated worktree.
4. Agent builds/tests, commits, deploys app-frontend/app-backend artifacts.
5. Web and mobile clients show the new feature.
6. AnyRaven shows the request, commit, deployment, and version history.
7. Rollback restores the prior version.

Evidence:

- Single scripted or documented run against `proclaw-test`.
- All commands, URLs, task IDs, commits, and screenshots/log snippets captured.
- No manual code edits during the demo after the feature request is submitted.
