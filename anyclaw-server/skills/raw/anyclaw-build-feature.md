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

## Step 0: Learn From the Past

Before you ask the user anything or write any code, read the history. The
user cannot see your code, so the only signal you have about their
preferences is what you and previous agent runs have already done and said.

1. Call `anyclaw_list_versions` and read the descriptions of recent
   deployments. They tell you what kinds of features the user has built,
   what language they use to describe things, and what defaults they have
   already accepted.
2. Read the `clarifications` collection in PocketBase for any prior
   `anyclaw_ask_user` exchanges. If a question was already answered once,
   do not ask it again — apply the answer.
3. Read `user_preferences` from PocketBase (theme, font, accent, language).
   These are NOT optional. Every UI you build adapts to them via the
   `usePreferences()` hook. You do not ask the user about visual choices.
4. Read `dev/_examples/welcome.tsx`. This is the canonical example —
   the file structure, theme tokens, data fetching shape, error handling,
   loading and empty states demonstrated there are how AnyClaw code should
   look. See the `anyclaw-canonical-example` skill.

## Step 1: Understand the Request

Read the user's feature request carefully. Identify:
- What the user wants to accomplish (the goal, not the implementation)
- What data needs to be stored or retrieved
- What UI the user expects to see
- Whether this interacts with any existing features

Then ask ONLY fundamental questions — questions whose answers change the
architecture of the feature. Do NOT ask the user about details, visual
choices, naming, or anything you can pick a reasonable default for. The
user is non-technical and reading their phone. Every question is friction.

Good fundamental questions (architecture-changing):
- "Should this data be private, or would you want to share it later?"
- "Do you want this as a separate page or added to an existing page?"
- "How often should this update — real-time, hourly, daily?"

Bad detail questions (NEVER ask these — pick a default and surface it in
the version description so the user can adjust later):
- "What color should the button be?" (read `user_preferences.accent`)
- "What should I call the collection?" (pick a sensible name)
- "Should the chart use bars or lines?" (pick one, mention it in the
  version description)
- "How many items per page?" (pick 20)

Do NOT ask more than 3 questions in a single round. Use `anyclaw_ask_user`
only when you genuinely cannot pick a default that the user could later
change with one sentence. Always check the past clarification history
first — if the same question was already answered, reuse the answer.

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

Before writing a single component, re-read `dev/_examples/welcome.tsx`.
Match its file structure, its data fetching pattern, its error and loading
and empty state shapes. Follow the `anyclaw-style-guide` skill for all
CSS, component conventions, voice & tone, and the `usePreferences()` hook.

Pages in `packages/frontend/src/pages/`, shared components in
`packages/frontend/src/components/`, feature-specific components alongside
their page. Use the PocketBase JS SDK for CRUD and the logic service for
custom endpoints.

Mandatory for every screen:
- Loading state with clear progress text — never just a spinner.
- Error state with an explicit, plain-language message and a suggested
  next step. Never "something went wrong."
- Empty state that is self-explanatory and tells the user what they can
  do next. Every list, every feature.
- Reads `usePreferences()` so theme/font/accent are honored.

Domain modeling first. Name things after what they mean to the user, not
what they technically are. `MoodEntry`, not `Record`. `weeklyAverage`,
not `data2`.

Separate concerns, co-locate related logic. Files that change together
belong in the same folder. Never let a single file grow past 200 lines —
split before that. Big files are painful to edit and waste tokens.

Comments are for future agents, not humans. Only write a comment when it
captures context that the code itself cannot show — a non-obvious
constraint, an external API quirk, a TODO with a real next step. Do not
write comments that restate what the code does.

Make errors explicit. Never silently fall back to a default that hides
failure. A feature that fails clearly is far better than one that pretends
to work but does the wrong thing.

Update progress: "Building UI for [feature]..."

## Step 6: Test in Dev

The user is not at the screen during builds. There is no manual smoke
test. You are the only check. ALWAYS run the FULL cycle, every time, in
this order, in your worktree:

1. `npm run lint` — fix all warnings and errors
2. `npm run typecheck` — no errors, no `any`, no `@ts-ignore`
3. `npm run build` — must succeed
4. `npm run test` — all tests pass
5. **Smoke test.** Start the dev server in the background. Hit every new
   route with curl and assert a 2xx response and a sensible body. Open
   every new page with a headless check (or a `fetch` + HTML assert) and
   confirm it renders without runtime errors. Verify any feature that
   touches existing code still works.

Skipping any step is not allowed, even if the change "looks safe." The
user cannot see the code — robustness comes from this cycle.

Do NOT proceed to deploy if any step fails. Iterate until clean. After
three failed attempts on the same error, use `anyclaw_ask_user` to explain
the problem in plain language and ask for guidance.

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
- NEVER deploy without passing all validation steps (lint, typecheck,
  build, tests, smoke test).
- NEVER delete existing collections unless the user explicitly asks.
- NEVER swallow an error or silently fall back. Surface failure clearly,
  in the UI and in the version description.
- NEVER ask the user about visual choices — read `user_preferences`.
- NEVER ask a question that was already answered in a prior task. Read
  the clarification history first.
- ALWAYS read `dev/_examples/welcome.tsx` before writing any new
  frontend code.
- ALWAYS snapshot before risky schema changes (`anyclaw_deploy` does this
  automatically; call `anyclaw_snapshot_db` for manual experiments).
- ALWAYS post progress updates so the user sees what's happening.
- ALWAYS write loading, error, and empty states for every screen.
- If you need a new npm package, install it in the appropriate workspace.
  Prefer well-known, maintained packages. Avoid packages with fewer than
  1000 weekly downloads unless there is no alternative.
