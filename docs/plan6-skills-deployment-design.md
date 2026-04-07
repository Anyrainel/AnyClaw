# Plan 6: Skills + Deployment -- Design Document

**Goal:** Define the complete agent skill suite that teaches coding agents how to build features on AnyClaw, and the deployment setup for self-hosted and cloud-hosted modes.

**Dependencies:** Plan 1 (Server Infrastructure), Plan 2 (MCP Server), Plan 3 (Agent Dispatch).

**Locked decisions referenced:** #5, #8, #14, #20, #21, #22, #23, #24, #25, #27, #28, #29, #36, #47, #48, #49, #50, #51.

---

## Part A: Skill Suite

### 1. Overview of Skills

Skills are Markdown prompts that teach a coding agent how to work inside AnyClaw. They are authored once in `/.anyclaw/skills/` and packaged differently per agent platform (OpenClaw skills directory, Claude Code slash commands, or a concatenated system prompt for generic agents).

The four skills:

| Skill | Purpose | When used |
|---|---|---|
| `anyclaw-build-feature` | End-to-end workflow for turning a feature request into a deployed version | Every user task |
| `anyclaw-style-guide` | Tailwind v4 tokens, component patterns, file layout, state management | Any frontend work |
| `anyclaw-refactor` | Cleanup pass: extract duplication, remove dead code, tighten types | Periodic / on trigger |
| `anyclaw-describe-version` | Non-technical version descriptions for the user's history screen | Every deploy |

