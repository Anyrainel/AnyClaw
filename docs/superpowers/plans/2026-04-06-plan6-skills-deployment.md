# Plan 6: Skills + Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development when executing tasks in this plan. Dispatch independent tasks to sub-agents where possible (skill file authoring, script scaffolding, and Dockerfile are largely independent). Before any creative UI work, use superpowers:brainstorming. Use superpowers:test-driven-development for all TDD tasks below. For CHECKPOINT tasks, STOP and hand control back to the human reviewer.

**Goal:** Ship the five-skill agent prompt suite, the canonical Welcome page example, and the complete single-container deployment (Dockerfile + supervisord + install script + Hetzner guide) that installs and runs AnyClaw end-to-end.

**Architecture:** Skills are authored once under `/.anyclaw/skills/*.md` with YAML frontmatter and packaged per-agent (OpenClaw dir, Claude Code slash commands + CLAUDE.md, generic system prompt) by `package-skills.sh`. The Welcome page under `dev/_examples/welcome.tsx` is both the user's onboarding screen and the agent's canonical reference, demonstrating every style-guide pattern. Deployment is one Docker image running supervisord over five processes (pocketbase, tunnel-manager, dispatch-mcp, logic-service, prod-static), installed via a bash one-liner that bootstraps PocketBase, generates a master encryption key, and stores the user's LLM API key encrypted.

**Tech Stack:** Bash, Docker, supervisord, Tailwind v4, React, lucide-react, PocketBase JS SDK
**Dependencies:** Plans 1, 2, 3 (built artifacts), Plan 4 (for end-to-end testing)
**Plans that depend on this:** None — final plan.

**Plan Style Note:** This plan mixes rigid TDD tasks (scripts, packaging, install) with CHECKPOINT tasks (theme block, welcome page polish, skill prompt iteration with real agent).

---

## Task Overview

| # | Task | Style | Part |
|---|---|---|---|
| 1 | Author the 5 skill source files (verbatim from design doc) | Direct write | A |
| 2 | Skill frontmatter parser + semver compatibility module | TDD | A |
| 3 | `package-skills.sh` OpenClaw target | TDD | A |
| 4 | `package-skills.sh` Claude Code target (CLAUDE.md + slash commands) | TDD | A |
| 5 | `package-skills.sh` generic system prompt target | TDD | A |
| 6 | Dispatch-server `/api/version` endpoint + compatibility gate | TDD | A |
| 7 | **CHECKPOINT** — Skill prompt quality with a real agent build | Checkpoint | A |
| 8 | Provisional `@theme` block in `app.css` | Direct write | B |
| 9 | `usePreferences()` hook + PocketBase wiring | TDD | B |
| 10 | `tips` collection seed + `dev/_examples/` file structure | TDD | B |
| 11 | `dev/_examples/welcome.tsx` canonical component | TDD (logic) | B |
| 12 | **CHECKPOINT** — Welcome page visual polish (iterate `@theme`) | Checkpoint | B |
| 13 | `Dockerfile` with node, PocketBase, supervisord, infra code | Direct write | C |
| 14 | `supervisord.conf` with 5 supervised processes | Direct write | C |
| 15 | `docker-compose.yml` for self-hosted | Direct write | C |
| 16 | `bootstrap-pocketbase.sh` (admin + long-lived API token) | TDD | C |
| 17 | `store-api-key.js` (AES-256-GCM LLM key storage) | TDD | C |
| 18 | `install.sh` (prereqs, Docker, secrets, bootstrap, skills) | TDD | C |
| 19 | Hetzner single-VPS deployment guide (Caddy + per-user compose) | Doc | C |
| 20 | End-to-end smoke: fresh VM → curl install → tasks → rollback | Manual verify | C |

Targeting ~20 tasks. Tasks 1, 8, 13–15, 19 are direct writes or docs (the design doc provides verbatim content). Tasks 2–6, 9–11, 16–18 are TDD. Tasks 7, 12 are CHECKPOINTs. Task 20 is a manual end-to-end verification.

