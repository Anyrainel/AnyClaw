# Plan 6: Skills + Deployment -- Design Document

**Goal:** Define the complete agent skill suite that teaches coding agents how to build features on AnyClaw, and the deployment setup for self-hosted and cloud-hosted modes.

**Dependencies:** Plan 1 (Server Infrastructure) must be implemented -- the skills reference the project structure, primitives, deployment manager, and dev/prod split defined there.

---

## Part A: Skills

Skills are the instructions that teach a coding agent how to work within the AnyClaw system. They are agent-agnostic in content but packaged differently per agent platform.

The core philosophy (locked decision #5, #23): **the agent uses its own built-in file and shell tools** to read, write, edit, and run commands. AnyClaw MCP tools are reserved for the small set of robustness-critical operations that agents tend to get wrong or cannot do natively. That set is exactly:

- `anyclaw_deploy`
- `anyclaw_rollback`
- `anyclaw_snapshot_db`
- `anyclaw_create_collection`
- `anyclaw_ask_user`
- `anyclaw_update_progress`
- `anyclaw_list_versions`

There are no `anyclaw_read_file`, `anyclaw_write_file`, `anyclaw_run_command`, `anyclaw_create_page`, or `anyclaw_create_api_route` tools. The agent uses its native equivalents for all of those.

---

### Skill 1: anyclaw-build-feature

This is the primary workflow skill. It governs the entire lifecycle of a user feature request.

```markdown
# anyclaw-build-feature

You are building a feature for a personal web application running on AnyClaw
infrastructure. The app uses PocketBase (SQLite DB with auto REST API), a
Node.js/TypeScript logic service, and a Vite+React+TypeScript+Tailwind v4
frontend.

You write code directly using YOUR OWN built-in file tools (read, write, edit)
and YOUR OWN shell tool for running commands. You do NOT use MCP tools for
files or shell -- you already have those.

AnyClaw MCP tools are only for operations that require server-side guarantees:

- `anyclaw_deploy` -- run validation + snapshot + promote dev to prod atomically
- `anyclaw_rollback` -- restore a specific version (code + DB snapshot together)
- `anyclaw_snapshot_db` -- take a DB snapshot before risky schema changes
- `anyclaw_create_collection` -- create a PocketBase collection via admin API
- `anyclaw_ask_user` -- post a clarifying question to the mobile app and wait
- `anyclaw_update_progress` -- post a progress update to the mobile app task card
- `anyclaw_list_versions` -- read deployment history

Your workspace is `/data/dev/` (bind-mounted into the container). Read and
write files there using your own tools. Run `npm`, `tsc`, `vite`, etc. using
your own shell tool. The infrastructure code in `/.anyclaw/` is NOT writable
from your workspace -- do not try to modify it.

Follow this workflow exactly. Do not skip steps.

## Step 1: Understand the Request

Read the user's feature request carefully. Identify:
- What the user wants to accomplish (the goal, not the implementation)
- What data needs to be stored or retrieved
- What UI the user expects to see
- Whether this interacts with any existing features

If ANYTHING is ambiguous, use `anyclaw_ask_user` to clarify BEFORE planning.
Good clarifying questions:
- "Should this data be private to you, or would you want to share it later?"
- "Do you want this as a separate page or added to an existing page?"
- "How often should this update -- real-time, hourly, daily?"
- "Should I send you a notification when [event]?"

Do NOT ask more than 3 questions in a single round. If you need more
information, prioritize the questions that most affect the architecture.
You can ask follow-ups in a second round if needed.

If the request is clear enough to build without ambiguity, skip to Step 2.
Do not ask questions just to appear thorough.

## Step 2: Plan the Feature

Before writing any code, create a concrete plan. Determine which of these
components are needed:

- **Collections (DB tables):** What data needs to be stored? Define collection
  names, field names, field types, and any relations. Use PocketBase
  collection conventions:
  - Collection names: lowercase, plural, snake_case (e.g., `mood_entries`)
  - Field types: text, number, bool, email, url, date, select, relation, file, json
  - Always include a `user` relation field if the data is user-specific
  - Think about what fields the UI will need -- avoid extra round trips

- **API routes (Node.js):** Only needed for complex queries across collections,
  external API calls, LLM processing, or custom business logic beyond CRUD.
  If the feature is pure CRUD, skip this -- the frontend talks to PocketBase
  directly.

- **Background jobs:** Only needed for scheduled fetching, periodic processing,
  or timed notifications. Define the job name, cron schedule, and what it does.

- **Pages and components:** What UI screens are needed? What shared components?

- **Navigation:** Where does this feature appear in the app's navigation?

Post your plan to the user via `anyclaw_update_progress`:
"Planning: [feature name] will need [N] new database collections, [N] API
routes, [N] pages, and [N] background jobs. Building now."

## Step 3: Implement -- Database Layer

Create collections first because everything else depends on them.

For each collection:
1. Call `anyclaw_create_collection` with the full schema definition
2. Verify by reading back its schema (the tool returns the created schema)
3. If the collection has relations to existing collections, confirm those exist

Order matters: create collections that others depend on first.

Do NOT try to edit PocketBase internals, migration files, or the PocketBase
data directory. The MCP tool is the only way to change schema.

## Step 4: Implement -- Backend Layer

If API routes or background jobs are needed, use your own file tools to write
them in the workspace.

For API routes: create the route file in
`/data/dev/packages/logic/src/routes/` and follow this pattern exactly:

```typescript
import { Router } from "express";
import { getPocketBase } from "../primitives/get-pocketbase";

const router = Router();

router.get("/api/your-endpoint", async (req, res) => {
  try {
    const pb = getPocketBase();
    // Your logic here
    res.json({ data: result });
  } catch (error) {
    console.error("Error in /api/your-endpoint:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
```

Register the route in `/data/dev/packages/logic/src/index.ts` by importing
and mounting it.

For background jobs: create the job file in
`/data/dev/packages/logic/src/jobs/` and follow this pattern:

```typescript
import { scheduleJob } from "../primitives/schedule-job";
import { getPocketBase } from "../primitives/get-pocketbase";

export function registerYourJob() {
  scheduleJob("your-job-name", "0 */6 * * *", async () => {
    const pb = getPocketBase();
    // Your job logic here
  });
}
```

Register the job in `/data/dev/packages/logic/src/index.ts`.

Update progress: "Implementing backend for [feature name]..."

## Step 5: Implement -- Frontend Layer

Build the UI. Follow the anyclaw-style-guide skill for all CSS and component
conventions.

For each new page:
1. Create the page component in `/data/dev/packages/frontend/src/pages/`
2. Add the route to the router configuration
3. Add the page to navigation

For components:
1. Shared components go in `/data/dev/packages/frontend/src/components/`
2. Page-specific components live alongside their page

Data fetching pattern -- always use the PocketBase JS SDK for CRUD:

```typescript
import { pb } from "../lib/pocketbase";

const records = await pb.collection("mood_entries").getList(1, 50, {
  sort: "-created",
});

await pb.collection("mood_entries").create({
  mood: "happy",
  energy: 8,
  notes: "Good day",
});

pb.collection("mood_entries").subscribe("*", (e) => {
  // handle real-time updates
});
```

For custom API calls (to the Node.js logic service):

```typescript
import { api } from "../lib/api";

const result = await api.get("/api/your-endpoint");
```

Update progress: "Building UI for [feature name]..."

## Step 6: Test in Dev

Run the validation suite using your OWN shell tool, in `/data/dev/`:

1. `npm run lint` -- fix any lint errors before proceeding
2. `npm run typecheck` -- fix any type errors before proceeding
3. `npm run build` -- fix any build errors before proceeding
4. `npm run test` -- fix any failing tests before proceeding

If you created new API routes, test them by starting the dev server in the
background and running curl against the endpoints.

If you modified existing features, verify they still work (existing pages
render, existing routes still respond).

Do NOT proceed to deployment if any validation step fails.
Iterate until everything passes. If you are stuck after 3 attempts on the
same error, use `anyclaw_ask_user` to explain the situation and ask for guidance.

## Step 7: Write Version Description

Follow the anyclaw-describe-version skill to write a clear, non-technical
description of what changed. This appears in the user's version history.

## Step 8: Deploy

Call `anyclaw_deploy` with your version description.

The deploy tool will:
1. Run the full validation suite one more time (server-side, authoritative)
2. Snapshot the database if schema changed
3. Commit to git with the version description
4. Promote build artifacts from `/data/dev/` to `/data/prod/`
5. Trigger a WebView reload on the mobile app

If deployment fails, read the error carefully. Common causes:
- Lint or type errors introduced after your last check -- fix and retry
- Build errors from missing imports -- check imports and retry
- Smoke test failures from broken existing features -- investigate the regression

Update progress: "Deployed! [feature name] is live."

## Rules

- NEVER edit files under `/data/prod/`. All changes go through `/data/dev/`.
- NEVER try to modify files under `/.anyclaw/` -- that is infrastructure and
  is not writable from your workspace.
- NEVER modify PocketBase's internal files. Use `anyclaw_create_collection`.
- NEVER deploy without passing all validation steps.
- NEVER delete existing collections unless the user explicitly asks to remove
  a feature.
- ALWAYS snapshot the database before risky schema changes. `anyclaw_deploy`
  does this automatically, but call `anyclaw_snapshot_db` explicitly if you
  are doing manual testing with schema changes.
- ALWAYS post progress updates so the user knows what is happening.
- If a feature request needs new npm packages, run `npm install <package>`
  from your own shell in the appropriate workspace. Prefer well-known,
  maintained packages. Avoid packages with fewer than 1000 weekly downloads
  unless there is no alternative.
```

---

### Skill 2: anyclaw-style-guide

```markdown
# anyclaw-style-guide

You are building the frontend UI for an AnyClaw personal web app.
This style guide defines the exact conventions you must follow for all
React components and CSS. Consistency matters -- the user sees every
feature you build side by side, so they must look like they belong together.

## CSS Approach: Tailwind CSS v4

Use Tailwind CSS v4 utility classes for all styling. Tailwind v4 uses
CSS-first configuration -- theme tokens are defined in
`packages/frontend/src/app.css` using `@theme`, not in a JS/TS config file.
Do not use:
- Inline style objects (`style={{ }}`)
- CSS Modules
- Styled-components or CSS-in-JS libraries
- Separate .css files (except `app.css` with Tailwind's `@theme` block)
- A `tailwind.config.ts` file (Tailwind v4 does not use one)

Tailwind is already configured in the project. Use utility classes directly
on JSX elements.

## Color System

Use the following semantic color tokens defined in
`packages/frontend/src/app.css` via `@theme`. NEVER use raw color values
(no `bg-blue-500`). Always use semantic names:

```
Primary:    bg-primary, text-primary, border-primary
Secondary:  bg-secondary, text-secondary, border-secondary
Accent:     bg-accent, text-accent, border-accent
Surface:    bg-surface (card/panel backgrounds)
Background: bg-background (page background)
Text:       text-foreground (primary text), text-muted (secondary text)
Border:     border-default
Danger:     bg-danger, text-danger, border-danger
Success:    bg-success, text-success, border-success
Warning:    bg-warning, text-warning, border-warning
```

If the user has not customized colors, these resolve to a clean neutral
palette with a single accent color. The user can retheme by changing the
tokens in `app.css` -- your job is to use the tokens so theming works.

## Typography

- Page titles: `text-2xl font-semibold text-foreground`
- Section headings: `text-lg font-medium text-foreground`
- Body text: `text-base text-foreground`
- Secondary/caption text: `text-sm text-muted`
- Small labels: `text-xs text-muted`

Do not use `font-bold` except for emphasis within body text.
Use `font-semibold` for headings and `font-medium` for sub-headings.

## Spacing

- Page padding: `p-4` on mobile, `p-6` on desktop
- Between sections: `space-y-6`
- Between items in a list: `space-y-3`
- Between elements in a card: `space-y-2`
- Card padding: `p-4`
- Inline spacing between elements: `gap-2` or `gap-3`

## Component Patterns

### Cards
```tsx
<div className="bg-surface rounded-xl border border-default p-4 space-y-2">
  {/* card content */}
</div>
```
Always use `rounded-xl` for cards. Never use sharp corners or `rounded-sm`.

### Buttons
Primary:
```tsx
<button className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium
  hover:opacity-90 active:opacity-80 transition-opacity">
  Button Text
</button>
```

Secondary:
```tsx
<button className="bg-surface border border-default rounded-lg px-4 py-2 text-sm
  font-medium text-foreground hover:bg-background active:opacity-80 transition-colors">
  Button Text
</button>
```

Danger:
```tsx
<button className="bg-danger text-white rounded-lg px-4 py-2 text-sm font-medium
  hover:opacity-90 active:opacity-80 transition-opacity">
  Delete
</button>
```

### Form Inputs
```tsx
<input
  className="w-full bg-background border border-default rounded-lg px-3 py-2
    text-base text-foreground placeholder:text-muted focus:outline-none
    focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
  placeholder="Enter value..."
/>
```

### Empty States
```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <p className="text-muted text-sm">No entries yet</p>
  <button className="mt-3 text-primary text-sm font-medium">
    Add your first entry
  </button>
</div>
```

### Loading States
```tsx
<div className="flex items-center justify-center py-12">
  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary
    border-t-transparent" />
</div>
```

## Responsive Breakpoints

Mobile-first. The app runs primarily in a mobile WebView.

- Default (no prefix): 320px-480px, PRIMARY target
- `sm:` 640px+, large phone / small tablet
- `md:` 768px+, tablet
- `lg:` 1024px+, desktop (rare -- browser access only)

Rules:
- All layouts must work at 320px width. No horizontal scrolling ever.
- Single-column layouts by default. `md:grid-cols-2`+ only for tablet+.
- Touch targets at least 44px tall (`min-h-[44px]`).
- Font sizes at least `text-sm` (14px). Never `text-xs` for interactive labels.

## Component File Organization

```
packages/frontend/src/
  components/           # Shared components used across multiple pages
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
    news/
      NewsPage.tsx
      NewsCard.tsx
```

Rules:
- Shared components in `components/` (2+ pages use them).
- Page-specific components in the feature folder alongside the page.
- One component per file. PascalCase file name matches component name.
- Pages are default exports. Shared components are named exports.

## Component Naming

- Pages: `[Feature]Page.tsx`
- Feature-specific: `[Feature][Thing].tsx`
- Shared: `[Thing].tsx`
- No barrel `index.tsx` files.

## State Management

- `useState` and `useEffect` for local state.
- PocketBase real-time subscriptions for live data (not polling).
- Cross-page shared state: React Context in `contexts/`.
- Do NOT install Redux, Zustand, Jotai etc. unless the user asks.

## Data Fetching

- `useEffect` + `useState` for initial loads.
- Custom hooks in `packages/frontend/src/hooks/` for reusable patterns.
- Always handle loading, error, and empty states. Never render blank.

## Accessibility

- All images have `alt` text.
- All inputs have associated `<label>` or `aria-label`.
- Semantic HTML: `<main>`, `<nav>`, `<section>`, `<article>`, `<button>`.
- Color alone never conveys information.
- Focus rings via `focus:ring-2 focus:ring-primary/50`.

## Icons

Use `lucide-react` for all icons. Already installed.

```tsx
import { Plus, Trash2, Settings, ChevronRight } from "lucide-react";
<Plus className="h-5 w-5" />
```

Do not install other icon libraries.

## Do NOT

- No `any` type. Type everything properly.
- No `// @ts-ignore` or `// @ts-expect-error`.
- No `!important` in class names.
- No hardcoded colors.
- No components over 200 lines.
- No `dangerouslySetInnerHTML` unless rendering sanitized markdown.
- No elaborate animations. `transition-opacity`/`transition-colors` only.
```

---

### Skill 3: anyclaw-refactor

```markdown
# anyclaw-refactor

You are reviewing and cleaning up the codebase of an AnyClaw personal web app.
This skill is invoked either on a schedule (e.g., after every 5 deployments)
or when the agent detects growing complexity during a build-feature task.

## When to Trigger a Refactor

Refactoring runs automatically when ANY of these conditions are met:
- A component file exceeds 200 lines
- Three or more pages contain duplicated JSX patterns
- A single page file imports more than 10 modules
- The same PocketBase query pattern appears in 3+ files
- The `packages/logic/src/routes/` directory has more than 15 route files
- A background job file exceeds 100 lines
- After every 5th deployment

The agent can also invoke this skill proactively during a build-feature task
if it notices code smells while implementing.

## What to Look For

### 1. Component Extraction
Scan all page files for repeated JSX patterns. If the same card layout, list
item structure, or form pattern appears in 2+ pages, extract it into a shared
component in `packages/frontend/src/components/`.

### 2. Custom Hook Extraction
If 2+ components fetch from the same collection with similar options, extract
a custom hook in `packages/frontend/src/hooks/`.

### 3. Dead Code Removal
- Unused imports
- Components defined but never rendered
- API routes no page or job calls
- Collections no code reads from or writes to
- Background jobs whose schedules are commented out

### 4. File Organization
Check the style guide rules are followed. If files are misplaced, move them
and update all imports.

### 5. Route Consolidation
Collapse many small route files for the same feature into a single file per
feature.

### 6. Type Improvements
- Replace `any` with proper types
- Add missing return types
- Create shared type definitions
- Ensure PocketBase collection types are defined once and reused

## Safety Rules

- NEVER refactor and add features in the same deployment.
- ALWAYS run lint, typecheck, build, tests after each change.
- NEVER change behavior during a refactor.
- NEVER delete a PocketBase collection during refactoring.
- Make small, incremental changes.
- If a refactor breaks tests, revert it.

## Version Description for Refactors

Format: "Housekeeping: [what you cleaned up]"
Examples:
- "Housekeeping: extracted shared Card and ListItem components"
- "Housekeeping: consolidated mood-related API routes into a single file"
```

---

### Skill 4: anyclaw-describe-version

```markdown
# anyclaw-describe-version

You are writing a version description for a deployment of an AnyClaw personal
web app. This description appears in the user's version history screen.
The user is NOT a developer. Write for a normal person.

## Rules

1. Start with what the user can now DO, not what you coded.
2. Use plain language. No technical jargon.
3. One to three sentences. Never more.
4. If the feature has a visual component, describe what they will see.
5. If the feature has a background component, explain what happens and when.
6. Do not mention file names, function names, components, collections,
   API routes, or database schemas.
7. Do not say "I" or "the agent." Describe what changed, not who changed it.
8. Use present tense ("You can now..." not "Added the ability to...").

## Examples

Good: mood tracker with weekly chart
> You can now track your mood, energy, and stress levels with a daily
> check-in. A weekly chart shows your trends over time.

Good: news aggregator
> Your personalized news feed is ready. It pulls articles from your chosen
> sources every 6 hours and highlights the ones most relevant to you.

Good: refactoring
> Housekeeping: cleaned up the code behind the scenes. Everything works
> the same, just tidier under the hood.

Bad (do NOT write like this):
> Added MoodEntry collection with fields for mood, energy, stress, and notes.
> Created MoodPage component with MoodEntryForm and MoodChart sub-components.
```

---

### Skill 5: Skill Packaging

Skills are authored once and packaged into three formats depending on the target agent platform.

#### 5a. Source Format

```
anyclaw-server/
  skills/
    anyclaw-build-feature.md
    anyclaw-style-guide.md
    anyclaw-refactor.md
    anyclaw-describe-version.md
```

Each file contains the skill prompt exactly as the agent should receive it, with a YAML frontmatter block for versioning (see 5e).

#### 5b. OpenClaw Packaging

Install script copies `.md` files into OpenClaw's skill directory (typically `~/.openclaw/skills/`), discovered via `~/.openclaw/config.json` `skillsDir`.

#### 5c. Claude Code Packaging

Two mechanisms:

**CLAUDE.md** -- the install script appends:

```markdown
## AnyClaw Agent Instructions

You are building features for an AnyClaw personal web app. When working on
this project, follow these rules:

1. Follow `/anyclaw-build-feature` for all feature work
2. Follow `/anyclaw-style-guide` for all frontend code
3. Run `/anyclaw-refactor` after every 5 deployments
4. Follow `/anyclaw-describe-version` when writing version descriptions

Use your own built-in file and shell tools for all reading, writing, editing,
and running commands. AnyClaw MCP tools are only: anyclaw_deploy,
anyclaw_rollback, anyclaw_snapshot_db, anyclaw_create_collection,
anyclaw_ask_user, anyclaw_update_progress, anyclaw_list_versions.
Do not manually edit PocketBase files or the /data/prod/ directory.
```

**Slash commands:** skill files copied to `.claude/commands/`.

#### 5d. Generic Agent Packaging (System Prompts)

For agents without MCP skill support, skills are concatenated into `anyclaw-server/skills/system-prompt.txt` and passed as the system prompt by the generic webhook adapter.

#### 5e. Skill Versioning and Compatibility

Skills are versioned independently. Each file has YAML frontmatter:

```yaml
---
skill_version: "1.3.0"
min_server_version: "0.5.0"
---
```

The dispatch server exposes `GET /api/version`:

```json
{
  "server_version": "0.7.2",
  "min_skill_version": "1.0.0"
}
```

At task dispatch time, the dispatch server parses frontmatter, checks semver compatibility both directions, and rejects incompatible skill+server combinations with a clear error. Frontmatter is stripped before the skill content is passed to the agent.

#### 5f. Packaging Script

`anyclaw-server/scripts/package-skills.sh` generates all three formats. It copies skill files to `.claude/commands/`, builds the concatenated `system-prompt.txt`, and copies to OpenClaw's skill directory if OpenClaw is installed.

---

## Part B: Deployment

The deployment model is locked by decisions #8, #22, #23:

- **Self-hosted:** one Docker container (or native install) running supervisord/systemd inside, which supervises multiple AnyClaw processes.
- **Cloud-hosted Phase 1:** one container per user on a single VPS. Each container is the same layout as self-hosted.
- **Cloud-hosted Phase 2 (future):** migrate to E2B microVMs or Kubernetes Agent Sandbox CRD when scale justifies.

There is **no three-container architecture**, no sandbox container, no control plane container, no cross-container Docker socket access. Crash isolation is provided by supervisord process restart policies, not container splits.

---

### 6. Container and Process Layout

#### 6a. Filesystem Layout

```
/data/                           # Persistent bind-mount / volume
  pocketbase/                    # PocketBase data directory (SQLite, uploads)
  dev/                           # Agent's workspace -- READ/WRITE for agent
    packages/
      frontend/
      logic/
    package.json
    .git/
  prod/                          # Deployed artifacts -- NOT writable by agent
    frontend-build/
    logic-build/
  snapshots/                     # Compressed DB snapshots for rollback

/.anyclaw/                       # AnyClaw infrastructure code -- NOT writable by agent
  dispatch/                      # Dispatch/MCP server source
  tunnel/                        # Tunnel manager source
  prod-static/                   # Prod static file server
  skills/                        # Skill files
  scripts/
    package-skills.sh
  supervisord.conf
```

The path separation is the security boundary that replaces the old sandbox container. The agent's subprocess is spawned with `cwd=/data/dev/` and has ordinary filesystem permissions, but the dispatch server enforces that MCP tool invocations do not touch paths outside `/data/dev/`. More importantly, `/.anyclaw/` is owned by a different user (or mounted read-only into the agent subprocess via bind-mount options) so the agent cannot mutate the dispatch server's own source.

#### 6b. Supervised Processes

Inside the single container (or on the host for native installs), supervisord runs the following processes. All are started on boot. Each has its own restart policy.

| Process | Restart policy | Purpose |
|---|---|---|
| `pocketbase` | `autorestart=true` | Data layer. Serves DB REST + Realtime SSE on 8090. |
| `tunnel-manager` | `autorestart=true` | Persistent WSS connection to broker. Survives all other crashes so the mobile app never loses contact. |
| `dispatch-mcp` | `autorestart=true` | Task dispatch API + MCP HTTP/SSE endpoint + emergency rollback + restart-logic endpoint. Always available. Source in `/.anyclaw/dispatch/`. |
| `logic-service` | `autorestart=unexpected` | Agent-modifiable Node.js service. Custom API routes + background jobs. Runs `/data/prod/logic-build/`. Restart-on-crash only. |
| `prod-static` | `autorestart=true` | Small Express server serving `/data/prod/frontend-build/` to the WebView. |

The **agent subprocess** and **Vite dev server** are NOT supervisord entries. They are spawned transiently by the dispatch server on a per-task basis and exit when the task is done (or is killed). Resource limits on the agent subprocess are applied at spawn time via `systemd-run --scope --uid=... --property=MemoryMax=... --property=CPUQuota=...` on systems with systemd, or via supervisord's `rlimit` / cgroup integration in container-only environments.

#### 6c. supervisord.conf (reference)

`/.anyclaw/supervisord.conf`:

```ini
[supervisord]
nodaemon=true
logfile=/var/log/supervisord/supervisord.log
pidfile=/var/run/supervisord.pid
user=root

[program:pocketbase]
command=/usr/local/bin/pocketbase serve --http=0.0.0.0:8090 --dir=/data/pocketbase
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisord/pocketbase.log
stderr_logfile=/var/log/supervisord/pocketbase.err
startretries=10

[program:tunnel-manager]
command=/usr/local/bin/node /.anyclaw/tunnel/index.js
autostart=true
autorestart=true
environment=BROKER_URL="%(ENV_BROKER_URL)s",ANYCLAW_USER_TOKEN="%(ENV_ANYCLAW_USER_TOKEN)s"
stdout_logfile=/var/log/supervisord/tunnel.log
stderr_logfile=/var/log/supervisord/tunnel.err
startretries=10

[program:dispatch-mcp]
command=/usr/local/bin/node /.anyclaw/dispatch/index.js
autostart=true
autorestart=true
environment=POCKETBASE_URL="http://127.0.0.1:8090",DEV_WORKSPACE="/data/dev",PROD_WORKSPACE="/data/prod",SNAPSHOTS_DIR="/data/snapshots",INFRA_DIR="/.anyclaw"
stdout_logfile=/var/log/supervisord/dispatch.log
stderr_logfile=/var/log/supervisord/dispatch.err
startretries=10

[program:logic-service]
command=/usr/local/bin/node /data/prod/logic-build/index.js
directory=/data/prod/logic-build
autostart=true
autorestart=unexpected
exitcodes=0
environment=POCKETBASE_URL="http://127.0.0.1:8090",NODE_ENV="production"
stdout_logfile=/var/log/supervisord/logic.log
stderr_logfile=/var/log/supervisord/logic.err
startretries=5

[program:prod-static]
command=/usr/local/bin/node /.anyclaw/prod-static/server.js
environment=PROD_FRONTEND="/data/prod/frontend-build",PORT="5173"
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisord/prod-static.log
stderr_logfile=/var/log/supervisord/prod-static.err
startretries=10
```

Note: `logic-service` has `autorestart=unexpected` with `exitcodes=0` so a clean restart by the dispatch server (after a deploy) is not treated as a crash. `pocketbase`, `tunnel-manager`, `dispatch-mcp`, and `prod-static` always restart.

#### 6d. Dockerfile (reference)

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:20-bookworm-slim

# System packages: supervisord, git, curl, build essentials for npm, PocketBase
RUN apt-get update && apt-get install -y --no-install-recommends \
      supervisor \
      git \
      curl \
      ca-certificates \
      build-essential \
      python3 \
      wget \
      unzip \
 && rm -rf /var/lib/apt/lists/*

# Install PocketBase binary
ARG POCKETBASE_VERSION=0.22.0
RUN curl -fsSL -o /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_amd64.zip" \
 && unzip /tmp/pb.zip -d /usr/local/bin \
 && rm /tmp/pb.zip \
 && chmod +x /usr/local/bin/pocketbase

# Copy infrastructure code
COPY infra/ /.anyclaw/
RUN cd /.anyclaw/dispatch && npm ci --omit=dev \
 && cd /.anyclaw/tunnel && npm ci --omit=dev \
 && cd /.anyclaw/prod-static && npm ci --omit=dev

# Create data directories
RUN mkdir -p /data/pocketbase /data/dev /data/prod /data/snapshots /var/log/supervisord

# Supervisord config
COPY infra/supervisord.conf /etc/supervisor/conf.d/anyclaw.conf

EXPOSE 8090 5173
VOLUME ["/data"]

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/anyclaw.conf"]
```

#### 6e. docker-compose.yml (single service)

```yaml
services:
  anyclaw:
    image: ghcr.io/anyclaw/anyclaw:latest
    container_name: anyclaw
    restart: unless-stopped
    ports:
      - "8090:8090"    # PocketBase (internal/debug; not exposed publicly in prod)
      - "5173:5173"    # Prod static server (served via tunnel in normal use)
    volumes:
      - anyclaw_data:/data
    environment:
      - BROKER_URL=${BROKER_URL:-https://broker.anyclawapp.com}
      - ANYCLAW_USER_TOKEN=${ANYCLAW_USER_TOKEN}
      - POCKETBASE_API_TOKEN=${POCKETBASE_API_TOKEN}
    # cgroup-level resource limits for the whole container
    deploy:
      resources:
        limits:
          cpus: "4.0"
          memory: 4G

volumes:
  anyclaw_data:
    driver: local
```

One service, one container. Supervisord inside runs the five supervised processes. The agent subprocess and Vite dev server are spawned by the dispatch server on demand, inside this same container, with their own cgroup limits applied via `systemd-run` (if the host has systemd cgroup delegation) or supervisord's rlimit / `sh -c 'ulimit ...; exec ...'` wrapper.

**Port strategy:** in normal operation the only ingress is the tunnel manager's outbound WSS connection to the broker. The exposed host ports 8090 and 5173 are for local debugging and are typically bound to `127.0.0.1` in production.

#### 6f. Why This Replaces Three Containers

| Old concern | How supervisord-in-one-container handles it |
|---|---|
| Agent can crash the app server | Agent is a transient subprocess; logic service has its own restart policy. |
| Agent can break dispatch/MCP server | `/.anyclaw/` is not in the agent's writable path; dispatch server source is immutable to the agent. |
| Runaway `npm install` or `vite build` consumes all RAM/CPU | cgroup limits applied to the agent subprocess at spawn time via systemd-run or rlimit. |
| PocketBase must stay up | Supervisord restart=always; restarts in ~2s on crash. |
| Tunnel must stay up when everything else breaks | Supervisord restart=always; independent of logic service. |
| Control plane must stay reachable when app is broken | Dispatch server is an independent supervised process with its own restart policy. It never reads from or writes to `/data/prod/logic-build/`. |
| Command blocklist | Enforced at the MCP tool level for tools that shell out; agent's native shell tool is assumed capable (Claude Code / OpenClaw have their own allowlists and user-level confirmations). |

---

### 7. Install Script

Single-container deployment. Handles both Docker and (future) native install. For MVP, Docker-only.

**Invocation:**
```bash
curl -fsSL https://get.anyclaw.com | bash
```

**What the script does:**

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
# Phase 1: Prerequisites
# ----------------------------------------------------------

echo "[1/6] Checking prerequisites..."

OS="$(uname -s)"
case "$OS" in
  Linux|Darwin) ;;
  *) echo "Error: Unsupported OS ($OS). Requires Linux, macOS, or WSL."; exit 1 ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Error: Unsupported architecture ($ARCH)."; exit 1 ;;
esac

if [ "$OS" = "Linux" ]; then
  MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
  if [ "$MEM_KB" -lt 2000000 ]; then
    echo "Warning: Less than 2GB RAM detected."
  fi
fi

FREE_KB=$(df "$HOME" | tail -1 | awk '{print $4}')
if [ "$FREE_KB" -lt 5000000 ]; then
  echo "Warning: Less than 5GB free disk space."
fi

# ----------------------------------------------------------
# Phase 2: Docker
# ----------------------------------------------------------

echo "[2/6] Checking Docker..."

if ! command -v docker &>/dev/null; then
  if [ "$OS" = "Linux" ]; then
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
  else
    echo "Error: install Docker Desktop and re-run."; exit 1
  fi
fi

docker info &>/dev/null || { echo "Error: Docker not running."; exit 1; }
docker compose version &>/dev/null || { echo "Error: docker compose v2 required."; exit 1; }

# ----------------------------------------------------------
# Phase 3: Install dir + compose file
# ----------------------------------------------------------

echo "[3/6] Setting up install directory..."

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

curl -fsSL "https://releases.anyclaw.com/$ANYCLAW_VERSION/docker-compose.yml" \
  -o docker-compose.yml
curl -fsSL "https://releases.anyclaw.com/$ANYCLAW_VERSION/env.template" \
  -o .env.template

# ----------------------------------------------------------
# Phase 4: Configure environment (no secrets in .env beyond tokens)
# ----------------------------------------------------------

echo "[4/6] Configuring..."

if [ ! -f .env ]; then
  cp .env.template .env

  # Generate PocketBase API token (locked decision #20)
  PB_API_TOKEN=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48)
  sed -i.bak "s|POCKETBASE_API_TOKEN=.*|POCKETBASE_API_TOKEN=$PB_API_TOKEN|" .env

  # Generate master encryption key for at-rest API key encryption (#21)
  MASTER_KEY=$(openssl rand -base64 32)
  sed -i.bak "s|ANYCLAW_MASTER_KEY=.*|ANYCLAW_MASTER_KEY=$MASTER_KEY|" .env

  # User identity token for the broker
  ANYCLAW_USER_TOKEN=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 40)
  sed -i.bak "s|ANYCLAW_USER_TOKEN=.*|ANYCLAW_USER_TOKEN=$ANYCLAW_USER_TOKEN|" .env
  rm -f .env.bak

  # Prompt for the LLM API key -- stored encrypted in PocketBase, not in .env
  echo ""
  echo "AnyClaw needs an LLM API key for AI-powered features."
  read -rp "LLM provider (anthropic/openai) [anthropic]: " LLM_PROVIDER
  LLM_PROVIDER="${LLM_PROVIDER:-anthropic}"
  read -rp "API key for $LLM_PROVIDER: " LLM_API_KEY

  BOOTSTRAP_LLM_PROVIDER="$LLM_PROVIDER"
  BOOTSTRAP_LLM_KEY="$LLM_API_KEY"
else
  echo "Existing .env found, keeping current configuration."
  BOOTSTRAP_LLM_PROVIDER=""
  BOOTSTRAP_LLM_KEY=""
fi

# ----------------------------------------------------------
# Phase 5: Pull and start
# ----------------------------------------------------------

echo "[5/6] Pulling and starting AnyClaw..."
docker compose pull
docker compose up -d

# Wait for health
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if docker compose exec -T anyclaw wget -q --spider http://127.0.0.1:8090/api/health 2>/dev/null; then
    break
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

# Store the LLM key encrypted in PocketBase via the dispatch server
if [ -n "$BOOTSTRAP_LLM_KEY" ]; then
  echo "Storing LLM API key (encrypted) in PocketBase..."
  docker compose exec -T anyclaw \
    node /.anyclaw/dispatch/scripts/store-api-key.js \
      --provider "$BOOTSTRAP_LLM_PROVIDER" \
      --key "$BOOTSTRAP_LLM_KEY"
  unset BOOTSTRAP_LLM_KEY
fi

# ----------------------------------------------------------
# Phase 6: Agent skill packaging (for local plugin mode)
# ----------------------------------------------------------

echo "[6/6] Packaging skills for local agent..."

AGENT=""
if command -v openclaw &>/dev/null; then AGENT="openclaw"
elif command -v claude &>/dev/null; then AGENT="claude-code"
fi

if [ "$AGENT" = "openclaw" ]; then
  docker compose exec anyclaw /.anyclaw/scripts/package-skills.sh openclaw
  echo "OpenClaw skills installed."
elif [ "$AGENT" = "claude-code" ]; then
  docker compose exec anyclaw /.anyclaw/scripts/package-skills.sh claude-code
  echo "Claude Code slash commands installed."
  echo ""
  echo "Add this to your Claude Code MCP config:"
  echo "  { \"mcpServers\": { \"anyclaw\": { \"url\": \"http://localhost:3002/mcp\" } } }"
else
  echo "No recognized local agent. You can connect any MCP agent to: http://localhost:3002/mcp"
fi

echo ""
echo "=== AnyClaw is running ==="
echo "  Install dir: $INSTALL_DIR"
echo "  Logs:        docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
echo "  Stop:        docker compose -f $INSTALL_DIR/docker-compose.yml down"
echo ""
echo "Open the AnyClaw mobile app and sign in to connect."
```

Key properties of the updated installer:
- No three-service compose file. One service.
- PocketBase API token is generated, not an admin password (locked decision #20).
- Master encryption key is generated for at-rest API key encryption (#21).
- LLM API key is written encrypted to PocketBase via the dispatch server, never persisted in `.env`.
- Skills are packaged via a script inside the container.

---

### 8. Cloud-Hosted Setup

#### Phase 1: Single VPS, one container per user

Start simple. A single VPS (e.g., Hetzner CX32 -- 4 vCPU, 8GB RAM, 80GB disk) runs one AnyClaw container per user via `docker run` (or a compose project per user). Each container is the exact same image as the self-hosted distribution, with supervisord inside running the full process set.

**VPS layout:**

```
VPS
  ├── /opt/anyclaw/users/
  │     ├── user-abc123/
  │     │     ├── docker-compose.yml    # single `anyclaw` service
  │     │     └── data/                 # bind-mounted to /data in container
  │     ├── user-def456/
  │     │     ├── docker-compose.yml
  │     │     └── data/
  │     └── ...
  ├── /opt/openclaw/                    # shared OpenClaw instance (optional)
  │     └── docker-compose.yml
  └── /opt/anyclaw/provisioner/
        └── docker-compose.yml          # provisioner + broker
```

Each user's container has its own `/data` bind-mount and its own supervisord supervising its own PocketBase, tunnel manager, dispatch server, logic service, and prod static server. Crashes in one user's container cannot affect another user. The agent subprocess inside each user's container is cgroup-limited by the container's own cpu/memory limits plus per-process limits applied by supervisord's rlimit config.

**Why one container per user, not one container for all users:**
- Container = multi-tenancy boundary. Supervisord inside = crash-isolation boundary within a single tenant.
- Per-user volume isolation is free (separate bind-mounts).
- Same image as self-hosted, so the distribution is battle-tested.
- Migration path to per-user microVMs (Phase 2) is a straight substitution.

**Provisioner responsibilities:**
- Allocate a unique `ANYCLAW_USER_TOKEN` per user.
- Template `docker-compose.yml` per user with unique host ports (or no host ports at all, routing only through the tunnel manager).
- Template per-user resource limits (`cpus`, `memory`) so one user cannot starve others.
- Lifecycle: create, start, stop, destroy.
- Idle shutdown: stop the container after 30 minutes of tunnel inactivity; wake on the next mobile app connection via the broker.

**OpenClaw:** optionally run a single shared OpenClaw instance on the same VPS. Cloud-hosted users who choose OpenClaw as their agent dispatch to this shared instance with their own API keys and workspace context. Users who choose Claude Code run it inside their own container (as a transient subprocess spawned by their container's dispatch server).

#### Phase 2: E2B microVMs or Kubernetes Agent Sandbox CRD (future)

When user count exceeds what a single VPS can handle (estimated 20-50 depending on usage), migrate to a per-user microVM model. The same container image runs unchanged -- the only differences are:

- Scheduler: Kubernetes Agent Sandbox CRD or E2B API client instead of shell-driven `docker compose`.
- Storage: Kubernetes PVCs or E2B persistent volumes instead of host bind-mounts.
- Idle shutdown and wake: handled by the platform, not a custom provisioner.
- Stronger isolation: microVM boundary instead of container boundary.

The container's internal layout (supervisord + five processes + transient agent subprocess) does not change. This keeps the migration path tight.

**Phase 2 cost estimate (per user/month):**

| Resource | Cost |
|---|---|
| microVM compute (~50% active) | ~$1.50 |
| Persistent storage (3GB) | ~$0.45 |
| Bandwidth (5GB/month) | ~$0.00 |
| **Infrastructure total** | **~$2.00/user** |
| LLM tokens (bundled ~$3-5) | ~$4.00 |
| **Total COGS** | **~$6.00/user** |

Supports $12-15/month subscription pricing with healthy margins. BYOK users drop COGS to ~$2.

---

### 9. Technical Decisions (Resolved)

Resolutions from the main spec that affect this plan:

| # | Question | Resolution |
|---|---|---|
| 1 | Tailwind v3 or v4? | **v4** with CSS-first `@theme`. No `tailwind.config.ts`. |
| 2 | MCP transport? | **HTTP/SSE from the start.** |
| 3 | Cloud hosting? | **Single VPS, one container per user.** Migrate to E2B / K8s Agent Sandbox later. |
| 4 | Skill versioning? | **Independent with compatibility check** via YAML frontmatter. |
| 5 | Dev workspace isolation? | **No sandbox container.** cgroup limits on the agent subprocess + `/.anyclaw/` not in agent writable path. |
| 6 | Process model? | **One container, supervisord inside**, five supervised processes + transient agent subprocess. |
| 7 | Agent file/shell tools? | **Native agent tools.** MCP only for deploy/rollback/snapshot/create_collection/ask_user/update_progress/list_versions. |

---

## New Gaps

The three-container, sandbox-API, and Docker-socket-proxy gaps from earlier drafts are resolved by the supervisord-in-one-container design. The following gaps remain and must be resolved before implementation.

**1. PocketBase API token provisioning and rotation**

PocketBase API tokens (not email/password) are the locked auth mechanism (#20). Open questions:
- PocketBase does not natively support pre-seeded API tokens -- it requires an admin account to generate them. The install script and the container's first-boot sequence need a deterministic way to: (a) create an initial admin user non-interactively, (b) use it to generate a long-lived API token, (c) ideally disable interactive admin login afterwards so the only auth path is the token.
- Rotation: how does the user regenerate a token if it is compromised? Likely a dispatch server endpoint + a mobile app settings action.
- One token or multiple? The dispatch server and the logic service both need PocketBase access. A single token shared via environment variable is simplest but has a larger blast radius on compromise. Separate tokens per process would require per-process credential injection.

**2. API key encryption scheme in PocketBase**

API keys for LLM providers are stored encrypted in PocketBase (#21). Open questions:
- Algorithm: AES-256-GCM is the obvious choice. Decided.
- Where does the master key live? Options: (a) in `.env` as `ANYCLAW_MASTER_KEY`, loaded into supervisord's environment and passed to the dispatch server; (b) derived from the PocketBase API token so there is only one secret; (c) in a host keyring (macOS Keychain, Linux libsecret) for native installs only. The installer currently puts it in `.env` -- is that acceptable?
- PocketBase has no built-in field-level encryption. The `api_keys` collection stores ciphertext blobs. The dispatch server encrypts on write and decrypts on read. This must be implemented end-to-end in the dispatch server.
- Key rotation: if the master key leaks, the user needs a path to re-encrypt all stored ciphertexts under a new key. Requires a rotation command in the dispatch server.

**3. cgroup limits for the transient agent subprocess**

The agent subprocess is spawned per task with resource limits so a runaway `npm install`, `vite build`, or model invocation cannot starve the supervised processes. Open questions:
- On Linux hosts with systemd and cgroup delegation: `systemd-run --scope --user --property=MemoryMax=2G --property=CPUQuota=150% ...` is clean but requires systemd in the container (non-trivial) or delegation to the host systemd (requires `--cgroupns=host` and privileged access).
- On container-only hosts (Docker Desktop on Mac, most minimal Linux distros): no systemd available. Fall back to `sh -c 'ulimit -v $((2*1024*1024)); exec ...'` for memory and a separate cpulimit/cgroup v2 manipulation for CPU. Less precise.
- On Kubernetes (Phase 2): the agent subprocess can be its own Pod with standard resource limits. Different code path from the self-hosted case.
- What are the right default limits? 2GB RAM and 150% of 1 CPU are plausible starting points but need real-world tuning.

**4. Tailwind v4 `@theme` token definition**

The style guide references semantic color tokens but the exact `@theme` block in `app.css` is not defined. Open questions:
- What is the default light-theme CSS? Tailwind v4 uses `@theme { --color-primary: ...; }` syntax.
- Dark mode: `@theme` supports `@media (prefers-color-scheme: dark)` overrides or a `.dark` class. Which pattern does the app use, and how does the agent know when to add dark-mode overrides?
- Can the agent add new `@theme` tokens, or must it only use predefined ones? Allowing additions means the agent can introduce inconsistencies; forbidding them means some features cannot be built without a style-guide update first.

**5. VPS provisioner design for cloud-hosted mode**

Per-user container provisioning on a shared VPS. Open questions:
- Port allocation: does the provisioner assign unique host ports per user, or run all user containers with no exposed ports and rely entirely on their tunnel manager for ingress? The tunnel-only approach is cleaner (no port exhaustion, no host firewall rules) but requires the broker to route per-user WSS correctly.
- Templating: the provisioner needs to generate a per-user `docker-compose.yml` or `docker run` invocation with unique bind-mount paths, container names, and environment variables. Store templates where? Render at runtime or at user-creation time?
- Resource limits per user: what `cpus` / `memory` limits prevent one user from starving the VPS? A 4 vCPU / 8GB VPS might support 8-16 users with 0.5 CPU / 512MB each, but active usage is bursty during agent runs.
- Idle detection and wake: how does the provisioner know a user's container is idle? Options: (a) tunnel manager heartbeat, (b) dispatch server `/last-activity` endpoint, (c) container CPU metrics. Wake on the first broker message directed at the user.
- Shared OpenClaw concurrency: if a single OpenClaw instance serves multiple cloud users, how are concurrent task dispatches isolated? Each user's workspace bind-mount is different, but OpenClaw process state must not bleed between users. This might be solved by spawning per-user OpenClaw subprocesses inside the shared OpenClaw container, or by giving each user their own OpenClaw container (closer to per-user isolation anyway).