**Core philosophy (decisions #5 and #23):** the agent uses its own built-in file and shell tools to read, write, edit, and run commands. AnyClaw MCP tools are reserved for operations that need server-side guarantees:

- `anyclaw_deploy`
- `anyclaw_rollback`
- `anyclaw_snapshot_db`
- `anyclaw_create_collection`
- `anyclaw_ask_user`
- `anyclaw_update_progress`
- `anyclaw_list_versions`

There are no `anyclaw_read_file`, `anyclaw_write_file`, `anyclaw_run_command`, `anyclaw_create_page`, or `anyclaw_create_api_route` tools. The agent uses its native equivalents for those.

The agent's workspace is a per-task git worktree under `/data/dev/.worktrees/task-<id>/` (decision #36). Each task runs in its own isolated worktree; on success the branch merges to `main` and the worktree is deleted. The skills treat "the workspace" and "cwd" as synonymous — the agent never walks out of its worktree.

---

### 2. Skill: anyclaw-build-feature

The entire text of the skill as shipped in `/.anyclaw/skills/anyclaw-build-feature.md`:

```markdown
---
skill_version: "1.0.0"
min_server_version: "0.1.0"
---
# anyclaw-build-feature

You are building a feature for a personal web application running on AnyClaw
infrastructure. The app uses PocketBase (SQLite with auto-generated REST API),
a Node.js/TypeScript logic service, and a Vite + React + TypeScript +
Tailwind v4 frontend.

You write code directly using YOUR OWN built-in file tools (read, write, edit)
and YOUR OWN shell tool for running commands. You do NOT use MCP tools for
files or shell — you already have those.

AnyClaw MCP tools are only for operations that require server-side guarantees:

- `anyclaw_deploy` — validate, snapshot, commit, promote dev to prod atomically
- `anyclaw_rollback` — restore a specific version (code + DB snapshot together)
- `anyclaw_snapshot_db` — take a DB snapshot before risky schema changes
- `anyclaw_create_collection` — create a PocketBase collection via admin API
- `anyclaw_ask_user` — post a clarifying question to the mobile app and wait
- `anyclaw_update_progress` — post a progress update to the mobile app task card
- `anyclaw_list_versions` — read deployment history

Your working directory is your task's git worktree, provided in the environment
variable `ANYCLAW_WORKTREE` (something like `/data/dev/.worktrees/task-abc123/`).
Read, write, and run commands there. Do not `cd` out of it. The infrastructure
code in `/.anyclaw/` is read-only and must never be modified.

Follow this workflow exactly. Do not skip steps.

## Step 1: Understand the Request

Read the user's feature request carefully. Identify:
- What the user wants to accomplish (the goal, not the implementation)
- What data needs to be stored or retrieved
- What UI the user expects to see
- Whether this interacts with any existing features

If ANYTHING is ambiguous, use `anyclaw_ask_user` to clarify BEFORE planning.
Good clarifying questions:
- "Should this data be private, or would you want to share it later?"
- "Do you want this as a separate page or added to an existing page?"
- "How often should this update — real-time, hourly, daily?"
- "Should I notify you when [event]?"

Do NOT ask more than 3 questions in a single round. Prioritize questions that
most affect the architecture. Follow up in a second round if needed. Do not
ask questions just to appear thorough.

## Step 2: Plan the Feature

Before writing code, decide which of these components are needed:

- **Collections (DB tables):** lowercase snake_case names, always include a
  `user` relation field for user-scoped data. Think about what the UI needs
  to avoid extra round trips.
- **API routes:** only for complex queries across collections, external API
  calls, LLM processing, or custom business logic. Pure CRUD goes directly
  from the frontend to PocketBase.
- **Background jobs:** only for scheduled fetching or timed notifications.
- **Pages and components:** which UI screens are needed?
- **Navigation:** where does this feature appear?

Post your plan via `anyclaw_update_progress`:
"Planning: [name] needs N collections, N routes, N pages, N jobs. Building now."

## Step 3: Implement — Database Layer

Collections first. For each one:
1. Call `anyclaw_create_collection` with the full schema.
2. Verify by reading back the returned schema.
3. Create dependencies before dependents.

Do NOT edit PocketBase internals. The MCP tool is the only schema path.

## Step 4: Implement — Backend Layer

Use your own file tools in your worktree. API routes go in
`packages/logic/src/routes/`, background jobs in `packages/logic/src/jobs/`,
each registered from `packages/logic/src/index.ts`. Follow the existing
patterns in the codebase.

Update progress: "Implementing backend for [feature]..."

## Step 5: Implement — Frontend Layer

Follow the `anyclaw-style-guide` skill for all CSS and component conventions.
Pages in `packages/frontend/src/pages/`, shared components in
`packages/frontend/src/components/`, feature-specific components alongside
their page. Use the PocketBase JS SDK for CRUD and the logic service for
custom endpoints. Always handle loading, error, and empty states.

Update progress: "Building UI for [feature]..."

## Step 6: Test in Dev

In your worktree, run the validation suite using your own shell tool:

1. `npm run lint` — fix all warnings/errors
2. `npm run typecheck` — no errors, no `any`, no `@ts-ignore`
3. `npm run build` — must succeed
4. `npm run test` — all tests pass

If the feature adds API routes, start the dev server in the background and
curl the endpoints. If it touches existing features, verify they still work.

Do NOT proceed to deploy if any step fails. Iterate until clean. After three
failed attempts on the same error, use `anyclaw_ask_user` to explain the
problem and ask for guidance.

## Step 7: Write Version Description

Use the `anyclaw-describe-version` skill to write a short, non-technical
description of what the user can now do.

## Step 8: Deploy

Call `anyclaw_deploy` with your version description. The deploy tool:
1. Runs the full validation suite authoritatively (server-side)
2. Snapshots the database if schema changed
3. Commits the worktree branch and merges it to main
4. Copies build artifacts from dev to `/data/prod/`
5. Restarts the logic service
6. Triggers a WebView reload on the mobile app

If deploy fails, read the error and iterate.

Update progress: "Deployed! [feature] is live."

## Rules

- NEVER edit files under `/data/prod/` or `/.anyclaw/`.
- NEVER edit PocketBase internals. Use `anyclaw_create_collection`.
- NEVER deploy without passing all validation steps.
- NEVER delete existing collections unless the user explicitly asks.
- ALWAYS snapshot before risky schema changes (`anyclaw_deploy` does this
  automatically; call `anyclaw_snapshot_db` for manual experiments).
- ALWAYS post progress updates so the user sees what's happening.
- If you need a new npm package, install it in the appropriate workspace.
  Prefer well-known, maintained packages. Avoid packages with fewer than
  1000 weekly downloads unless there is no alternative.
```

---

### 3. Skill: anyclaw-style-guide

The full text shipped in `/.anyclaw/skills/anyclaw-style-guide.md`:

````markdown
---
skill_version: "1.0.0"
min_server_version: "0.1.0"
---
# anyclaw-style-guide

You are building the frontend UI for an AnyClaw personal web app. This guide
defines exact conventions for all React components and CSS. Consistency
matters — the user sees every feature you build side by side, so they must
look like they belong together.

## CSS: Tailwind v4, CSS-first config

Tailwind v4 configures its theme in `packages/frontend/src/app.css` via
`@theme`. There is no `tailwind.config.ts` file.

Do NOT use:
- Inline style objects (`style={{ }}`)
- CSS Modules
- Styled-components or any CSS-in-JS library
- Separate `.css` files other than `app.css`
- `tailwind.config.ts` (Tailwind v4 doesn't use one)

You may NOT add new `@theme` tokens without user approval via
`anyclaw_ask_user`. Use the existing tokens only.

## The @theme block (already in app.css)

```css
@import "tailwindcss";

@theme {
  /* Colors — light mode defaults */
  --color-background:  oklch(0.99 0 0);
  --color-surface:     oklch(0.97 0 0);
  --color-foreground:  oklch(0.18 0.01 260);
  --color-muted:       oklch(0.55 0.01 260);
  --color-border:      oklch(0.90 0.01 260);

  --color-primary:     oklch(0.62 0.17 255);
  --color-primary-fg:  oklch(0.99 0 0);
  --color-secondary:   oklch(0.72 0.10 200);
  --color-secondary-fg:oklch(0.15 0.01 260);
  --color-accent:      oklch(0.78 0.16 80);
  --color-accent-fg:   oklch(0.15 0.01 260);

  --color-success:     oklch(0.68 0.15 150);
  --color-warning:     oklch(0.80 0.15 80);
  --color-danger:      oklch(0.60 0.22 25);
  --color-danger-fg:   oklch(0.99 0 0);

  /* Spacing scale (rem) */
  --spacing-0:   0;
  --spacing-1:   0.25rem;
  --spacing-2:   0.5rem;
  --spacing-3:   0.75rem;
  --spacing-4:   1rem;
  --spacing-5:   1.25rem;
  --spacing-6:   1.5rem;
  --spacing-8:   2rem;
  --spacing-10:  2.5rem;
  --spacing-12:  3rem;
  --spacing-16:  4rem;

  /* Typography */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --text-xs:   0.75rem;   /* 12px */
  --text-sm:   0.875rem;  /* 14px */
  --text-base: 1rem;      /* 16px */
  --text-lg:   1.125rem;  /* 18px */
  --text-xl:   1.25rem;   /* 20px */
  --text-2xl:  1.5rem;    /* 24px */
  --text-3xl:  1.875rem;  /* 30px */

  /* Radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-2xl: 1.25rem;

  /* Shadows */
  --shadow-sm:  0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md:  0 2px 8px -2px rgb(0 0 0 / 0.08);
  --shadow-lg:  0 8px 24px -8px rgb(0 0 0 / 0.12);
  --shadow-xl:  0 20px 50px -20px rgb(0 0 0 / 0.18);
}

/* Dark mode (decision #51): automatic via prefers-color-scheme */
@media (prefers-color-scheme: dark) {
  @theme {
    --color-background: oklch(0.15 0.01 260);
    --color-surface:    oklch(0.20 0.01 260);
    --color-foreground: oklch(0.96 0 0);
    --color-muted:      oklch(0.68 0.01 260);
    --color-border:     oklch(0.28 0.01 260);

    --color-primary:    oklch(0.72 0.17 255);
    --color-primary-fg: oklch(0.12 0.01 260);
    --color-secondary:  oklch(0.72 0.10 200);
    --color-accent:     oklch(0.82 0.16 80);

    --color-success:    oklch(0.72 0.15 150);
    --color-warning:    oklch(0.82 0.15 80);
    --color-danger:     oklch(0.68 0.22 25);
  }
}
```

## Using the tokens

NEVER use raw color classes like `bg-blue-500`. Always use semantic names:

```
bg-background / text-foreground    — page
bg-surface                         — cards, panels
text-muted                         — secondary text
border-border                      — all borders
bg-primary / text-primary-fg       — primary buttons
bg-accent                          — highlights
bg-danger / text-danger-fg         — destructive
bg-success / bg-warning            — status pills
```

## Typography conventions

- Page title:    `text-2xl font-semibold text-foreground`
- Section head:  `text-lg font-medium text-foreground`
- Body:          `text-base text-foreground`
- Caption:       `text-sm text-muted`
- Small label:   `text-xs text-muted`

Use `font-semibold` for headings and `font-medium` for sub-headings. Avoid
`font-bold` except for emphasis within body text.

## Spacing conventions

- Page padding:        `p-4` mobile, `sm:p-6` larger
- Between sections:    `space-y-6`
- Between list items:  `space-y-3`
- Inside a card:       `space-y-2`
- Inline gaps:         `gap-2` or `gap-3`

## Component patterns

### Card
```tsx
<div className="bg-surface border border-border rounded-xl p-4 space-y-2 shadow-sm">
  {children}
</div>
```
Always `rounded-xl` for cards.

### Button — primary
```tsx
<button className="bg-primary text-primary-fg rounded-lg px-4 py-2 text-sm font-medium
  min-h-[44px] hover:opacity-90 active:opacity-80 transition-opacity
  focus:outline-none focus:ring-2 focus:ring-primary/50">
  {label}
</button>
```

### Button — secondary
```tsx
<button className="bg-surface border border-border rounded-lg px-4 py-2 text-sm
  font-medium text-foreground min-h-[44px] hover:bg-background active:opacity-80
  transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50">
  {label}
</button>
```

### Button — danger
```tsx
<button className="bg-danger text-danger-fg rounded-lg px-4 py-2 text-sm font-medium
  min-h-[44px] hover:opacity-90 active:opacity-80 transition-opacity">
  {label}
</button>
```

### Input
```tsx
<input
  className="w-full bg-background border border-border rounded-lg px-3 py-2
    text-base text-foreground placeholder:text-muted min-h-[44px]
    focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
    transition-colors"
  placeholder="Enter value..."
/>
```

### Empty state
```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <p className="text-muted text-sm">No entries yet</p>
  <button className="mt-3 text-primary text-sm font-medium">
    Add your first entry
  </button>
</div>
```

### Loading state
```tsx
<div className="flex items-center justify-center py-12">
  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary
    border-t-transparent" />
</div>
```

## Responsive breakpoints (mobile-first)

- Default (no prefix): 320–480px, PRIMARY target (phones in the WebView)
- `sm:` 640px+  — large phone / small tablet
- `md:` 768px+  — tablet
- `lg:` 1024px+ — desktop (rare, browser access only)

Rules:
- Everything must work at 320px. No horizontal scrolling, ever.
- Single-column by default. `md:grid-cols-2`+ only at tablet and up.
- Touch targets ≥ 44px tall.
- Never use `text-xs` for interactive labels.

## File organization

```
packages/frontend/src/
  app.css                # Tailwind @theme — the only CSS file
  main.tsx
  App.tsx
  lib/
    pocketbase.ts        # PocketBase JS SDK client
    api.ts               # fetch wrapper for the logic service
  contexts/              # React Context providers
  hooks/                 # Reusable hooks (e.g. useCollection)
  components/            # Shared components (2+ pages use them)
    Layout.tsx
    Card.tsx
    Button.tsx
    EmptyState.tsx
    LoadingSpinner.tsx
  pages/
    Home.tsx
    mood/
      MoodPage.tsx
      MoodEntryForm.tsx
      MoodChart.tsx
```

Rules:
- One component per file. PascalCase filename matches component name.
- Pages default-export; shared components named-export.
- No barrel `index.tsx` files.
- Components over 200 lines must be split.

## State management (decision locked)

- `useState` / `useReducer` for local state.
- **PocketBase real-time subscriptions** for live data — never polling:
  ```tsx
  useEffect(() => {
    const unsub = pb.collection("mood_entries").subscribe("*", (e) => {
      setEntries(curr => mergeChange(curr, e));
    });
    return () => { unsub.then(fn => fn()); };
  }, []);
  ```
- Cross-page shared state: **React Context** in `contexts/`.
- Do NOT install Redux, Zustand, Jotai, Recoil, or similar. No exceptions
  without explicit user approval.

## Data fetching

- PocketBase SDK for CRUD. Custom hooks in `hooks/` for reusable patterns.
- Always handle loading, error, and empty states. Never render blank.

## Icons

Use `lucide-react`. Already installed. Do not install other icon libraries.

```tsx
import { Plus, Trash2, Settings, ChevronRight } from "lucide-react";
<Plus className="h-5 w-5" />
```

## Accessibility

- `alt` on all images.
- `<label>` or `aria-label` on all inputs.
- Semantic HTML: `<main>`, `<nav>`, `<section>`, `<article>`, `<button>`.
- Color alone never conveys state.
- Focus rings everywhere interactive: `focus:ring-2 focus:ring-primary/50`.

## Do NOT

- No `any` type. Type everything.
- No `@ts-ignore` / `@ts-expect-error`.
- No `!important`.
- No hardcoded colors.
- No components over 200 lines.
- No `dangerouslySetInnerHTML` unless rendering sanitized markdown.
- No elaborate animations. `transition-opacity` / `transition-colors` only.
````

---

### 4. Skill: anyclaw-refactor

Shipped as `/.anyclaw/skills/anyclaw-refactor.md`:

```markdown
---
skill_version: "1.0.0"
min_server_version: "0.1.0"
---
# anyclaw-refactor

You are cleaning up the codebase of an AnyClaw personal web app. This skill
runs either on a schedule (after every 5th deployment) or proactively when
you notice growing complexity while building a feature.

## Trigger conditions

Run a refactor pass if ANY of these are true:
- A component file exceeds 200 lines
- 3+ pages contain duplicated JSX patterns
- A page imports more than 10 modules
- The same PocketBase query pattern appears in 3+ files
- `packages/logic/src/routes/` has more than 15 route files
- A background job file exceeds 100 lines
- 5 deployments have happened since the last refactor

## What to look for

1. **Shared component extraction.** Repeated JSX (card layouts, list items,
   forms) → extract to `packages/frontend/src/components/`.
2. **Custom hook extraction.** Repeated fetching or subscription logic →
   extract to `packages/frontend/src/hooks/`.
3. **Dead code removal.** Unused imports, unrendered components, unreachable
   API routes, collections nothing reads/writes, jobs with commented-out
   schedules.
4. **File organization.** Enforce the style-guide layout. Move misplaced
   files; update imports.
5. **Route consolidation.** Collapse many tiny route files for one feature
   into a single file.
6. **Type improvements.** Replace `any`, add missing return types, create
   shared type definitions, reuse PocketBase collection types.

## Safety rules

- NEVER refactor and add features in the same deployment.
- ALWAYS run lint + typecheck + build + tests after EACH change.
- NEVER change behavior during a refactor. Pure restructuring only.
- NEVER delete a PocketBase collection during refactoring. Data is sacred.
- Make small, incremental changes. Many small commits, not one big one.
- If a refactor breaks tests, revert it immediately.
- Do not rename user-visible routes or URLs — existing bookmarks must work.

## Version description format

`Housekeeping: [what you cleaned up]`

Examples:
- `Housekeeping: extracted shared Card and ListItem components`
- `Housekeeping: consolidated mood-related API routes into a single file`
- `Housekeeping: removed unused imports and tightened types`
```

---

### 5. Skill: anyclaw-describe-version

Shipped as `/.anyclaw/skills/anyclaw-describe-version.md`:

```markdown
---
skill_version: "1.0.0"
min_server_version: "0.1.0"
---
# anyclaw-describe-version

You are writing a version description for a deployment of an AnyClaw
personal web app. This appears in the user's version history. The user is
NOT a developer. Write for a normal person.

## Rules

1. Start with what the user can now DO, not what you coded.
2. Plain language. No technical jargon.
3. One to three sentences. Never more.
4. If visual, describe what the user will see.
5. If background, explain what happens and when.
6. Do NOT mention file names, function names, components, collections,
   API routes, or database schemas.
7. Do NOT say "I" or "the agent." Describe what changed, not who changed it.
8. Present tense: "You can now..." not "Added the ability to..."

## Good examples

Mood tracker with weekly chart:
> You can now track your mood, energy, and stress levels with a daily
> check-in. A weekly chart shows your trends over time.

News aggregator:
> Your personalized news feed is ready. It pulls articles from your chosen
> sources every 6 hours and highlights the ones most relevant to you.

Refactor:
> Housekeeping: cleaned things up behind the scenes. Everything works the
> same, just tidier.

Bug fix:
> Fixed the issue where the mood chart wasn't showing yesterday's entry.

## Bad examples (do NOT write like this)

> Added MoodEntry collection with fields for mood, energy, stress, and notes.
> Created MoodPage component with MoodEntryForm and MoodChart sub-components.

> Refactored the useQuery hook to use the new PocketBase SDK pattern and
> updated all call sites in pages/mood and pages/news.

> I built a news aggregator with an hourly cron job that calls the RSS
> parser service.
```

---

### 6. Skill Packaging

Skills are authored once in `/.anyclaw/skills/` and packaged into three formats at install time by `/.anyclaw/scripts/package-skills.sh`.

**Source layout:**
```
/.anyclaw/skills/
  anyclaw-build-feature.md
  anyclaw-style-guide.md
  anyclaw-refactor.md
  anyclaw-describe-version.md
```

**OpenClaw:** copy `.md` files (frontmatter stripped) into `~/.openclaw/skills/`. OpenClaw loads them via its normal skill discovery (`skillsDir` in `~/.openclaw/config.json`).

**Claude Code:** two mechanisms.
1. Append an `## AnyClaw Agent Instructions` block to `CLAUDE.md` telling the agent to follow `/anyclaw-build-feature` for all feature work, `/anyclaw-style-guide` for all frontend code, `/anyclaw-refactor` every 5 deployments, and `/anyclaw-describe-version` for version descriptions. The block also lists the MCP tool set so the agent knows not to expect file/shell MCP tools.
2. Copy the `.md` files to `.claude/commands/` so they become slash commands.

**Generic agents (system prompt):** the packaging script concatenates all four skill bodies into `/.anyclaw/skills/system-prompt.txt`. The generic webhook adapter passes this as the system prompt when dispatching work.

In all three packages, YAML frontmatter is stripped from the content before delivery — it only exists for versioning metadata (next section).

---

### 7. Skill Versioning

Decision #24: independent versioning with compatibility check.

**Frontmatter on every skill file:**
```yaml
---
skill_version: "1.3.0"
min_server_version: "0.5.0"
---
```

**Server endpoint** (exposed by dispatch server):
```
GET /api/version
→ {
    "server_version":     "0.7.2",
    "min_skill_version":  "1.0.0"
  }
```

**Compatibility check (bidirectional semver):** at task dispatch time, the dispatch server parses the frontmatter of each skill it's about to ship to the agent and enforces:

- `skill.skill_version >= server.min_skill_version` (server accepts the skill)
- `server.server_version >= skill.min_server_version` (skill accepts the server)

If either fails, the dispatch server rejects the task with a clear error telling the user which side needs an upgrade. Frontmatter is then stripped and the skill body is passed to the agent. This lets us iterate on prompts rapidly without forcing full server upgrades, while still preventing incompatible combinations.

---

## Part B: Deployment

Deployment is governed by decisions #8, #22, #23, #25, #27:

- **Self-hosted:** one Docker container (or a native Linux install with `systemd --user`) running a supervisor that manages five persistent AnyClaw processes. A sixth, the agent subprocess, is transient — spawned per task.
- **Cloud-hosted Phase 1:** one container per user on a Hetzner VPS. Same image as self-hosted.
- **Cloud-hosted Phase 2 (future):** E2B microVMs or Kubernetes Agent Sandbox CRD. Same container internals.
- **Linux-first for MVP.** Windows/macOS self-hosters use WSL2 or a Linux VM.

There is no three-container split. Crash isolation comes from supervisor restart policies and path-based permission separation, not container boundaries.

---

### 8. Process Architecture

Inside one container (or one host), the supervisor runs:

| Process | Restart | Source location | Purpose |
|---|---|---|---|
| `pocketbase` | always | `/usr/local/bin/pocketbase` | Data layer. SQLite + REST + Realtime SSE on :8090. |
| `tunnel-manager` | always | `/.anyclaw/tunnel/` | Persistent WSS to the broker. Survives every other crash. |
| `dispatch-mcp` | always | `/.anyclaw/dispatch/` | Task dispatch API + MCP HTTP/SSE + emergency rollback + restart-logic. Agent-read-only. |
| `logic-service` | on-failure | `/data/prod/logic-build/` | Agent-modifiable Node logic service. Custom routes + jobs. |
| `prod-static` | always | `/.anyclaw/prod-static/` | Express server for `/data/prod/frontend-build/`. |

Transient (not supervised):

- **Agent subprocess:** spawned per task by the dispatch server with `cwd=/data/dev/.worktrees/task-<id>/`. Resource-limited at spawn time (decision #26 — no-op `ResourceLimits` interface for MVP, populated later).
- **Vite dev server:** spawned by the agent inside its worktree during the build/test cycle. Dies when the task finishes.

The `/.anyclaw/` tree is owned by the `anyclaw-infra` user; `/data/dev/` is owned by `anyclaw-agent`. The agent subprocess runs as `anyclaw-agent`, so ordinary Unix permissions prevent it from touching infrastructure code. The dispatch server additionally sandboxes any MCP tool invocations that shell out so the agent cannot trick them into reading or writing outside the worktree.

---

### 9. Filesystem Layout

```
/data/                              # Persistent volume / bind-mount
  pocketbase/                       # PocketBase data (SQLite, uploads)
    pb_data/
    pb_migrations/
  dev/                              # Agent workspace (owned by anyclaw-agent)
    .git/                           # Source of truth; main branch
    .worktrees/
      task-abc123/                  # One per active task (decision #36)
        packages/frontend/
        packages/logic/
        package.json
    packages/
      frontend/
      logic/
    package.json
  prod/                             # Deployed artifacts (read-only to agent)
    frontend-build/                 # Static assets for prod-static
    logic-build/                    # Compiled logic service
    VERSION                         # Current deployed git sha + description
  snapshots/                        # Compressed DB snapshots for rollback
    2026-04-06T12-00-00Z.sqlite.gz
    ...
  .anyclaw/                         # Per-instance secrets (owned anyclaw-infra, 0600)
    master.key                      # AES-256-GCM master encryption key (#48)
    pb-token                        # Long-lived PocketBase API token (#47)

/.anyclaw/                          # Infrastructure code (read-only to agent)
  dispatch/                         # Dispatch + MCP server source
  tunnel/                           # Tunnel manager source
  prod-static/                      # Express static server source
  skills/                           # Skill .md files
    anyclaw-build-feature.md
    anyclaw-style-guide.md
    anyclaw-refactor.md
    anyclaw-describe-version.md
  scripts/
    package-skills.sh
    store-api-key.js
    bootstrap-pocketbase.sh
  systemd/                          # Unit files (native install)
    anyclaw-pocketbase.service
    anyclaw-tunnel.service
    anyclaw-dispatch.service
    anyclaw-logic.service
    anyclaw-prod-static.service
  supervisord.conf                  # Container install
```

The path split is the security boundary that replaces the old sandbox container.

---

### 10. systemd Unit Files (native install, user mode)

Decision #25: systemd in user mode is preferred for native installs. Files live at `~/.config/systemd/user/` (copied from `/.anyclaw/systemd/`).

**`anyclaw-pocketbase.service`:**
```ini
[Unit]
Description=AnyClaw PocketBase
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/pocketbase serve --http=127.0.0.1:8090 --dir=/data/pocketbase/pb_data
Restart=always
RestartSec=2
StandardOutput=append:/data/.anyclaw/logs/pocketbase.log
StandardError=append:/data/.anyclaw/logs/pocketbase.err

[Install]
WantedBy=default.target
```

**`anyclaw-tunnel.service`:**
```ini
[Unit]
Description=AnyClaw Tunnel Manager
After=network.target

[Service]
Type=simple
WorkingDirectory=/.anyclaw/tunnel
ExecStart=/usr/bin/node /.anyclaw/tunnel/index.js
EnvironmentFile=/data/.anyclaw/tunnel.env
Restart=always
RestartSec=2
StandardOutput=append:/data/.anyclaw/logs/tunnel.log
StandardError=append:/data/.anyclaw/logs/tunnel.err

[Install]
WantedBy=default.target
```

**`anyclaw-dispatch.service`:**
```ini
[Unit]
Description=AnyClaw Dispatch + MCP Server
After=anyclaw-pocketbase.service
Wants=anyclaw-pocketbase.service

[Service]
Type=simple
WorkingDirectory=/.anyclaw/dispatch
ExecStart=/usr/bin/node /.anyclaw/dispatch/index.js
Environment=POCKETBASE_URL=http://127.0.0.1:8090
Environment=DEV_WORKSPACE=/data/dev
Environment=PROD_WORKSPACE=/data/prod
Environment=SNAPSHOTS_DIR=/data/snapshots
Environment=INFRA_DIR=/.anyclaw
EnvironmentFile=/data/.anyclaw/dispatch.env
Restart=always
RestartSec=2
StandardOutput=append:/data/.anyclaw/logs/dispatch.log
StandardError=append:/data/.anyclaw/logs/dispatch.err

[Install]
WantedBy=default.target
```

**`anyclaw-logic.service`** (agent-modifiable; restart on failure, not on clean exit):
```ini
[Unit]
Description=AnyClaw Logic Service (agent-built)
After=anyclaw-pocketbase.service
Wants=anyclaw-pocketbase.service

[Service]
Type=simple
WorkingDirectory=/data/prod/logic-build
ExecStart=/usr/bin/node /data/prod/logic-build/index.js
Environment=POCKETBASE_URL=http://127.0.0.1:8090
Environment=NODE_ENV=production
EnvironmentFile=/data/.anyclaw/logic.env
Restart=on-failure
RestartSec=3
SuccessExitStatus=0
StandardOutput=append:/data/.anyclaw/logs/logic.log
StandardError=append:/data/.anyclaw/logs/logic.err

[Install]
WantedBy=default.target
```

**`anyclaw-prod-static.service`:**
```ini
[Unit]
Description=AnyClaw Prod Static Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/.anyclaw/prod-static
ExecStart=/usr/bin/node /.anyclaw/prod-static/server.js
Environment=PROD_FRONTEND=/data/prod/frontend-build
Environment=PORT=5173
Restart=always
RestartSec=2
StandardOutput=append:/data/.anyclaw/logs/prod-static.log
StandardError=append:/data/.anyclaw/logs/prod-static.err

[Install]
WantedBy=default.target
```

**Operational commands:**
```bash
systemctl --user daemon-reload
systemctl --user enable anyclaw-pocketbase anyclaw-tunnel anyclaw-dispatch \
                        anyclaw-logic anyclaw-prod-static
systemctl --user start  anyclaw-pocketbase anyclaw-tunnel anyclaw-dispatch \
                        anyclaw-logic anyclaw-prod-static
```

Decision #28: after a successful deploy, the dispatch server shells out `systemctl --user restart anyclaw-logic` (or the supervisord equivalent inside a container) to swap the logic process onto the new prod build.

For the container path, the equivalent `supervisord.conf`:

```ini
[supervisord]
nodaemon=true
logfile=/var/log/anyclaw/supervisord.log
pidfile=/var/run/supervisord.pid
user=root

[program:pocketbase]
command=/usr/local/bin/pocketbase serve --http=127.0.0.1:8090 --dir=/data/pocketbase/pb_data
autorestart=true
startretries=10
user=anyclaw-infra
stdout_logfile=/var/log/anyclaw/pocketbase.log
stderr_logfile=/var/log/anyclaw/pocketbase.err

[program:tunnel-manager]
command=/usr/bin/node /.anyclaw/tunnel/index.js
autorestart=true
startretries=10
user=anyclaw-infra
environment=BROKER_URL="%(ENV_BROKER_URL)s",ANYCLAW_USER_TOKEN="%(ENV_ANYCLAW_USER_TOKEN)s"
stdout_logfile=/var/log/anyclaw/tunnel.log
stderr_logfile=/var/log/anyclaw/tunnel.err

[program:dispatch-mcp]
command=/usr/bin/node /.anyclaw/dispatch/index.js
autorestart=true
startretries=10
user=anyclaw-infra
environment=POCKETBASE_URL="http://127.0.0.1:8090",DEV_WORKSPACE="/data/dev",PROD_WORKSPACE="/data/prod",SNAPSHOTS_DIR="/data/snapshots",INFRA_DIR="/.anyclaw"
stdout_logfile=/var/log/anyclaw/dispatch.log
stderr_logfile=/var/log/anyclaw/dispatch.err

[program:logic-service]
command=/usr/bin/node /data/prod/logic-build/index.js
directory=/data/prod/logic-build
autorestart=unexpected
exitcodes=0
startretries=5
user=anyclaw-infra
environment=POCKETBASE_URL="http://127.0.0.1:8090",NODE_ENV="production"
stdout_logfile=/var/log/anyclaw/logic.log
stderr_logfile=/var/log/anyclaw/logic.err

[program:prod-static]
command=/usr/bin/node /.anyclaw/prod-static/server.js
autorestart=true
startretries=10
user=anyclaw-infra
environment=PROD_FRONTEND="/data/prod/frontend-build",PORT="5173"
stdout_logfile=/var/log/anyclaw/prod-static.log
stderr_logfile=/var/log/anyclaw/prod-static.err
```

---

### 11. Dockerfile

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:20-bookworm-slim

ARG POCKETBASE_VERSION=0.22.0

# System packages
RUN apt-get update && apt-get install -y --no-install-recommends \
      supervisor \
      git \
      curl \
      ca-certificates \
      build-essential \
      python3 \
      wget \
      unzip \
      tini \
 && rm -rf /var/lib/apt/lists/*

# PocketBase binary
RUN curl -fsSL -o /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_amd64.zip" \
 && unzip /tmp/pb.zip -d /usr/local/bin \
 && rm /tmp/pb.zip \
 && chmod +x /usr/local/bin/pocketbase

# Non-root users (decision #29)
RUN groupadd --system anyclaw-infra \
 && useradd  --system --gid anyclaw-infra --home /.anyclaw --shell /usr/sbin/nologin anyclaw-infra \
 && groupadd --system anyclaw-agent \
 && useradd  --system --gid anyclaw-agent --home /data/dev --shell /bin/bash anyclaw-agent

# Infrastructure code (agent-read-only)
COPY --chown=anyclaw-infra:anyclaw-infra infra/ /.anyclaw/
RUN cd /.anyclaw/dispatch    && npm ci --omit=dev \
 && cd /.anyclaw/tunnel      && npm ci --omit=dev \
 && cd /.anyclaw/prod-static && npm ci --omit=dev

# Data directories
RUN mkdir -p /data/pocketbase/pb_data \
             /data/dev \
             /data/prod/frontend-build \
             /data/prod/logic-build \
             /data/snapshots \
             /data/.anyclaw/logs \
             /var/log/anyclaw \
             /var/run \
 && chown -R anyclaw-infra:anyclaw-infra /data/pocketbase /data/prod /data/snapshots \
                                          /data/.anyclaw  /var/log/anyclaw \
 && chown -R anyclaw-agent:anyclaw-agent /data/dev \
 && chmod 0750 /data/.anyclaw

# Supervisord config
COPY infra/supervisord.conf /etc/supervisor/conf.d/anyclaw.conf

EXPOSE 8090 5173
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/anyclaw.conf"]
```

---

### 12. docker-compose.yml (self-hosted single service)

```yaml
services:
  anyclaw:
    image: ghcr.io/anyclaw/anyclaw:latest
    container_name: anyclaw
    restart: unless-stopped
    ports:
      - "127.0.0.1:8090:8090"   # PocketBase, loopback only
      - "127.0.0.1:5173:5173"   # Prod static, loopback only
    volumes:
      - anyclaw_data:/data
    environment:
      - BROKER_URL=${BROKER_URL:-https://broker.anyclawapp.com}
      - ANYCLAW_USER_TOKEN=${ANYCLAW_USER_TOKEN}
    deploy:
      resources:
        limits:
          cpus: "4.0"
          memory: 4G

volumes:
  anyclaw_data:
    driver: local
```

One service. Supervisord inside runs the five processes. Only the tunnel manager's outbound WSS to the broker is ingress in normal use; host port bindings are on loopback for local debugging.

---

### 13. Install Script

Invocation:
```bash
curl -fsSL https://get.anyclawapp.com | bash
```

The install script handles prerequisites, bootstraps PocketBase with a long-lived API token, generates the master encryption key, and stores the user's LLM API key encrypted in PocketBase.

```bash
#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# AnyClaw Standalone Installer
# ============================================================

ANYCLAW_VERSION="${ANYCLAW_VERSION:-latest}"
INSTALL_DIR="${ANYCLAW_DIR:-$HOME/.anyclaw-host}"

echo "=== AnyClaw Installer ==="

# ----------------------------------------------------------
# [1/6] Prerequisites
# ----------------------------------------------------------
echo "[1/6] Checking prerequisites..."

OS="$(uname -s)"
case "$OS" in
  Linux) ;;
  Darwin) echo "macOS detected. Use Docker Desktop (tested)." ;;
  *) echo "Error: Unsupported OS ($OS). Requires Linux, macOS, or WSL2."; exit 1 ;;
esac

# cgroup v2 check for Linux (decision #25)
if [ "$OS" = "Linux" ]; then
  if [ ! -f /sys/fs/cgroup/cgroup.controllers ]; then
    echo "Warning: cgroup v2 not detected. Resource limits on the agent subprocess"
    echo "will be best-effort. Recommended: Ubuntu 22.04+, Debian 12+, or Fedora."
  fi

  MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
  [ "$MEM_KB" -lt 2000000 ] && echo "Warning: <2GB RAM detected."
fi

FREE_KB=$(df "$HOME" | tail -1 | awk '{print $4}')
[ "$FREE_KB" -lt 5000000 ] && echo "Warning: <5GB free disk space."

# ----------------------------------------------------------
# [2/6] Docker
# ----------------------------------------------------------
echo "[2/6] Checking Docker..."

if ! command -v docker &>/dev/null; then
  if [ "$OS" = "Linux" ]; then
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    echo "You may need to log out and back in for docker group membership."
  else
    echo "Error: install Docker Desktop and re-run."; exit 1
  fi
fi

docker info &>/dev/null || { echo "Error: Docker not running."; exit 1; }
docker compose version &>/dev/null || { echo "Error: docker compose v2 required."; exit 1; }

# ----------------------------------------------------------
# [3/6] Install directory + compose file
# ----------------------------------------------------------
echo "[3/6] Setting up install directory..."

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

curl -fsSL "https://releases.anyclawapp.com/$ANYCLAW_VERSION/docker-compose.yml" \
  -o docker-compose.yml
curl -fsSL "https://releases.anyclawapp.com/$ANYCLAW_VERSION/env.template" \
  -o .env.template

# ----------------------------------------------------------
# [4/6] Generate secrets; prompt for LLM API key
# ----------------------------------------------------------
echo "[4/6] Configuring..."

if [ ! -f .env ]; then
  cp .env.template .env

  # Broker user identity token
  ANYCLAW_USER_TOKEN=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 40)
  sed -i.bak "s|ANYCLAW_USER_TOKEN=.*|ANYCLAW_USER_TOKEN=$ANYCLAW_USER_TOKEN|" .env
  rm -f .env.bak

  echo
  echo "AnyClaw needs an LLM API key for AI-powered features."
  read -rp "LLM provider (anthropic/openai) [anthropic]: " LLM_PROVIDER
  LLM_PROVIDER="${LLM_PROVIDER:-anthropic}"
  read -rsp "API key for $LLM_PROVIDER: " LLM_API_KEY
  echo
  BOOTSTRAP_LLM_PROVIDER="$LLM_PROVIDER"
  BOOTSTRAP_LLM_KEY="$LLM_API_KEY"
else
  echo "Existing .env found, keeping current configuration."
  BOOTSTRAP_LLM_PROVIDER=""
  BOOTSTRAP_LLM_KEY=""
fi

# ----------------------------------------------------------
# [5/6] Pull, start, bootstrap PocketBase
# ----------------------------------------------------------
echo "[5/6] Pulling image and starting services..."
docker compose pull
docker compose up -d

# Wait for PocketBase health
echo "Waiting for PocketBase..."
TIMEOUT=120; ELAPSED=0
until docker compose exec -T anyclaw \
        wget -q --spider http://127.0.0.1:8090/api/health 2>/dev/null; do
  sleep 2; ELAPSED=$((ELAPSED+2))
  [ $ELAPSED -ge $TIMEOUT ] && { echo "PocketBase failed to start"; exit 1; }
done

# Bootstrap PocketBase admin + API token (decision #47)
# This script runs inside the container:
#   1. Creates a superuser with a random password (stored in /data/.anyclaw/pb-admin)
#   2. Authenticates as superuser via the admin API
#   3. Creates a long-lived impersonation API token
#   4. Writes the token to /data/.anyclaw/pb-token (mode 0600, anyclaw-infra)
echo "Bootstrapping PocketBase admin + API token..."
docker compose exec -T anyclaw /.anyclaw/scripts/bootstrap-pocketbase.sh

# Generate master encryption key (decision #48)
echo "Generating master encryption key..."
docker compose exec -T anyclaw sh -c '
  if [ ! -f /data/.anyclaw/master.key ]; then
    head -c 32 /dev/urandom | base64 > /data/.anyclaw/master.key
    chmod 0600 /data/.anyclaw/master.key
    chown anyclaw-infra:anyclaw-infra /data/.anyclaw/master.key
  fi
'

# Store LLM key encrypted in PocketBase (decision #49: AES-256-GCM)
if [ -n "$BOOTSTRAP_LLM_KEY" ]; then
  echo "Storing LLM API key (encrypted) in PocketBase..."
  docker compose exec -T -e LLM_KEY="$BOOTSTRAP_LLM_KEY" anyclaw \
    node /.anyclaw/scripts/store-api-key.js \
      --provider "$BOOTSTRAP_LLM_PROVIDER"
  unset BOOTSTRAP_LLM_KEY
fi

# ----------------------------------------------------------
# [6/6] Package skills for the local agent (if any)
# ----------------------------------------------------------
echo "[6/6] Packaging skills for local agent..."

AGENT=""
if   command -v openclaw &>/dev/null; then AGENT="openclaw"
elif command -v claude   &>/dev/null; then AGENT="claude-code"
fi

case "$AGENT" in
  openclaw)
    docker compose exec anyclaw /.anyclaw/scripts/package-skills.sh openclaw
    echo "OpenClaw skills installed in ~/.openclaw/skills/"
    ;;
  claude-code)
    docker compose exec anyclaw /.anyclaw/scripts/package-skills.sh claude-code
    echo "Claude Code slash commands installed in .claude/commands/"
    echo
    echo "Add to your Claude Code MCP config:"
    echo '  { "mcpServers": { "anyclaw": { "url": "http://localhost:3002/mcp" } } }'
    ;;
  *)
    echo "No recognized local agent found. Any MCP agent can connect at:"
    echo "  http://localhost:3002/mcp"
    ;;
esac

echo
echo "=== AnyClaw is running ==="
echo "  Install dir: $INSTALL_DIR"
echo "  Logs:        docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
echo "  Stop:        docker compose -f $INSTALL_DIR/docker-compose.yml down"
echo
echo "Open the AnyClaw mobile app and sign in to connect."
```

**`bootstrap-pocketbase.sh`** (decision #47) runs inside the container and:

1. Checks if `/data/.anyclaw/pb-token` already exists; exits 0 if so (idempotent).
2. Generates a random 32-char password, writes `/data/.anyclaw/pb-admin` (mode 0600).
3. Runs `pocketbase superuser create admin@local "<password>"` non-interactively.
4. POSTs to `http://127.0.0.1:8090/api/admins/auth-with-password` using the generated credentials to get a superuser JWT.
5. POSTs to `/api/collections/_superusers/impersonate/<id>` to mint a long-lived impersonation token (configurable duration, default 100 years).
6. Writes the token to `/data/.anyclaw/pb-token` (mode 0600, owned `anyclaw-infra`).
7. The dispatch server reads `/data/.anyclaw/pb-token` on startup and authenticates every PocketBase call with it.

**`store-api-key.js`** reads `/data/.anyclaw/master.key`, AES-256-GCM-encrypts `LLM_KEY` from env, and upserts into the PocketBase `api_keys` collection (fields: `provider`, `ciphertext`, `iv`, `auth_tag`) via the dispatch server's internal endpoint.

Key properties:
- One service in the compose file.
- PocketBase uses API-token auth (decision #20), not email/password from the dispatch server.
- The master encryption key lives at `/data/.anyclaw/master.key` with 0600 permissions (decision #48).
- LLM API keys live **only** in PocketBase as ciphertext (decision #21, #49). The `.env` file contains no application secrets — only the `BROKER_URL` and a broker-identity token.
- Skills are packaged via a script inside the container so the agent's local config is updated atomically with the server.

---

### 14. Cloud Hosting

#### Phase 1: Hetzner VPS, one container per user

A single Hetzner CX32 VPS (4 vCPU, 8GB RAM, 80GB disk, US East via Ashburn — decision #18 and #44) runs one AnyClaw container per subscriber. Each container is the exact same image as the self-hosted distribution.

**VPS layout:**
```
/opt/anyclaw/
  provisioner/               # Node provisioner + broker API glue
    docker-compose.yml
  caddy/
    Caddyfile                # TLS + WSS routing to the broker
  users/
    user-abc123/
      docker-compose.yml     # single `anyclaw` service, unique volume
      data/                  # bind-mounted to /data inside
    user-def456/
      docker-compose.yml
      data/
    ...
```

Each user's container has its own `/data` volume and its own supervisord supervising its own PocketBase, tunnel manager, dispatch server, logic service, and prod static server. A crash in one user's container cannot affect another. The transient agent subprocess inside each container is bounded by the container's cgroup `cpus`/`memory` limits plus per-process limits applied by the resource limit interface (decision #26 — no-op for MVP).

**Why one container per user, not one shared container:**
- **Container = multi-tenancy boundary.** Supervisord inside = crash-isolation boundary within a tenant. The two boundaries don't overlap.
- Per-user volume isolation is free.
- The image is identical to self-hosted, so the distribution is battle-tested.
- Migration to per-user microVMs (Phase 2) is a straight substitution.

**Provisioner responsibilities:**
- Allocate a unique `ANYCLAW_USER_TOKEN` per user at signup.
- Template a per-user `docker-compose.yml` with unique container name, unique volume name, no host port bindings (all ingress goes through the tunnel manager).
- Set per-user resource limits (`cpus: 0.5`, `memory: 512M` baseline; bursts allowed via overcommit).
- Lifecycle: create, start, stop, destroy.
- Idle shutdown: stop containers after 30 minutes of tunnel inactivity; wake on the next mobile-app broker message.

**Caddy** terminates TLS on `broker.anyclawapp.com` and reverse-proxies WSS to the broker process, which then routes per-user over the in-envelope service tag (decision #43).

#### Phase 2: E2B microVMs or Kubernetes Agent Sandbox CRD (future)

When user count exceeds what a single VPS can handle comfortably (estimated 20–50 depending on usage), migrate to per-user microVMs. The container image and its internal layout don't change. What changes:

- Scheduler: Kubernetes Agent Sandbox CRD or E2B API client replaces the shell-driven `docker compose` provisioner.
- Storage: PVCs or E2B persistent volumes replace host bind-mounts.
- Idle shutdown / wake: handled by the platform.
- Isolation: microVM boundary replaces container boundary.

Same supervisord process set runs inside.

**Phase 2 cost per user/month (estimate):**

| Resource | Cost |
|---|---|
| microVM compute (~50% active) | ~$1.50 |
| Persistent storage (3GB) | ~$0.45 |
| Bandwidth (5GB) | ~$0.00 |
| **Infrastructure total** | **~$2.00** |
| LLM tokens (bundled) | ~$4.00 |
| **COGS** | **~$6.00** |

Supports $12–15/month pricing with healthy margins; BYOK users drop COGS to ~$2.

---

### 15. Hosting OpenClaw Alongside AnyClaw

Cloud-hosted users who choose OpenClaw as their agent get their own OpenClaw instance — not a shared one. The one-container-per-user model (decision #22) makes this clean:

- **Each user's AnyClaw container also runs OpenClaw** as one of the transient processes it spawns on demand. When the dispatch server handles a task and the user has selected OpenClaw as their adapter, it spawns OpenClaw with the worktree path as CWD. OpenClaw runs inside the same container, as the `anyclaw-agent` user, with access only to `/data/dev/.worktrees/task-<id>/` and the MCP endpoint at `http://127.0.0.1:3002/mcp`.
- **Claude Code users** get the same model, except the dispatch server spawns `claude -p` instead (decision #3).
- **There is no shared OpenClaw across users.** Each container is its own tenant boundary; cross-tenant state bleed is structurally impossible.
- **Self-hosted plugin mode** is unchanged: the user's existing OpenClaw or Claude Code installation is packaged with AnyClaw skills by the install script, and the AnyClaw container exposes its MCP endpoint on loopback for the local agent to use.

For self-hosted standalone mode, the install script detects whether OpenClaw or Claude Code is available on the host and packages skills accordingly. If neither is present, the user is directed to install one (or use the generic MCP endpoint with any compatible agent).

---

## Summary

Part A ships four skill files authored once and packaged per-agent by a single script. Skills use YAML frontmatter for bidirectional semver compatibility checks against the dispatch server's `/api/version` endpoint. The agent uses its own file and shell tools; MCP is reserved for deploy, rollback, snapshot, create_collection, ask_user, update_progress, and list_versions.

Part B ships one Docker image (or a native systemd-user install) running five supervised processes plus a transient agent subprocess per task. Self-hosted is one container via docker-compose. Cloud Phase 1 is one container per user on a Hetzner VPS fronted by Caddy. Cloud Phase 2 is a straight port to microVMs or Kubernetes with the same container internals. Each cloud user gets their own OpenClaw/Claude Code instance inside their own container — no shared agent state across tenants. All persistent secrets (PocketBase API token, master encryption key, encrypted LLM API keys) live under `/data/.anyclaw/` or inside PocketBase as AES-256-GCM ciphertexts; nothing sensitive ends up in `.env`.