---

# PART A — Skills

## Task 1: Author skill source files (direct write)

**Rationale:** The design doc provides the full, verbatim text of all five skills. Copy them as-is; iteration happens at Task 7 after we see how a real agent behaves.

**Files to create:**
- `infra/skills/anyclaw-build-feature.md`
- `infra/skills/anyclaw-style-guide.md`
- `infra/skills/anyclaw-canonical-example.md`
- `infra/skills/anyclaw-refactor.md`
- `infra/skills/anyclaw-describe-version.md`

**Each file:**
- Begins with YAML frontmatter:
  ```yaml
  ---
  skill_version: "1.0.0"
  min_server_version: "0.1.0"
  ---
  ```
- Followed by the exact skill body from sections 2–6 of `docs/plan6-skills-deployment-design.md`. Do not paraphrase. Do not add a "Last updated" footer.

**Acceptance:**
- `ls infra/skills/*.md` returns 5 files.
- Every file begins with `---\nskill_version:` on line 1.
- `grep -c '^# anyclaw-' infra/skills/*.md` returns 1 per file.

---

## Task 2: Skill frontmatter parser + semver compatibility module (TDD)

**Location:** `infra/dispatch/src/skills/frontmatter.ts` (new module in the dispatch server from Plan 3).

**API:**
```ts
export interface SkillMeta {
  skillVersion: string;     // e.g. "1.0.0"
  minServerVersion: string; // e.g. "0.1.0"
}

export interface ParsedSkill {
  meta: SkillMeta;
  body: string;             // frontmatter stripped
}

export function parseSkillFile(raw: string): ParsedSkill;
export function isCompatible(
  skill: SkillMeta,
  serverVersion: string,
  minSkillVersion: string,
): { ok: true } | { ok: false; reason: string };
```

**Tests (write FIRST, must fail, then implement):**
1. `parseSkillFile` extracts `skill_version` and `min_server_version` from a valid YAML block.
2. `parseSkillFile` strips the frontmatter from `body` (body starts at first `#`).
3. `parseSkillFile` throws with a clear message when frontmatter is missing.
4. `parseSkillFile` throws when required keys are missing.
5. `isCompatible` returns `ok: true` when both directions satisfy.
6. `isCompatible` returns `ok: false` + reason when `skill.skillVersion < minSkillVersion`.
7. `isCompatible` returns `ok: false` + reason when `serverVersion < skill.minServerVersion`.
8. `isCompatible` handles patch-level differences correctly (`1.0.5 >= 1.0.0`).
9. `isCompatible` rejects invalid semver with a clear error.

Use the `semver` npm package for comparisons.

**Acceptance:** `npm test -- frontmatter` green. No `any`. 100% branch coverage on `isCompatible`.

---

## Task 3: `package-skills.sh` — OpenClaw target (TDD)

**Location:** `infra/scripts/package-skills.sh`

**Contract:**
```
package-skills.sh openclaw [--source DIR] [--dest DIR]
  defaults: --source /.anyclaw/skills --dest ~/.openclaw/skills
```

**Behavior:**
1. Verifies source dir exists and contains the 5 expected skill files.
2. Creates dest dir if absent.
3. For each `.md` in source, strip YAML frontmatter (first `---` to second `---` inclusive) and write to dest with the same filename.
4. Prints "Installed N skills to <dest>".
5. Exit 1 on any missing source file or write failure.

**Tests (bats or shellspec):**
1. Happy path: 5 files in, 5 files out, no frontmatter in output, body intact.
2. Missing source dir → exit 1 + error message.
3. Missing individual skill file → exit 1 listing which is missing.
4. Dest dir gets created if absent.
5. Pre-existing files in dest are overwritten.
6. Frontmatter-stripping preserves the first `# heading` line.

**Acceptance:** `bats infra/scripts/test/package-skills.bats` green.

