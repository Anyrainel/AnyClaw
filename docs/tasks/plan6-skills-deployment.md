# Plan 6: Skills + Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development when executing tasks in this plan. Dispatch independent tasks to sub-agents where possible (skill file authoring, script scaffolding, and install.sh are largely independent). Before any creative UI work, use superpowers:brainstorming. Use superpowers:test-driven-development for all TDD tasks below. For CHECKPOINT tasks, STOP and hand control back to the human reviewer.

**Goal:** Ship the five-skill agent prompt suite, the canonical Welcome page content (on top of Plan 1's frontend-template scaffold), the final locked `@theme` block, the user-facing `install.sh` one-command installer, and the Hetzner deployment guide.

**Architecture:** Skills are authored once under `anyraven-server/skills/raw/*.md` with YAML frontmatter and packaged per-agent (OpenClaw dir, Claude Code slash commands + CLAUDE.md, generic system prompt) by `package-skills.sh`. The Welcome page under `/data/dev/packages/frontend/src/_examples/welcome.tsx` is both the user's onboarding screen and the agent's canonical reference, demonstrating every style-guide pattern. Deployment pieces owned by Plan 1 (Dockerfile, supervisord.conf, init-data-layout.sh, download-pocketbase.sh, frontend-template package, tunnel-manager, app-backend, app-frontend, dispatch) are consumed here — Plan 6 adds the skills bundle into the image, ships the user-facing `install.sh`, and writes the Hetzner guide.

**Division of ownership (binding):**
- **Plan 1 owns:** `anyraven-server/infra/Dockerfile`, `anyraven-server/infra/supervisord.conf`, `anyraven-server/scripts/init-data-layout.sh`, `anyraven-server/scripts/download-pocketbase.sh`, the `frontend-template` package (Vite + Tailwind v4 scaffold with a PROVISIONAL `@theme` block), and the `tunnel-manager` / `app-backend` / `app-frontend` / `dispatch` packages.
- **Plan 6 owns:** skill source files, `package-skills.sh`, the user-facing `install.sh`, the Welcome page CONTENT (canonical example), the FINAL `@theme` block (locked through the visual checkpoint), and the Hetzner deployment guide.
- **Plan 3 provides:** `POST /internal/api-keys` on port **4100** (used by `install.sh` at bootstrap time).

**PocketBase version (locked):** Both the binary and the `pocketbase` JS SDK are pinned to **0.25.x** — this is the release line where the `_superusers` collection rename has stabilized. All auth/superuser/impersonation flows in this plan assume 0.25.x semantics. **Verify these versions before starting the plan** and update all references if a newer patch is chosen.

**Tech Stack:** Bash, Tailwind v4, React, lucide-react, PocketBase 0.25.x JS SDK
**Dependencies:** Plans 1, 2, 3 (built artifacts, including Plan 1's Dockerfile/supervisord/frontend-template and Plan 3's `/internal/api-keys` endpoint), Plan 4 (for end-to-end testing)
**Plans that depend on this:** None — final plan.

**Plan Style Note:** This plan mixes rigid TDD tasks (scripts, packaging, install) with CHECKPOINT tasks (final theme block, welcome page polish, skill prompt iteration with real agent).

---

## Task Overview

| # | Task | Style | Part |
|---|---|---|---|
| 1 | Author the 5 skill source files (verbatim from design doc) | Direct write | A |
| 2 | Skill frontmatter parser + semver compatibility module | TDD | A |
| 3 | `package-skills.sh` OpenClaw target | TDD | A |
| 4 | `package-skills.sh` Claude Code target (CLAUDE.md + slash commands) | TDD | A |
| 5 | `package-skills.sh` generic system prompt target | TDD | A |
| 6 | Dispatch `/api/version` endpoint + compatibility gate | TDD | A |
| 7 | Extend Plan 1's Dockerfile to bundle the skills directory | Direct write | A |
| 8 | **CHECKPOINT** — Skill prompt quality with a real agent build | Checkpoint | A |
| 9 | Welcome page content on Plan 1's frontend-template (`welcome.tsx`) | TDD (logic) | B |
| 10 | `usePreferences()` hook + PocketBase wiring | TDD | B |
| 11 | `tips` collection seed + `_examples/` directory | TDD | B |
| 12 | **CHECKPOINT** — Welcome page visual polish + FINAL `@theme` lock | Checkpoint | B |
| 13 | `install.sh` (prereqs, compose, bootstrap, LLM key via `/internal/api-keys`, skills) | TDD | C |
| 14 | Hetzner single-VPS deployment guide (Caddy + per-user compose) | Doc | C |
| 15 | End-to-end smoke: fresh VM → curl install → tasks → rollback | Manual verify | C |

Tasks removed from earlier drafts (now owned by Plan 1): base Dockerfile authoring, supervisord.conf authoring, PocketBase binary download, provisional `@theme` block, frontend scaffold bootstrap, `bootstrap-pocketbase.sh`, `store-api-key.js`, `docker-compose.yml`. Plan 1 ships those as part of the base image and data-layout init; Plan 6's `install.sh` merely drives them and talks to Plan 3's `/internal/api-keys` endpoint on port 4100 to stash the LLM key.

---

# PART A — Skills

## Task 1: Author skill source files (direct write)

**Rationale:** The design doc provides the full, verbatim text of all five skills. Copy them as-is; iteration happens at Task 8 after we see how a real agent behaves.

**Files to create:**
- `anyraven-server/skills/raw/anyraven-build-feature.md`
- `anyraven-server/skills/raw/anyraven-style-guide.md`
- `anyraven-server/skills/raw/anyraven-canonical-example.md`
- `anyraven-server/skills/raw/anyraven-refactor.md`
- `anyraven-server/skills/raw/anyraven-describe-version.md`

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
- `ls anyraven-server/skills/raw/*.md` returns 5 files.
- Every file begins with `---\nskill_version:` on line 1.
- `grep -c '^# anyraven-' anyraven-server/skills/raw/*.md` returns 1 per file.

---

## Task 2: Skill frontmatter parser + semver compatibility module (TDD)

**Location:** `anyraven-server/packages/dispatch/src/skills/frontmatter.ts` (new module in the `@anyraven/dispatch` package from Plan 3).

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

**Location:** `anyraven-server/scripts/package-skills.sh`

**Contract:**
```
package-skills.sh openclaw [--source DIR] [--dest DIR]
  defaults: --source anyraven-server/skills/raw --dest ~/.openclaw/skills
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

**Acceptance:** `bats anyraven-server/scripts/test/package-skills.bats` green.

---

## Task 4: `package-skills.sh` — Claude Code target (TDD)

**Extends** the same script with the `claude-code` subcommand.

**Contract:**
```
package-skills.sh claude-code [--project-dir DIR]
  defaults: --project-dir $PWD
```

**Behavior:**
1. Copies each skill `.md` (frontmatter stripped) into `<project-dir>/.claude/commands/anyraven-*.md` so they become slash commands.
2. Appends (or replaces between sentinel markers) an `## AnyRaven Agent Instructions` block in `<project-dir>/CLAUDE.md`. The block:
   - Lists the 5 slash commands and when to use each (build-feature for every task, style-guide for frontend, canonical-example before frontend, refactor every 5 deployments, describe-version on every deploy).
   - Lists the AnyRaven MCP tool set (deploy, rollback, snapshot_db, create_collection, ask_user, update_progress, list_versions) and states that file/shell tools are the agent's own.
   - Is bounded by `<!-- anyraven:begin -->` / `<!-- anyraven:end -->` sentinels so re-runs are idempotent.
3. Creates `CLAUDE.md` if absent.

**Tests:**
1. Fresh project: both `.claude/commands/*.md` and `CLAUDE.md` created.
2. Re-run replaces the block (not duplicated) — sentinels stable.
3. Re-run does not touch content outside the sentinels.
4. Generated slash commands have no frontmatter.
5. The AnyRaven Agent Instructions block lists all 5 skills and all 7 MCP tools.

**Acceptance:** bats tests green. Manual read of a generated `CLAUDE.md` block.

---

## Task 5: `package-skills.sh` — generic system prompt target (TDD)

**Contract:**
```
package-skills.sh generic [--source DIR] [--out FILE]
  defaults: --source anyraven-server/skills/raw --out anyraven-server/skills/raw/system-prompt.txt
```

**Behavior:**
1. Concatenates the 5 skill bodies (frontmatter stripped) in the order: build-feature, canonical-example, style-guide, refactor, describe-version.
2. Separates each with a `\n\n---\n\n` rule.
3. Prepends a 3-line preamble: `# AnyRaven Agent System Prompt` / `# Combined skill suite — do not edit, regenerate via package-skills.sh generic.` / blank line.
4. Writes to `--out`.

**Tests:**
1. Output file exists and contains all 5 skill bodies in the specified order.
2. No frontmatter in output.
3. Preamble is present.
4. Re-run overwrites cleanly.

**Acceptance:** bats green. Eyeball the generated file.

---

## Task 6: Dispatch `/api/version` endpoint + compatibility gate (TDD)

**Location:** `anyraven-server/packages/dispatch/src/routes/version.ts` + hook into task-dispatch flow. The `@anyraven/dispatch` process listens on port **4100**.

**Endpoint:**
```
GET /api/version
→ {
    "server_version":    "0.1.0",   // from package.json
    "min_skill_version": "1.0.0"    // from dispatch config
  }
```

**Dispatch-time gate:** When the dispatch server assembles the skill set for an agent subprocess, it calls `parseSkillFile` on each and runs `isCompatible`. If any skill is incompatible, the task is rejected with a user-facing error: `"Skill <name> v<x> requires server >= <y>. Update the AnyRaven server."` or the reverse.

**Tests:**
1. `GET http://127.0.0.1:4100/api/version` returns the package.json version and the configured `min_skill_version`.
2. Dispatch with all compatible skills → task proceeds.
3. Dispatch with a skill whose `skill_version < min_skill_version` → task rejected with the exact error string.
4. Dispatch with a skill whose `min_server_version > server_version` → rejected.
5. Rejection error message names the offending skill.

**Acceptance:** Unit tests + one integration test that spins up the dispatch server on 4100 and dispatches a task with a doctored skill file.

---

## Task 7: Extend Plan 1's Dockerfile to bundle the skills directory (direct write)

**Context:** Plan 1 already creates `anyraven-server/infra/Dockerfile` and `anyraven-server/infra/supervisord.conf`. Plan 1 also runs `anyraven-server/scripts/download-pocketbase.sh` during the image build to fetch the 0.25.x PocketBase binary. **This task EXTENDS Plan 1's Dockerfile** — it does NOT re-create it.

**Edit:** Add these layers to Plan 1's `anyraven-server/infra/Dockerfile`:
1. `COPY anyraven-server/skills/raw/ /.anyraven/skills/raw/` (owned by `anyraven-infra`).
2. `COPY anyraven-server/scripts/package-skills.sh /.anyraven/scripts/package-skills.sh` (mode 0755).
3. A build-time `RUN /.anyraven/scripts/package-skills.sh generic --source /.anyraven/skills/raw --out /.anyraven/skills/system-prompt.txt` so the generic bundle is baked in.

**Do NOT:**
- Re-declare the base image or `apt-get install` block.
- Re-declare the PocketBase download — Plan 1's `download-pocketbase.sh` already does that for 0.25.x.
- Re-declare the supervisord copy — Plan 1 does that.

**Acceptance:** `docker build -t anyraven:test anyraven-server/` succeeds from a clean checkout. `docker run --rm anyraven:test ls /.anyraven/skills/raw/` lists the 5 `.md` files. `docker run --rm anyraven:test cat /.anyraven/skills/system-prompt.txt` prints the concatenated bundle.

---

## Task 8: **CHECKPOINT** — Skill prompt quality with a real agent build

**Goal:** Catch sloppy skill prose before it calcifies. Skill text is the UX of the agent.

**Procedure:**
1. Spin up a local dispatch server with packaged skills (run Tasks 3–5 output).
2. Use a real Claude Code or OpenClaw process to dispatch ONE canned feature request: `"Build me a daily mood tracker with a weekly chart."`
3. Observe:
   - Does the agent call `anyraven_list_versions` first? (Step 0)
   - Does the agent ask any "bad" detail questions (colors, names)?
   - Does the agent read `/data/dev/packages/frontend/src/_examples/welcome.tsx` before writing frontend code?
   - Does the agent run the full lint/typecheck/build/test cycle?
   - Is the version description direct and non-technical?
4. Record deviations. For each, decide: fix the skill prose OR accept as agent quirk.
5. Edit the skill files in place. Bump `skill_version` in frontmatter on any changed file. Re-run `package-skills.sh`.
6. Repeat once more to confirm the fix landed.

**STOP for human review.** Present the recorded agent behavior and proposed skill edits. Do not proceed to Task 9 until the reviewer signs off.

**Exit criteria:** Reviewer confirms skill behavior is acceptable for v1. All 5 skills pinned at their current frontmatter versions.

---

# PART B — The Welcome Page (canonical example)

> **Scaffold ownership:** Plan 1 creates the `frontend-template` package with the Vite + Tailwind v4 scaffold AND a provisional `@theme` block in `app.css`. On first run, Plan 1's `init-data-layout.sh` copies `frontend-template` into `/data/dev/packages/frontend/`. Plan 6's tasks below modify files INSIDE `/data/dev/packages/frontend/` (source of truth for the template lives in the `frontend-template` package — edits land there and are re-synced).

## Task 9: `welcome.tsx` canonical component on Plan 1's frontend-template (TDD for logic)

**Location:** `/data/dev/packages/frontend/src/_examples/welcome.tsx` AND `/data/dev/packages/frontend/src/pages/Home.tsx` (initial duplicate; `Home.tsx` may be overwritten by the first agent-built feature). Because `frontend-template` is the canonical source, the same files also land in `anyraven-server/packages/frontend-template/src/_examples/welcome.tsx` so fresh installs get them.

**Note:** Plan 1's `frontend-template` already provides the Vite + Tailwind v4 scaffold, the entry points, and the provisional `app.css`. This task adds the welcome page CONTENT only.

**Structure:** Adapt the file from section 15 of the design doc (lines 1527–1681) with these changes:
- Data source is the `tips` collection (Task 11), not `tasks`.
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

## Task 10: `usePreferences()` hook (TDD)

**Location:** `anyraven-server/packages/frontend-template/src/hooks/usePreferences.ts` + `anyraven-server/packages/frontend-template/src/lib/pocketbase.ts` (uses the `pocketbase` JS SDK pinned to **0.25.x** to match the binary).

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

## Task 11: `tips` collection seed + `_examples/` directory structure (TDD)

**Goal:** The welcome page reads from a `tips` collection (simpler, more self-contained than the `tasks` collection referenced in the design doc's sample code — tasks belong to the mobile app model, not the user's own data). The collection seeds with 3 example tips on fresh install.

**Files:**
- `anyraven-server/scripts/seed-welcome-collection.js` — creates the `tips` collection via `anyraven_create_collection` and inserts 3 rows, using the PocketBase JS SDK **0.25.x**.
- `anyraven-server/packages/frontend-template/src/_examples/README.md` — one-line explanation: "Read-only reference files for the agent. Do not modify."
- `anyraven-server/packages/frontend-template/src/_examples/.gitkeep`

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
1. Running the seed script against a fresh PocketBase 0.25.x creates the collection.
2. Running it twice is idempotent (no duplicate collection, no duplicate rows with same title).
3. Collection schema matches exactly.

**Acceptance:** Script tested against a scratch PocketBase 0.25.x. `_examples/` directory committed with README + .gitkeep.

---

## Task 12: **CHECKPOINT** — Welcome page visual polish + FINAL `@theme` lock

**Goal:** Plan 1's `frontend-template` ships with a PROVISIONAL `@theme` block in `app.css`. This checkpoint is where Plan 6 iterates on that block visually and produces the FINAL, locked theme. The Welcome page is the user's first impression and the agent's canonical example — both need to look right.

**Procedure:**
1. Run `npm run dev` inside `/data/dev/packages/frontend/`.
2. View the welcome page at 375×812 (mobile), 768×1024 (tablet), and desktop.
3. View in both light and dark mode (`prefers-color-scheme`).
4. Check against the Design Language principles from the spec:
   - Soft corners (not sharp).
   - Generous whitespace (calm density).
   - Restrained color (grayscale + single accent).
   - Strong typographic hierarchy.
   - Subtle elevation (soft shadows, not heavy borders).
   - Warm neutrals (off-white background, not pure white).
5. **Iterate** on Plan 1's provisional `@theme` block in `app.css` — do NOT rewrite it from scratch; tune its values (oklch colors, rem spacing, radius, shadows, typography) until the design goals are met. Do NOT alter the welcome component's structure or classNames. The goal is that the existing semantic tokens produce the right look.
6. Verify each accent color (blue/teal/green/amber/rose/violet) is represented in `--color-primary` options (add accent switching later, but confirm the base value feels correct).

**STOP for human review.** Present screenshots at mobile + desktop, light + dark. Reviewer approves the FINAL `@theme` block or requests specific changes.

**Exit criteria:** Reviewer sign-off on the welcome page look. FINAL `@theme` block LOCKED in `app.css` and back-ported into `anyraven-server/packages/frontend-template/src/app.css` so fresh installs get it.

---

# PART C — Deployment

> **Ownership reminder:** Plan 1 already ships `anyraven-server/infra/Dockerfile`, `anyraven-server/infra/supervisord.conf`, `anyraven-server/scripts/init-data-layout.sh`, `anyraven-server/scripts/download-pocketbase.sh`, and a `docker-compose.yml` for the base image. Plan 6 does NOT re-author these. Plan 6 ships the user-facing `install.sh` that drives them.

## Task 13: `install.sh` (TDD)

**Location:** `anyraven-server/install.sh` (served at `https://get.anyraven.com`).

**Scope:** The user-facing one-command installer. It does NOT create the Dockerfile or supervisord.conf (bundled in the Plan 1 image) and it does NOT download the PocketBase binary (Plan 1's `download-pocketbase.sh` runs at image build time). It drives Plan 1's init scripts and talks to Plan 3's `/internal/api-keys` endpoint on port **4100**.

**Phases:**
```bash
#!/usr/bin/env bash
set -euo pipefail

ANYRAVEN_VERSION="${ANYRAVEN_VERSION:-latest}"
INSTALL_DIR="${ANYRAVEN_DIR:-$HOME/.anyraven-host}"

echo "=== AnyRaven Installer ==="

# [1/6] Prerequisites — OS check, cgroup v2 warning, RAM + disk warnings.
# [2/6] Docker — install via get.docker.com on Linux if missing, verify daemon + compose v2.
# [3/6] Install directory — mkdir $INSTALL_DIR, fetch the Plan 1 docker-compose.yml + env.template
#       from the release URL. Generate ANYRAVEN_USER_TOKEN into .env. Prompt for LLM provider
#       (anthropic / openai) and API key (read -rsp, silent).
# [4/6] Pull + start — docker compose pull, docker compose up -d.
#       Run Plan 1's /.anyraven/scripts/init-data-layout.sh inside the container (idempotent,
#       creates /data tree with correct ownership). Wait for PocketBase /api/health.
#       Bootstrap PocketBase superuser via the 0.25.x `_superusers` collection flow
#       (pocketbase superuser create admin@local <password>; then POST
#       /api/collections/_superusers/auth-with-password for the JWT; then
#       /api/collections/_superusers/impersonate/<id> for the long-lived token).
#       Store admin password + impersonation token at /data/.anyraven/pb-admin and
#       /data/.anyraven/pb-token (mode 0600, owned anyraven-infra).
# [5/6] LLM key storage — generate /data/.anyraven/master.key via `openssl rand -base64 32`
#       (mode 0600). POST the user-supplied LLM key to Plan 3's internal endpoint:
#       `curl -fsS -X POST http://127.0.0.1:4100/internal/api-keys \
#              -H 'Content-Type: application/json' \
#              -d '{"provider":"<p>","key":"<k>"}'`
#       The dispatch process encrypts and stores it. install.sh never writes the raw LLM key
#       to disk outside of that single curl body.
# [6/6] Package skills — detect openclaw/claude binary on the host, exec the
#       /.anyraven/scripts/package-skills.sh inside the container accordingly (openclaw or
#       claude-code target). Fall back to printing generic MCP URL instructions.

# Final: print install dir, log command, stop command, "open the mobile app" banner.
```

**PocketBase version note:** The superuser bootstrap uses the 0.25.x `_superusers` collection endpoints (`/api/collections/_superusers/auth-with-password` and `/api/collections/_superusers/impersonate/<id>`). If a later 0.25.x patch changes these, update here and at Task 11.

**Tests (bats against a mock `docker` shim and a mock dispatch server on 4100):**
1. Fresh install on a Linux-like env: all 6 phases execute, exit 0.
2. Re-run with existing `.env`: preserves config, skips LLM prompt.
3. Missing Docker on macOS → exits with "install Docker Desktop" message.
4. Docker daemon down → exits with clear error.
5. Unknown OS → exits 1.
6. `<2GB RAM` path → prints warning but continues.
7. LLM key prompt is silent (`read -rsp`) — verified by checking no echo.
8. LLM key is POSTed to `http://127.0.0.1:4100/internal/api-keys` exactly once, with the correct JSON body, and never written to a file by install.sh.
9. PocketBase bootstrap uses the 0.25.x `_superusers` endpoints (the mock asserts the exact URL paths).
10. Detects `openclaw` → runs `package-skills.sh openclaw`.
11. Detects `claude` → runs `package-skills.sh claude-code`.
12. Detects neither → prints generic MCP URL instructions.

**Acceptance:** bats green. Manual dry-run against a real Docker on a throwaway VM, with a real Plan 1 image.

---

## Task 14: Hetzner deployment guide (doc)

**Location:** `docs/deployment/hetzner-phase1.md`

**Contents:**
- Target: single Hetzner CX32 VPS (4 vCPU, 8GB RAM, 80GB), Ashburn region.
- Base OS: Ubuntu 24.04 LTS.
- Install Docker via `get.docker.com`.
- Install Caddy as a system package.
- Create `/opt/anyraven/` layout (from section 16, lines 1705–1718):
  - `provisioner/docker-compose.yml`
  - `caddy/Caddyfile`
  - `users/user-<id>/docker-compose.yml` (templated per user)
- Example `Caddyfile` that terminates TLS on `broker.anyraven.com` and reverse-proxies WSS to the broker process.
- Per-user compose template: unique container name, unique volume, no host port bindings (all ingress via tunnel). Uses the Plan 1 image (`ghcr.io/anyraven/anyraven:latest`).
- Provisioner responsibilities (lines 1729–1735):
  - Allocate unique `ANYRAVEN_USER_TOKEN` per user.
  - Create/start/stop/destroy containers.
  - Per-user resource limits: `cpus: 0.5`, `memory: 512M` baseline.
  - Idle shutdown after 30 min of tunnel inactivity; wake on broker message.
- Backup: nightly `tar czf` of `/opt/anyraven/users/*/data/pocketbase/pb_data` to offsite storage.
- Monitoring: `docker stats` + a simple cron that counts running containers.
- Migration path to Phase 2 (microVMs / K8s Agent Sandbox): same image, different scheduler — one paragraph.
- **Security:** only the tunnel manager talks outbound (WSS to broker). No public ports on the VPS except 443 for Caddy. `ufw` rules listed.

**Acceptance:** Doc reviewed. Every command in the doc copy-pastes into a fresh VPS and works (verify at Task 15).

---

## Task 15: End-to-end smoke test (manual verify)

**Goal:** Prove the whole install flow works on a fresh environment.

**Procedure:**
1. Spin up a clean Hetzner CX32 VPS (or a local Ubuntu 24.04 VM).
2. Run `curl -fsSL https://get.anyraven.com | bash` (point the install script at a local release mirror during testing).
3. Verify all 5 supervised processes are running: `docker compose exec anyraven supervisorctl status`.
4. Verify `/data/.anyraven/pb-token` exists (0600, anyraven-infra).
5. Verify `/data/.anyraven/master.key` exists (0600).
6. Verify the `api_keys` collection in PocketBase contains one encrypted row for the chosen provider (written via the `POST /internal/api-keys` on port 4100 call).
7. Verify the welcome page renders at `http://127.0.0.1:5173/`.
8. Hit `GET http://127.0.0.1:4100/api/version` → version JSON from the dispatch process.
9. Verify PocketBase is on the 0.25.x line: `docker compose exec anyraven /usr/local/bin/pocketbase --version`.
10. Dispatch a trivial task through the MCP endpoint and watch it complete: progress updates → deploy → version row.
11. Roll the deploy back via `anyraven_rollback` → prior version restored.
12. `docker compose down` + `docker compose up -d` → everything comes back, no data loss.
13. Follow the Hetzner guide (Task 14) to add a second user container; verify isolation (one user's `/data` is invisible to the other).

**Acceptance:** Checklist passes end-to-end. Any failure → file a bug, fix, re-run.

---

## Summary

This plan delivers, in order:
1. The five skill files (under `anyraven-server/skills/raw/`), packaged three ways, with bidirectional semver gating via the `@anyraven/dispatch` process on port 4100, and baked into Plan 1's image via a Dockerfile extension.
2. Welcome page content layered on top of Plan 1's `frontend-template` scaffold, reviewed at a visual checkpoint that also LOCKS the final `@theme` block (Plan 1 shipped a provisional one).
3. The user-facing `install.sh` — driving Plan 1's init scripts, bootstrapping PocketBase 0.25.x via `_superusers`, and stashing the user's LLM key via Plan 3's `POST /internal/api-keys` on port 4100 — plus the Hetzner deployment guide and an end-to-end smoke test.

After Task 15, AnyRaven can be installed from scratch by a user with one curl command, can receive a feature request from the mobile app, can dispatch it to an agent, and can deploy the result. All six plans compose into a working end-to-end product.