---

## Task 4: `package-skills.sh` — Claude Code target (TDD)

**Extends** the same script with the `claude-code` subcommand.

**Contract:**
```
package-skills.sh claude-code [--project-dir DIR]
  defaults: --project-dir $PWD
```

**Behavior:**
1. Copies each skill `.md` (frontmatter stripped) into `<project-dir>/.claude/commands/anyclaw-*.md` so they become slash commands.
2. Appends (or replaces between sentinel markers) an `## AnyClaw Agent Instructions` block in `<project-dir>/CLAUDE.md`. The block:
   - Lists the 5 slash commands and when to use each (build-feature for every task, style-guide for frontend, canonical-example before frontend, refactor every 5 deployments, describe-version on every deploy).
   - Lists the AnyClaw MCP tool set (deploy, rollback, snapshot_db, create_collection, ask_user, update_progress, list_versions) and states that file/shell tools are the agent's own.
   - Is bounded by `<!-- anyclaw:begin -->` / `<!-- anyclaw:end -->` sentinels so re-runs are idempotent.
3. Creates `CLAUDE.md` if absent.

**Tests:**
1. Fresh project: both `.claude/commands/*.md` and `CLAUDE.md` created.
2. Re-run replaces the block (not duplicated) — sentinels stable.
3. Re-run does not touch content outside the sentinels.
4. Generated slash commands have no frontmatter.
5. The AnyClaw Agent Instructions block lists all 5 skills and all 7 MCP tools.

**Acceptance:** bats tests green. Manual read of a generated `CLAUDE.md` block.

---

## Task 5: `package-skills.sh` — generic system prompt target (TDD)

**Contract:**
```
package-skills.sh generic [--source DIR] [--out FILE]
  defaults: --source /.anyclaw/skills --out /.anyclaw/skills/system-prompt.txt
```

**Behavior:**
1. Concatenates the 5 skill bodies (frontmatter stripped) in the order: build-feature, canonical-example, style-guide, refactor, describe-version.
2. Separates each with a `\n\n---\n\n` rule.
3. Prepends a 3-line preamble: `# AnyClaw Agent System Prompt` / `# Combined skill suite — do not edit, regenerate via package-skills.sh generic.` / blank line.
4. Writes to `--out`.

**Tests:**
1. Output file exists and contains all 5 skill bodies in the specified order.
2. No frontmatter in output.
3. Preamble is present.
4. Re-run overwrites cleanly.

**Acceptance:** bats green. Eyeball the generated file.

---

## Task 6: Dispatch-server `/api/version` endpoint + compatibility gate (TDD)

**Location:** `infra/dispatch/src/routes/version.ts` + hook into task-dispatch flow.

**Endpoint:**
```
GET /api/version
→ {
    "server_version":    "0.1.0",   // from package.json
    "min_skill_version": "1.0.0"    // from dispatch config
  }
```

**Dispatch-time gate:** When the dispatch server assembles the skill set for an agent subprocess, it calls `parseSkillFile` on each and runs `isCompatible`. If any skill is incompatible, the task is rejected with a user-facing error: `"Skill <name> v<x> requires server >= <y>. Update the AnyClaw server."` or the reverse.

**Tests:**
1. `GET /api/version` returns the package.json version and the configured `min_skill_version`.
2. Dispatch with all compatible skills → task proceeds.
3. Dispatch with a skill whose `skill_version < min_skill_version` → task rejected with the exact error string.
4. Dispatch with a skill whose `min_server_version > server_version` → rejected.
5. Rejection error message names the offending skill.

**Acceptance:** Unit tests + one integration test that spins up the dispatch server and dispatches a task with a doctored skill file.

---

## Task 7: **CHECKPOINT** — Skill prompt quality with a real agent build

**Goal:** Catch sloppy skill prose before it calcifies. Skill text is the UX of the agent.

**Procedure:**
1. Spin up a local dispatch server with packaged skills (run Tasks 3–5 output).
2. Use a real Claude Code or OpenClaw process to dispatch ONE canned feature request: `"Build me a daily mood tracker with a weekly chart."`
3. Observe:
   - Does the agent call `anyclaw_list_versions` first? (Step 0)
   - Does the agent ask any "bad" detail questions (colors, names)?
   - Does the agent read `dev/_examples/welcome.tsx` before writing frontend code?
   - Does the agent run the full lint/typecheck/build/test cycle?
   - Is the version description direct and non-technical?
4. Record deviations. For each, decide: fix the skill prose OR accept as agent quirk.
5. Edit the skill files in place. Bump `skill_version` in frontmatter on any changed file. Re-run `package-skills.sh`.
6. Repeat once more to confirm the fix landed.

**STOP for human review.** Present the recorded agent behavior and proposed skill edits. Do not proceed to Task 8 until the reviewer signs off.

**Exit criteria:** Reviewer confirms skill behavior is acceptable for v1. All 5 skills pinned at their current frontmatter versions.

---

# PART B — The Welcome Page (canonical example)

## Task 8: Provisional `@theme` block in `app.css` (direct write)

**Location:** `dev/packages/frontend/src/app.css`

**Content:** The `@import "tailwindcss";` + `@theme { ... }` + dark-mode `@media` block verbatim from section 3 of the design doc (lines 362–443). These are provisional values — the CHECKPOINT in Task 12 iterates them to meet the Design Language goals from the spec (warm off-white backgrounds, soft corners, generous whitespace, subtle elevation).

**Rules:**
- Only this single CSS file. No `tailwind.config.ts`.
- All tokens are `oklch()` colors, rem spacing, rem typography.
- Radius, shadow, typography tokens match the design doc exactly.

**Acceptance:** `dev/packages/frontend/src/app.css` exists with the full `@theme` block. `npm run build` in `packages/frontend` succeeds. No `tailwind.config.*` file anywhere.

---

## Task 9: `usePreferences()` hook (TDD)

**Location:** `dev/packages/frontend/src/hooks/usePreferences.ts` + `dev/packages/frontend/src/lib/pocketbase.ts`

**API:**
```ts
export interface Preferences {
  theme: "system" | "light" | "dark";
  fontSize: "small" | "medium" | "large";
  fontFamily: "sans" | "serif";
  accent: "blue" | "teal" | "green" | "amber" | "rose" | "violet";
  language: string;  // BCP-47
}

export function usePreferences(): Preferences;
```

**Behavior:**
- On mount: fetches the single `user_preferences` record from PocketBase.
- Subscribes to real-time updates.
- Returns sensible defaults synchronously (theme: system, fontSize: medium, fontFamily: sans, accent: blue, language: navigator.language) while loading.
- Cleans up the subscription on unmount.

**Tests (React Testing Library + mocked `pb` client):**
1. Returns defaults before fetch resolves.
2. Returns server values after fetch.
3. Updates when the real-time subscription fires a change event.
4. Unsubscribes on unmount.
5. On fetch error, retains defaults and logs (not throws).

**Acceptance:** Tests green. Type-exported `Preferences`. No `any`.

---

## Task 10: `tips` collection seed + `dev/_examples/` directory structure (TDD)

**Goal:** The welcome page reads from a `tips` collection (simpler, more self-contained than the `tasks` collection referenced in the design doc's sample code — tasks belong to the mobile app model, not the user's own data). The collection seeds with 3 example tips on fresh install.

**Files:**
- `infra/scripts/seed-welcome-collection.js` — creates the `tips` collection via `anyclaw_create_collection` and inserts 3 rows.
- `dev/_examples/README.md` — one-line explanation: "Read-only reference files for the agent. Do not modify."
- `dev/_examples/.gitkeep`

**`tips` schema:**
```
tips (base)
  title    text, required, max 80
  body     text, required, max 240
  icon     text, required   // lucide icon name
  created  autodate (onCreate)
```

**Seed data:**
1. `{ title: "Try a feature request", body: "Tap Request and describe what you want in plain words.", icon: "Sparkles" }`
2. `{ title: "Every change is versioned", body: "Rolling back is one tap. Nothing is permanent.", icon: "History" }`
3. `{ title: "The agent learns as you go", body: "Your preferences carry forward. You won't be asked twice.", icon: "BookOpen" }`

**Tests:**
1. Running the seed script against a fresh PocketBase creates the collection.
2. Running it twice is idempotent (no duplicate collection, no duplicate rows with same title).
3. Collection schema matches exactly.

**Acceptance:** Script tested against a scratch PocketBase. `dev/_examples/` directory committed with README + .gitkeep.

---

## Task 11: `dev/_examples/welcome.tsx` canonical component (TDD for logic)

**Location:** `dev/_examples/welcome.tsx` AND `dev/packages/frontend/src/pages/Home.tsx` (initial duplicate; `Home.tsx` may be overwritten by the first agent-built feature).

**Structure:** Adapt the file from section 15 of the design doc (lines 1527–1681) with these changes:
- Data source is the `tips` collection (Task 10), not `tasks`.
- Typed `Tip` record replaces `RecentTask`.
- The "Recent activity" section becomes "Things to know" — a list of tips.
- The `StatusPill` helper becomes a `TipIcon` helper that renders the named lucide icon.
- Everything else (header, example prompts, footer, states, hooks, voice) stays.
- `EXAMPLE_PROMPTS` constant stays.
- `usePreferences()` used in the footer.
- Explicit loading / error / empty states each with their own copy.
- Real-time subscription + cleanup.

**Tests (React Testing Library, `pb` mocked):**
1. Renders loading state initially with text "Loading tips..." (not a naked spinner).
2. Renders error state with explicit message on fetch failure.
3. Renders empty state with onboarding copy when 0 tips.
4. Renders all 3 seed tips when fetch resolves.
5. Subscribes on mount, unsubscribes on unmount.
6. Footer prints `prefs.theme` and `prefs.accent`.
7. No `any` type, no `@ts-ignore`.
8. File under 200 lines (including the co-located helper).
9. No hardcoded colors — `grep -E '#[0-9a-f]{3,6}|bg-(red|blue|green)-' welcome.tsx` returns nothing.

**Acceptance:** Tests green. File satisfies every style-guide rule (run the style-guide checklist manually against it).

---

## Task 12: **CHECKPOINT** — Welcome page visual polish

**Goal:** The `@theme` values from Task 8 are provisional. The Welcome page is the user's first impression and the agent's canonical example — both need to look right.

**Procedure:**
1. Run `npm run dev` inside `dev/packages/frontend/`.
2. View the welcome page at 375×812 (mobile), 768×1024 (tablet), and desktop.
3. View in both light and dark mode (`prefers-color-scheme`).
4. Check against the Design Language principles from the spec:
   - Soft corners (not sharp).
   - Generous whitespace (calm density).
   - Restrained color (grayscale + single accent).
   - Strong typographic hierarchy.
   - Subtle elevation (soft shadows, not heavy borders).
   - Warm neutrals (off-white background, not pure white).
5. Iterate the `@theme` values in `app.css` only. Do NOT alter the welcome component's structure or classNames. The goal is that the existing semantic tokens produce the right look.
6. Verify each accent color (blue/teal/green/amber/rose/violet) is represented in `--color-primary` options (add accent switching later, but confirm the base value feels correct).

**STOP for human review.** Present screenshots at mobile + desktop, light + dark. Reviewer approves the `@theme` block or requests specific changes.

**Exit criteria:** Reviewer sign-off on the welcome page look. `@theme` block locked in `app.css`.

---

# PART C — Deployment

## Task 13: `Dockerfile` (direct write)

**Location:** `infra/Dockerfile`

**Content:** Verbatim from section 12 of the design doc (lines 1197–1257). Key properties:
- Base: `node:20-bookworm-slim`.
- Installs: supervisor, git, curl, build-essential, python3, wget, unzip, tini.
- Downloads PocketBase v0.22.0 linux amd64 binary.
- Creates `anyclaw-infra` + `anyclaw-agent` system users.
- Copies `infra/` → `/.anyclaw/` owned by `anyclaw-infra`.
- Runs `npm ci --omit=dev` in each infra subpackage (dispatch, tunnel, prod-static).
- Creates `/data/*` tree with correct ownership (`anyclaw-infra` owns everything except `/data/dev/` which is `anyclaw-agent`).
- `chmod 0750 /data/.anyclaw`.
- Copies supervisord.conf to `/etc/supervisor/conf.d/anyclaw.conf`.
- `EXPOSE 8090 5173`, `VOLUME /data`.
- `ENTRYPOINT tini --` + `CMD supervisord -c ...`.

**Acceptance:** `docker build -t anyclaw:test infra/` succeeds from a clean checkout. Image size printed. `docker run --rm anyclaw:test cat /.anyclaw/supervisord.conf` works (once Task 14 is done).

---

## Task 14: `supervisord.conf` (direct write)

**Location:** `infra/supervisord.conf`

**Content:** Verbatim from section 11 of the design doc (lines 1140–1191). Five `[program:*]` blocks:
- `pocketbase`: `autorestart=true`, `user=anyclaw-infra`, `:8090`, data dir `/data/pocketbase/pb_data`.
- `tunnel-manager`: `autorestart=true`, `user=anyclaw-infra`, reads `BROKER_URL` + `ANYCLAW_USER_TOKEN` from environment.
- `dispatch-mcp`: `autorestart=true`, `user=anyclaw-infra`, env `POCKETBASE_URL`, `DEV_WORKSPACE`, `PROD_WORKSPACE`, `SNAPSHOTS_DIR`, `INFRA_DIR`.
- `logic-service`: `autorestart=unexpected`, `exitcodes=0`, runs `/data/prod/logic-build/index.js`.
- `prod-static`: `autorestart=true`, user `anyclaw-infra`, serves `/data/prod/frontend-build` on `:5173`.

All logs to `/var/log/anyclaw/*.log` / `.err`.

**Acceptance:** `supervisord -c infra/supervisord.conf -t` (validation mode) succeeds inside the container.

---

## Task 15: `docker-compose.yml` for self-hosted (direct write)

**Location:** `infra/docker-compose.yml` (also published at the release URL referenced by the install script).

**Content:** Verbatim from section 13 of the design doc (lines 1263–1286):
- One service `anyclaw` from `ghcr.io/anyclaw/anyclaw:latest`.
- `restart: unless-stopped`.
- Host ports `127.0.0.1:8090:8090` and `127.0.0.1:5173:5173` (loopback only).
- Named volume `anyclaw_data:/data`.
- Env passthrough for `BROKER_URL` and `ANYCLAW_USER_TOKEN`.
- Resource limits `cpus: 4.0`, `memory: 4G`.

**Also create** `infra/env.template`:
```
# AnyClaw self-hosted configuration
BROKER_URL=https://broker.anyclawapp.com
ANYCLAW_USER_TOKEN=
```

**Acceptance:** `docker compose -f infra/docker-compose.yml config` validates.

---

## Task 16: `bootstrap-pocketbase.sh` (TDD)

**Location:** `infra/scripts/bootstrap-pocketbase.sh`

**Behavior:**
1. If `/data/.anyclaw/pb-token` exists, exit 0 (idempotent).
2. Generate a 32-char random password, write to `/data/.anyclaw/pb-admin` (mode 0600, owned `anyclaw-infra`).
3. Run `pocketbase superuser create admin@local "<password>"` non-interactively.
4. `curl -s -X POST http://127.0.0.1:8090/api/admins/auth-with-password` with the creds → extract the JWT.
5. `curl -s -X POST http://127.0.0.1:8090/api/collections/_superusers/impersonate/<id>` with JWT, `duration=3153600000` (100 years) → extract the impersonation token.
6. Write token to `/data/.anyclaw/pb-token` (mode 0600, owned `anyclaw-infra`).
7. Print `"PocketBase bootstrap complete."` on success.

**Tests (bats against a pocketbase container):**
1. Fresh run creates both files with correct modes and owners.
2. Second run exits 0 without modifying existing files (stat mtime unchanged).
3. If PocketBase is down, exits non-zero with a clear message.
4. If superuser creation fails, does not leave a half-created pb-admin file.

**Acceptance:** bats tests green against a real pocketbase binary in a throwaway dir.

---

## Task 17: `store-api-key.js` (TDD)

**Location:** `infra/scripts/store-api-key.js`

**Behavior:**
- Reads `/data/.anyclaw/master.key` (base64) → decoded 32-byte key.
- Reads `LLM_KEY` from environment.
- AES-256-GCM encrypts `LLM_KEY` with a random 12-byte IV.
- POSTs to the dispatch server's internal endpoint `http://127.0.0.1:3002/internal/api-keys` with `{ provider, ciphertext (base64), iv (base64), authTag (base64) }`.
- Upserts by `provider` (dispatch endpoint implements upsert).
- CLI: `node store-api-key.js --provider anthropic`.

**Tests:**
1. Encrypts a known plaintext with a known key and IV → matches a fixture produced offline.
2. Fails cleanly when `master.key` is missing.
3. Fails cleanly when `LLM_KEY` env var is empty.
4. POST body contains all 4 fields in base64.
5. Dispatch endpoint mock records the upsert.

**Acceptance:** Unit tests green. A roundtrip test (store → retrieve via dispatch) decrypts correctly.

---

## Task 18: `install.sh` (TDD)

**Location:** `infra/install.sh` (served at `https://get.anyclawapp.com`).

**Content:** Verbatim from section 14 of the design doc (lines 1301–1477). The full bash script in six phases:

```bash
#!/usr/bin/env bash
set -euo pipefail

ANYCLAW_VERSION="${ANYCLAW_VERSION:-latest}"
INSTALL_DIR="${ANYCLAW_DIR:-$HOME/.anyclaw-host}"

echo "=== AnyClaw Installer ==="

# [1/6] Prerequisites — OS check, cgroup v2 warning, RAM + disk warnings.
# [2/6] Docker — install via get.docker.com on Linux if missing, verify daemon + compose v2.
# [3/6] Install directory — mkdir, fetch docker-compose.yml + env.template from releases URL.
# [4/6] Secrets — generate ANYCLAW_USER_TOKEN, prompt LLM provider + API key (read -rsp).
# [5/6] Pull + start — docker compose pull/up, wait for /api/health, run bootstrap-pocketbase.sh,
#       generate master.key (openssl rand), store-api-key.js with LLM_KEY env.
# [6/6] Package skills — detect openclaw/claude binary, exec package-skills.sh accordingly.

# Final: print install dir, log command, stop command, "open the mobile app" banner.
```

(Full text comes from the design doc — copy verbatim. Do not invent new steps.)

**Tests (bats against a mock `docker` shim):**
1. Fresh install on a Linux-like env: all 6 phases execute, exit 0.
2. Re-run with existing `.env`: preserves config, skips LLM prompt.
3. Missing Docker on macOS → exits with "install Docker Desktop" message.
4. Docker daemon down → exits with clear error.
5. Unknown OS → exits 1.
6. `<2GB RAM` path → prints warning but continues.
7. LLM key prompt is silent (`read -rsp`) — verified by checking no echo.
8. Detects `openclaw` → runs `package-skills.sh openclaw`.
9. Detects `claude` → runs `package-skills.sh claude-code`.
10. Detects neither → prints generic MCP URL instructions.

**Acceptance:** bats green. Manual dry-run against a real Docker on a throwaway VM.

---

## Task 19: Hetzner deployment guide (doc)

**Location:** `docs/deployment/hetzner-phase1.md`

**Contents:**
- Target: single Hetzner CX32 VPS (4 vCPU, 8GB RAM, 80GB), Ashburn region.
- Base OS: Ubuntu 24.04 LTS.
- Install Docker via `get.docker.com`.
- Install Caddy as a system package.
- Create `/opt/anyclaw/` layout (from section 16, lines 1705–1718):
  - `provisioner/docker-compose.yml`
  - `caddy/Caddyfile`
  - `users/user-<id>/docker-compose.yml` (templated per user)
- Example `Caddyfile` that terminates TLS on `broker.anyclawapp.com` and reverse-proxies WSS to the broker process.
- Per-user compose template: unique container name, unique volume, no host port bindings (all ingress via tunnel).
- Provisioner responsibilities (lines 1729–1735):
  - Allocate unique `ANYCLAW_USER_TOKEN` per user.
  - Create/start/stop/destroy containers.
  - Per-user resource limits: `cpus: 0.5`, `memory: 512M` baseline.
  - Idle shutdown after 30 min of tunnel inactivity; wake on broker message.
- Backup: nightly `tar czf` of `/opt/anyclaw/users/*/data/pocketbase/pb_data` to offsite storage.
- Monitoring: `docker stats` + a simple cron that counts running containers.
- Migration path to Phase 2 (microVMs / K8s Agent Sandbox): same image, different scheduler — one paragraph.
- **Security:** only the tunnel manager talks outbound (WSS to broker). No public ports on the VPS except 443 for Caddy. `ufw` rules listed.

**Acceptance:** Doc reviewed. Every command in the doc copy-pastes into a fresh VPS and works (verify at Task 20).

---

## Task 20: End-to-end smoke test (manual verify)

**Goal:** Prove the whole install flow works on a fresh environment.

**Procedure:**
1. Spin up a clean Hetzner CX32 VPS (or a local Ubuntu 24.04 VM).
2. Run `curl -fsSL https://get.anyclawapp.com | bash` (point the install script at a local release mirror during testing).
3. Verify all 5 supervised processes are running: `docker compose exec anyclaw supervisorctl status`.
4. Verify `/data/.anyclaw/pb-token` exists (0600, anyclaw-infra).
5. Verify `/data/.anyclaw/master.key` exists (0600).
6. Verify the `api_keys` collection in PocketBase contains one encrypted row for the chosen provider.
7. Verify the welcome page renders at `http://127.0.0.1:5173/`.
8. Hit `GET http://127.0.0.1:3002/api/version` → version JSON.
9. Dispatch a trivial task through the MCP endpoint and watch it complete: progress updates → deploy → version row.
10. Roll the deploy back via `anyclaw_rollback` → prior version restored.
11. `docker compose down` + `docker compose up -d` → everything comes back, no data loss.
12. Follow the Hetzner guide (Task 19) to add a second user container; verify isolation (one user's `/data` is invisible to the other).

**Acceptance:** Checklist passes end-to-end. Any failure → file a bug, fix, re-run.

---

## Summary

This plan delivers, in order:
1. The five skill files, packaged three ways, with bidirectional semver gating.
2. A canonical welcome page that is both onboarding UX and agent reference material, sitting on a provisional `@theme` block iterated at a visual checkpoint.
3. A complete single-container deployment — Dockerfile, supervisord, compose file, install script, and Hetzner guide — with LLM API keys encrypted at rest and zero application secrets in `.env`.

After Task 20, AnyClaw can be installed from scratch by a user with one curl command, can receive a feature request from the mobile app, can dispatch it to an agent, and can deploy the result. All six plans compose into a working end-to-end product.
