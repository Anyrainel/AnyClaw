# Plan 6: Skills + Deployment -- Design Document

**Goal:** Define the complete agent skill suite that teaches coding agents how to build features on AnyClaw, and the Docker-based deployment setup for self-hosted and cloud-hosted modes.

**Dependencies:** Plan 1 (Server Infrastructure) must be implemented -- the skills reference the project structure, primitives, deployment manager, and dev/prod split defined there.

---

## Part A: Skills

Skills are the instructions that teach a coding agent how to work within the AnyClaw system. They are agent-agnostic in content but packaged differently per agent platform.

---

### Skill 1: anyclaw-build-feature

This is the primary workflow skill. It governs the entire lifecycle of a user feature request.

```markdown
# anyclaw-build-feature

You are building a feature for a personal web application running on AnyClaw infrastructure.
The app uses PocketBase (SQLite DB with auto REST API), a Node.js/TypeScript logic service,
and a Vite+React+TypeScript+Tailwind v4 frontend.

You write code directly using your built-in file tools (read, write, edit).
You do NOT use MCP tools for creating files -- you write them yourself.
MCP tools are only for robustness-critical operations that agents tend to get wrong:
`anyclaw_deploy`, `anyclaw_rollback`, `anyclaw_snapshot_db`, `anyclaw_ask_user`,
`anyclaw_update_progress`, and `anyclaw_create_collection`.

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

Do NOT ask more than 3 questions in a single round. If you need more information,
prioritize the questions that most affect the architecture. You can ask follow-ups
in a second round if needed.

If the request is clear enough to build without ambiguity, skip to Step 2.
Do not ask questions just to appear thorough.

## Step 2: Plan the Feature

Before writing any code, create a concrete plan. Determine which of these
components are needed:

- **Collections (DB tables):** What data needs to be stored? Define collection names,
  field names, field types, and any relations. Use PocketBase collection conventions:
  - Collection names: lowercase, plural, snake_case (e.g., `mood_entries`, `news_sources`)
  - Field types: text, number, bool, email, url, date, select, relation, file, json
  - Always include a `user` relation field if the data is user-specific
  - Always think about what fields you will need for the UI -- avoid extra round trips

- **API routes (Node.js):** Only needed if the feature requires:
  - Complex queries that span multiple collections
  - External API calls (fetching data from the web)
  - LLM processing (summarization, classification, generation)
  - Custom business logic beyond CRUD
  If the feature is pure CRUD, skip this -- the frontend talks to PocketBase directly.

- **Background jobs:** Only needed if the feature requires:
  - Scheduled data fetching (news, weather, prices)
  - Periodic processing (daily summaries, weekly reports)
  - Timed notifications
  Define the job name, cron schedule, and what it does.

- **Pages and components:** What UI screens are needed? What components?
  - New page: needs a route in the router, a page component, navigation entry
  - Existing page modification: identify which page and what changes
  - Shared components: identify reusable pieces (cards, charts, forms)

- **Navigation:** Where does this feature appear in the app's navigation?

Post your plan to the user via `anyclaw_update_progress`:
"Planning: [feature name] will need [N] new database collections, [N] API routes,
[N] pages, and [N] background jobs. Building now."

## Step 3: Implement -- Database Layer

Create collections first because everything else depends on them.

For each collection:
1. Use `anyclaw_create_collection` with the full schema definition
2. Verify the collection was created by reading back its schema
3. If the collection has relations to existing collections, verify those exist

Order matters: create collections that others depend on first.

## Step 4: Implement -- Backend Layer

If API routes or background jobs are needed:

For API routes:
1. Create the route file directly in `packages/logic/src/routes/` using your file tools
2. Follow this pattern exactly:

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

3. Register the route in `packages/logic/src/index.ts` by importing and mounting it.

For background jobs:
1. Create the job file directly in `packages/logic/src/jobs/` using your file tools
2. Follow this pattern:

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

3. Register the job in `packages/logic/src/index.ts`.

Update progress: "Implementing backend for [feature name]..."

## Step 5: Implement -- Frontend Layer

Build the UI. Follow the anyclaw-style-guide skill for all CSS and component conventions.

For each new page:
1. Create the page component file in `packages/frontend/src/pages/` using your file tools
2. Add the route to the router configuration
3. Add the page to navigation

For components:
1. Create shared components in `packages/frontend/src/components/`
2. Create page-specific components alongside the page file

Data fetching pattern -- always use the PocketBase JS SDK for CRUD:

```typescript
import { pb } from "../lib/pocketbase";

// List records
const records = await pb.collection("mood_entries").getList(1, 50, {
  sort: "-created",
});

// Create record
await pb.collection("mood_entries").create({
  mood: "happy",
  energy: 8,
  notes: "Good day",
});

// Real-time subscription
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

Run the validation suite in the dev environment:

1. Use `anyclaw_run_command` to execute: `npm run lint`
   - Fix any lint errors before proceeding
2. Use `anyclaw_run_command` to execute: `npm run typecheck`
   - Fix any type errors before proceeding
3. Use `anyclaw_run_command` to execute: `npm run build`
   - Fix any build errors before proceeding
4. Use `anyclaw_run_command` to execute: `npm run test`
   - Fix any failing tests before proceeding

If you created new API routes, manually test them:
- Use `anyclaw_run_command` to curl the endpoints and verify responses

If you modified existing features, verify they still work:
- Check that existing pages still render (no import errors)
- Check that existing API routes still respond correctly

Do NOT proceed to deployment if any validation step fails.
Iterate until everything passes. If you are stuck after 3 attempts on the
same error, use `anyclaw_ask_user` to explain the situation and ask for guidance.

## Step 7: Write Version Description

Follow the anyclaw-describe-version skill to write a clear, non-technical
description of what changed. This description will appear in the user's
version history screen.

## Step 8: Deploy

Use `anyclaw_deploy` with your version description.

The deploy tool will:
1. Run the full validation suite one more time
2. Snapshot the database (if schema changed)
3. Commit to git with the version description
4. Promote build artifacts to prod
5. Trigger a WebView reload on the mobile app

If deployment fails, read the error message carefully. The most common causes:
- Lint or type errors introduced after your last check (fix and retry)
- Build errors from missing imports (check your imports and retry)
- Smoke test failures from broken existing features (investigate the regression)

Update progress: "Deployed! [feature name] is live."

## Rules

- NEVER edit files in the `prod/` directory directly. All changes go through dev.
- NEVER modify PocketBase's internal files. Use the admin API via MCP tools only.
- NEVER deploy without passing all validation steps.
- NEVER delete existing collections unless the user explicitly asks to remove a feature.
- ALWAYS snapshot the database before schema migrations (the deploy tool does this
  automatically, but if you are doing manual testing with schema changes, snapshot first).
- ALWAYS post progress updates so the user knows what is happening.
- If a feature request would require installing new npm packages, use
  `anyclaw_run_command` to run `npm install <package>` in the appropriate workspace.
  Prefer well-known, maintained packages. Avoid packages with fewer than 1000
  weekly downloads unless there is no alternative.
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
CSS-first configuration -- theme tokens are defined in `packages/frontend/src/app.css`
using `@theme`, not in a JS/TS config file. Do not use:
- Inline style objects (`style={{ }}`)
- CSS Modules
- Styled-components or CSS-in-JS libraries
- Separate .css files (except for the main `app.css` with Tailwind's `@theme` block)
- A `tailwind.config.ts` file (Tailwind v4 does not use one)

Tailwind is already configured in the project. Use utility classes directly
on JSX elements.

## Color System

Use the following semantic color tokens defined in `packages/frontend/src/app.css`
via `@theme`.
NEVER use raw color values (no `bg-blue-500`). Always use semantic names:

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
palette with a single accent color. The user can retheme by changing
the config -- your job is to use the tokens so theming works.

## Typography

- Page titles: `text-2xl font-semibold text-foreground`
- Section headings: `text-lg font-medium text-foreground`
- Body text: `text-base text-foreground`
- Secondary/caption text: `text-sm text-muted`
- Small labels: `text-xs text-muted`

Do not use `font-bold` except for emphasis within body text.
Use `font-semibold` for headings and `font-medium` for sub-headings.

## Spacing

Use Tailwind's spacing scale consistently:
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
Primary action:
```tsx
<button className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium
  hover:opacity-90 active:opacity-80 transition-opacity">
  Button Text
</button>
```

Secondary action:
```tsx
<button className="bg-surface border border-default rounded-lg px-4 py-2 text-sm
  font-medium text-foreground hover:bg-background active:opacity-80 transition-colors">
  Button Text
</button>
```

Danger action:
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
When a list or page has no data yet:
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

This app runs in a mobile WebView. Design mobile-first.

- **Default (no prefix):** Mobile phone (320px-480px). This is the PRIMARY target.
- **`sm:` (640px+):** Large phone / small tablet
- **`md:` (768px+):** Tablet
- **`lg:` (1024px+):** Desktop (rare -- only for users accessing via browser)

Rules:
- All layouts must work at 320px width. No horizontal scrolling ever.
- Use single-column layouts by default. Only use `md:grid-cols-2` or wider for tablet+.
- Touch targets must be at least 44px tall. Use `min-h-[44px]` on interactive elements.
- Font sizes must be at least `text-sm` (14px). Never use `text-xs` for interactive labels.

## Component File Organization

```
packages/frontend/src/
  components/           # Shared components used across multiple pages
    Layout.tsx          # Base layout shell (nav, content area)
    Card.tsx            # Reusable card wrapper
    Button.tsx          # Button component (if patterns diverge enough to warrant it)
    EmptyState.tsx      # Generic empty state
    LoadingSpinner.tsx  # Generic loading indicator
  pages/
    Home.tsx            # Landing/dashboard page
    mood/
      MoodPage.tsx      # Main mood tracker page
      MoodEntryForm.tsx # Mood entry form (page-specific component)
      MoodChart.tsx     # Mood chart (page-specific component)
    news/
      NewsPage.tsx      # News page
      NewsCard.tsx      # Individual news card (page-specific)
```

Rules:
- Shared components go in `components/`. A component is "shared" if 2+ pages use it.
- Page-specific components go in a folder alongside the page, named after the feature.
- One component per file. File name matches component name in PascalCase.
- Pages are default exports. Shared components are named exports.

## Component Naming

- Pages: `[Feature]Page.tsx` (e.g., `MoodPage.tsx`, `NewsPage.tsx`)
- Feature-specific components: `[Feature][Thing].tsx` (e.g., `MoodChart.tsx`, `NewsCard.tsx`)
- Shared components: `[Thing].tsx` (e.g., `Card.tsx`, `Button.tsx`, `EmptyState.tsx`)
- No `index.tsx` barrel files. Import components by their direct file name.

## State Management

- Use React's built-in `useState` and `useEffect` for local state.
- Use PocketBase's real-time subscriptions for live data (not polling).
- For state shared across multiple pages, use React Context. Create contexts in
  `packages/frontend/src/contexts/[Feature]Context.tsx`.
- Do NOT install Redux, Zustand, Jotai, or other state libraries unless the
  user explicitly requests it. React Context + PocketBase subscriptions cover
  virtually all cases for a single-user app.

## Data Fetching

- Use `useEffect` + `useState` for initial data loads.
- Create custom hooks in `packages/frontend/src/hooks/` for reusable data patterns:
  - `useCollection(name, options)` -- generic hook for fetching a PocketBase collection
  - Feature-specific hooks: `useMoodEntries()`, `useNewsSources()`, etc.
- Always handle loading, error, and empty states. Never render a blank screen.
- Show a loading spinner while fetching. Show an empty state message if no data.
  Show an error message with a retry button if the fetch fails.

## Accessibility

- All images must have `alt` text.
- All form inputs must have associated `<label>` elements or `aria-label`.
- Use semantic HTML: `<main>`, `<nav>`, `<section>`, `<article>`, `<button>` (not div-as-button).
- Color alone must never convey information. Pair color with text or icons.
- Focus states are handled by Tailwind's `focus:ring-2 focus:ring-primary/50`.

## Icons

Use `lucide-react` for all icons. It is already installed. Import icons by name:

```tsx
import { Plus, Trash2, Settings, ChevronRight } from "lucide-react";

<Plus className="h-5 w-5" />
```

Do not install other icon libraries.

## Do NOT

- Do not use `any` type. Type everything properly.
- Do not use `// @ts-ignore` or `// @ts-expect-error`.
- Do not use `!important` in class names.
- Do not hardcode colors (no `text-[#ff0000]` or `bg-blue-500`).
- Do not create components with more than 200 lines. Split them.
- Do not use `dangerouslySetInnerHTML` unless rendering sanitized markdown.
- Do not add animations beyond simple transitions (`transition-opacity`,
  `transition-colors`). No spring physics, no page transitions, no parallax.
  Keep it fast and clean.
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
- Three or more pages contain duplicated JSX patterns (same structure, different data)
- A single page file imports more than 10 modules
- The same PocketBase query pattern appears in 3+ files
- The `packages/logic/src/routes/` directory has more than 15 route files
- A background job file exceeds 100 lines
- After every 5th deployment (tracked in version metadata)

The agent can also invoke this skill proactively during a build-feature task
if it notices code smells while implementing.

## What to Look For

### 1. Component Extraction
Scan all page files for repeated JSX patterns. If the same card layout, list item
structure, or form pattern appears in 2+ pages, extract it into a shared component
in `packages/frontend/src/components/`.

Procedure:
1. Identify the repeated pattern
2. Determine which parts vary between uses (these become props)
3. Create the shared component with typed props
4. Replace all instances with the shared component
5. Run typecheck and build to verify nothing broke

### 2. Custom Hook Extraction
Scan for repeated data-fetching patterns. If 2+ components fetch from the same
collection with similar options, extract a custom hook.

Procedure:
1. Identify the repeated fetch pattern
2. Create a hook in `packages/frontend/src/hooks/`
3. The hook should handle loading, error, and data states
4. Replace all instances with the hook
5. Run typecheck and build to verify

### 3. Dead Code Removal
Scan for:
- Unused imports (eslint will catch most of these)
- Components that are defined but never rendered
- API routes that no page or job calls
- Collections that no code reads from or writes to
- Background jobs that are registered but whose schedules are commented out

Procedure:
1. Identify the dead code
2. Verify it is truly unused by searching for all references
3. Remove it
4. Run full validation suite

### 4. File Organization
Check that the file organization rules from the style guide are followed:
- Shared components in `components/`
- Page-specific components in feature folders alongside pages
- No barrel `index.tsx` files
- One component per file

If files are misplaced, move them and update all imports.

### 5. Route Consolidation
If the logic service has many small route files that serve the same feature,
consolidate them into a single route file per feature:
- `routes/mood-trends.ts` + `routes/mood-export.ts` -> `routes/mood.ts`

### 6. Type Improvements
- Replace any `any` types with proper types
- Add missing return types to functions
- Create shared type definitions in `packages/frontend/src/types/` for data
  structures used across multiple files
- Ensure PocketBase collection types are defined once and reused

## Safety Rules

- NEVER refactor and add features in the same deployment. Refactoring is a
  separate deployment with its own version description.
- ALWAYS run the full validation suite after each refactoring change:
  lint, typecheck, build, tests.
- NEVER change behavior during a refactor. The app should work identically
  before and after. If you find a bug during refactoring, note it and fix it
  in a separate deployment.
- NEVER delete a PocketBase collection during refactoring. Collection removal
  is a feature change, not a refactor.
- Make small, incremental changes. Do not rewrite the entire codebase at once.
  Extract one component, verify, then move to the next.
- If a refactoring change causes test failures, revert it and move on.
  Do not spend more than 2 attempts fixing a single refactoring change.

## Version Description for Refactors

Use the format: "Housekeeping: [what you cleaned up]"
Examples:
- "Housekeeping: extracted shared Card and ListItem components"
- "Housekeeping: consolidated mood-related API routes into a single file"
- "Housekeeping: removed unused news import code and cleaned up types"
```

---

### Skill 4: anyclaw-describe-version

```markdown
# anyclaw-describe-version

You are writing a version description for a deployment of an AnyClaw personal web app.
This description appears in the user's version history screen on their mobile app.
The user is NOT a developer. Write for a normal person.

## Rules

1. Start with what the user can now DO, not what you coded.
2. Use plain language. No technical jargon.
3. One to three sentences. Never more.
4. If the feature has a visual component, describe what they will see.
5. If the feature has a background component (jobs, notifications), explain
   what will happen and when.
6. Do not mention file names, function names, components, collections,
   API routes, or database schemas.
7. Do not say "I" or "the agent." Describe what changed, not who changed it.
8. Use present tense ("You can now..." not "Added the ability to...").

## Format

[One-line summary of what is new or changed.]
[Optional: one line of additional detail if the feature has multiple parts.]
[Optional: one line about when/how a background feature activates.]

## Examples

### Good Examples

Feature: mood tracker with daily check-in and weekly chart
```
You can now track your mood, energy, and stress levels with a daily check-in.
A weekly chart shows your trends over time so you can spot patterns.
```

Feature: news aggregator with scheduled fetching
```
Your personalized news feed is ready. It pulls articles from your chosen
sources every 6 hours and highlights the ones most relevant to your interests.
```

Feature: simple to-do list
```
You now have a to-do list on your home page. Tap to add items, swipe to complete them.
```

Feature: bug fix -- chart not loading on slow connections
```
The weekly mood chart now loads reliably even on slower connections.
```

Feature: refactoring -- no user-visible changes
```
Housekeeping: cleaned up the code behind the scenes. Everything works the same,
just tidier under the hood.
```

Feature: added push notifications for daily reminder
```
You will now get a reminder notification at 9pm each day to log your mood.
You can change the time or turn this off in Settings.
```

### Bad Examples (Do NOT write like this)

```
Added MoodEntry collection with fields for mood, energy, stress, and notes.
Created MoodPage component with MoodEntryForm and MoodChart sub-components.
Set up a cron job running every 6 hours to fetch RSS feeds.
```
This is developer output, not a version description.

```
Implemented new feature as requested.
```
This says nothing useful.

```
I've gone ahead and built you a really awesome mood tracking system that
lets you keep track of how you're feeling throughout the day with beautiful
charts and an intuitive interface that makes it super easy to log your entries!
```
Too long, too salesy, too informal.
```

---

### Skill 5: Skill Packaging

Skills are authored once and then packaged into three formats depending on the target agent platform.

#### 5a. Source Format

All skills are authored as Markdown files stored in the AnyClaw repository:

```
anyclaw-server/
  skills/
    anyclaw-build-feature.md
    anyclaw-style-guide.md
    anyclaw-refactor.md
    anyclaw-describe-version.md
```

Each file contains the skill prompt exactly as the agent should receive it. No frontmatter, no metadata wrapper -- just the raw instructions in Markdown.

#### 5b. OpenClaw Packaging

OpenClaw loads skills from its skill directory. Each skill is installed as a file in the OpenClaw skills path (typically `~/.openclaw/skills/` or configured by the user).

Installation process (handled by the AnyClaw install script):

1. Detect OpenClaw's skill directory from its config file (`~/.openclaw/config.json`, field `skillsDir`)
2. Copy each `.md` file from `anyclaw-server/skills/` into the skill directory, prefixed with `anyclaw-`:
   - `~/.openclaw/skills/anyclaw-build-feature.md`
   - `~/.openclaw/skills/anyclaw-style-guide.md`
   - `~/.openclaw/skills/anyclaw-refactor.md`
   - `~/.openclaw/skills/anyclaw-describe-version.md`
3. OpenClaw automatically discovers skills by reading `.md` files from its skill directory

The skill content is used verbatim. OpenClaw's skill system passes the Markdown content as system prompt context when the skill is invoked.

#### 5c. Claude Code Packaging

Claude Code uses two mechanisms: `CLAUDE.md` project files and custom slash commands.

**CLAUDE.md integration:**

The install script appends a block to the project's `CLAUDE.md` (creating it if absent):

```markdown
## AnyClaw Agent Instructions

You are building features for an AnyClaw personal web app. When working on this
project, follow these rules:

1. For all feature work, follow the workflow in `/anyclaw-build-feature`
2. For all frontend code, follow the conventions in `/anyclaw-style-guide`
3. After every 5 deployments, run `/anyclaw-refactor`
4. When writing version descriptions, follow `/anyclaw-describe-version`

Write code directly using your built-in file tools (read, write, edit).
Use AnyClaw MCP tools only for robustness-critical operations:
`anyclaw_deploy`, `anyclaw_rollback`, `anyclaw_snapshot_db`,
`anyclaw_create_collection`, `anyclaw_ask_user`, `anyclaw_update_progress`.
Do not manually edit PocketBase files or the prod/ directory.
```

**Slash commands:**

Each skill is installed as a Claude Code slash command by placing files in `.claude/commands/`:

```
anyclaw-server/
  .claude/
    commands/
      anyclaw-build-feature.md
      anyclaw-style-guide.md
      anyclaw-refactor.md
      anyclaw-describe-version.md
```

Claude Code automatically registers files in `.claude/commands/` as `/command-name` slash commands. The file content becomes the command's prompt.

The install script copies the skill files from `anyclaw-server/skills/` to `.claude/commands/`. The content is identical -- Claude Code slash commands use the same raw Markdown format.

#### 5d. Generic Agent Packaging (System Prompts)

For agents that do not support MCP skills or slash commands (Codex, Aider, custom harnesses), skills are concatenated into a single system prompt template.

The install script generates `anyclaw-server/skills/system-prompt.txt`:

```
You are a coding agent working on an AnyClaw personal web app. Follow these
instructions for all work on this project.

=== BUILD FEATURE WORKFLOW ===
[contents of anyclaw-build-feature.md]

=== STYLE GUIDE ===
[contents of anyclaw-style-guide.md]

=== REFACTOR GUIDELINES ===
[contents of anyclaw-refactor.md]

=== VERSION DESCRIPTIONS ===
[contents of anyclaw-describe-version.md]
```

This file is passed as the system prompt (or prepended to the first user message) by the agent adapter when dispatching tasks. The generic webhook adapter includes a `systemPrompt` field in its dispatch payload.

#### 5e. Skill Versioning and Compatibility

Skills are versioned independently from the AnyClaw server. This allows faster iteration on agent prompts without requiring a full server update. The server enforces compatibility at task dispatch time.

**Version format:** Each skill declares a version and a minimum compatible server version in a YAML frontmatter block at the top of the file:

```yaml
---
skill_version: "1.3.0"
min_server_version: "0.5.0"
---
# anyclaw-build-feature
...
```

The frontmatter is stripped before the skill content is passed to the agent. It is only read by the AnyClaw system.

**Server version:** The AnyClaw server exposes its version via `GET /api/version` on the control plane (port 3004). The response includes:

```json
{
  "server_version": "0.7.2",
  "min_skill_version": "1.0.0"
}
```

**Compatibility check flow:**

1. At task dispatch time, the control plane reads the skill file that will be used (e.g., `anyclaw-build-feature.md`).
2. It parses the frontmatter to extract `skill_version` and `min_server_version`.
3. It compares `min_server_version` against the running server version using semver. If the server is too old, the task is rejected with an error: "Skill anyclaw-build-feature v1.3.0 requires server >= 0.5.0, but server is 0.4.1. Please update AnyClaw."
4. It also compares `skill_version` against the server's `min_skill_version`. If the skill is too old, the task is rejected: "Skill anyclaw-build-feature v0.9.0 is outdated. Server requires skill >= 1.0.0. Please update skills."
5. If both checks pass, the skill content (without frontmatter) is passed to the agent.

**Update mechanism:**

- Skills are distributed as files in the AnyClaw release package. Running the install script (or `docker compose pull` for updates) fetches new skill files alongside server images.
- The packaging script (`package-skills.sh`) preserves frontmatter during copying so that the version metadata is available at the destination.
- Users are notified of skill updates via the mobile app settings screen ("Skills update available") but the update is applied automatically on the next `docker compose pull` / install script run.

#### 5f. Packaging Script

A script at `anyclaw-server/scripts/package-skills.sh` handles all three formats:

```bash
#!/usr/bin/env bash
# Packages skills for all agent platforms.
# Run during install or after editing skill files.

SKILLS_DIR="$(dirname "$0")/../skills"
CLAUDE_COMMANDS_DIR="$(dirname "$0")/../.claude/commands"

# 1. Claude Code: copy to .claude/commands/
mkdir -p "$CLAUDE_COMMANDS_DIR"
for skill in "$SKILLS_DIR"/anyclaw-*.md; do
  cp "$skill" "$CLAUDE_COMMANDS_DIR/$(basename "$skill")"
done

# 2. Generic: concatenate into system-prompt.txt
{
  echo "You are a coding agent working on an AnyClaw personal web app."
  echo "Follow these instructions for all work on this project."
  echo ""
  for skill in "$SKILLS_DIR"/anyclaw-*.md; do
    name=$(basename "$skill" .md | tr '[:lower:]' '[:upper:]' | tr '-' ' ')
    echo "=== $name ==="
    cat "$skill"
    echo ""
    echo ""
  done
} > "$SKILLS_DIR/system-prompt.txt"

# 3. OpenClaw: copy to skill directory (if OpenClaw is installed)
if [ -f "$HOME/.openclaw/config.json" ]; then
  OC_SKILLS=$(python3 -c "import json; print(json.load(open('$HOME/.openclaw/config.json')).get('skillsDir', '$HOME/.openclaw/skills'))" 2>/dev/null)
  if [ -n "$OC_SKILLS" ]; then
    mkdir -p "$OC_SKILLS"
    for skill in "$SKILLS_DIR"/anyclaw-*.md; do
      cp "$skill" "$OC_SKILLS/$(basename "$skill")"
    done
  fi
fi

echo "Skills packaged for all platforms."
```

---

## Part B: Deployment

---

### 6. Docker Compose

The self-hosted deployment runs as a single `docker compose` stack with three containers, matching the locked architecture decision. All services share a Docker network and communicate via internal hostnames.

**Three-container architecture:**

1. **App server** -- serves the agent-built frontend + PocketBase + Node.js logic service to the mobile WebView. Can be restarted/stopped by the user or agent without losing access to the control plane.
2. **Control plane** -- health checks, restart API for the app server, agent task dispatch API, MCP server, tunnel client. Always available, even if the app server is down. The user can always reach their agent.
3. **Sandbox** -- isolated command execution environment for the coding agent. Runs build commands, linting, tests, npm install, etc. with a blocklist. Isolated so runaway commands cannot affect the app server or control plane.

```yaml
# docker-compose.yml

services:
  # -------------------------------------------------------
  # Container 1: App Server
  # Serves the agent-built frontend + PocketBase + logic service.
  # Restartable by user or agent without losing control plane access.
  # -------------------------------------------------------
  app:
    image: ghcr.io/anyclaw/app-server:latest
    container_name: anyclaw-app
    restart: unless-stopped
    ports:
      - "8090:8090"   # PocketBase
      - "3001:3001"   # Node.js logic service
      - "5173:5173"   # Frontend (prod static server)
    volumes:
      - pb_data:/app/pb_data
      - pb_migrations:/app/pb_migrations
      - logic_data:/app/logic_data
      - prod_workspace:/app/prod
      - dev_workspace:/app/dev
      - git_repo:/app/repo
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8090/api/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 15s
    environment:
      - POCKETBASE_URL=http://localhost:8090
      - POCKETBASE_API_TOKEN=${POCKETBASE_API_TOKEN}
      - NODE_ENV=production
      - SERVE_MODE=prod

  # -------------------------------------------------------
  # Container 2: Control Plane
  # Health checks, restart API, agent task dispatch, MCP server,
  # tunnel client. Always available -- never restarted by the agent.
  # -------------------------------------------------------
  control:
    image: ghcr.io/anyclaw/control-plane:latest
    container_name: anyclaw-control
    restart: unless-stopped
    ports:
      - "3002:3002"   # MCP server (HTTP/SSE)
      - "3003:3003"   # Tunnel client
      - "3004:3004"   # Control plane API (health, restart, dispatch)
    volumes:
      - dev_workspace:/app/dev
      - prod_workspace:/app/prod
      - git_repo:/app/repo
      - pb_data:/app/pb_data:ro
      - snapshots:/app/snapshots
    depends_on:
      app:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3004/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 10s
    environment:
      - POCKETBASE_URL=http://app:8090
      - POCKETBASE_API_TOKEN=${POCKETBASE_API_TOKEN}
      - APP_CONTAINER_NAME=anyclaw-app
      - LOGIC_URL=http://app:3001
      - FRONTEND_URL=http://app:5173
      - DEV_WORKSPACE=/app/dev
      - PROD_WORKSPACE=/app/prod
      - GIT_REPO=/app/repo
      - SNAPSHOTS_DIR=/app/snapshots
      - BROKER_URL=${BROKER_URL:-https://broker.anyclawapp.com}
      - ANYCLAW_USER_TOKEN=${ANYCLAW_USER_TOKEN}
      - DOCKER_HOST=unix:///var/run/docker.sock
    # Docker socket access for restarting the app container
    # and dispatching commands to the sandbox container
    volumes_extra:
      - /var/run/docker.sock:/var/run/docker.sock:ro

  # -------------------------------------------------------
  # Container 3: Sandbox
  # Isolated command execution for the coding agent.
  # Blocklist prevents dangerous commands. Resource-limited.
  # -------------------------------------------------------
  sandbox:
    image: ghcr.io/anyclaw/sandbox:latest
    container_name: anyclaw-sandbox
    restart: unless-stopped
    volumes:
      - dev_workspace:/app/dev
      - git_repo:/app/repo
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3005/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 10s
    ports:
      - "3005:3005"   # Sandbox command API (internal only)
    environment:
      - DEV_WORKSPACE=/app/dev
      - GIT_REPO=/app/repo
      - COMMAND_BLOCKLIST=rm -rf /,mkfs,dd,shutdown,reboot,systemctl,docker,mount
      - COMMAND_TIMEOUT_SECONDS=300
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 1G
    # No network access to PocketBase or external services
    # Only the dev workspace and git repo are mounted
    networks:
      - sandbox_net

networks:
  default:
    name: anyclaw-net
  sandbox_net:
    name: anyclaw-sandbox-net
    internal: true  # No external network access from sandbox

volumes:
  pb_data:
    driver: local
  pb_migrations:
    driver: local
  logic_data:
    driver: local
  dev_workspace:
    driver: local
  prod_workspace:
    driver: local
  git_repo:
    driver: local
  snapshots:
    driver: local
```

**Container summary:**

| Container | Ports | Purpose | Restartable by agent? |
|-----------|-------|---------|-----------------------|
| `app` | 8090, 3001, 5173 | PocketBase + Node.js logic + frontend static server | Yes (via control plane restart API) |
| `control` | 3002, 3003, 3004 | MCP server, tunnel client, health checks, restart API, agent task dispatch | No (always available) |
| `sandbox` | 3005 | Command execution (lint, typecheck, build, tests, npm install) with blocklist | No (managed by control plane) |

**Volume purposes:**

| Volume | Shared By | Purpose |
|--------|-----------|---------|
| `pb_data` | app, control (read-only) | PocketBase data directory (SQLite DB, uploaded files) |
| `pb_migrations` | app | PocketBase migration files |
| `dev_workspace` | app, control, sandbox | The agent's working copy of frontend + logic source |
| `prod_workspace` | app, control | Production build artifacts |
| `git_repo` | app, control, sandbox | Git repository for version tracking |
| `snapshots` | control | SQLite DB snapshots for rollback |
| `logic_data` | app | Persistent data for background jobs (caches, state files) |

**How `anyclaw_run_command` works:** The MCP server (in the control plane) dispatches commands to the sandbox container via its API on port 3005. The sandbox executes the command in the dev workspace, applies the blocklist, enforces resource limits, and streams stdout/stderr back. The sandbox has no access to PocketBase, no access to the external network, and cannot affect the app server or control plane.

---

### 7. Install Script

The standalone install script is a single shell command that bootstraps everything from a fresh machine.

**Invocation:**
```bash
curl -fsSL https://get.anyclaw.com | bash
```

Or for users who do not want to pipe to bash:
```bash
wget https://get.anyclaw.com/install.sh
chmod +x install.sh
./install.sh
```

**What the script does, in order:**

```bash
#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# AnyClaw Standalone Installer
# ============================================================

ANYCLAW_VERSION="${ANYCLAW_VERSION:-latest}"
INSTALL_DIR="${ANYCLAW_DIR:-$HOME/.anyclaw}"

echo "=== AnyClaw Installer ==="
echo ""

# ----------------------------------------------------------
# Phase 1: Prerequisites Check
# ----------------------------------------------------------

echo "[1/7] Checking prerequisites..."

# Check OS (Linux or macOS; WSL for Windows users)
OS="$(uname -s)"
case "$OS" in
  Linux|Darwin) ;;
  *) echo "Error: Unsupported OS ($OS). AnyClaw requires Linux, macOS, or WSL."; exit 1 ;;
esac

# Check architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Error: Unsupported architecture ($ARCH)."; exit 1 ;;
esac

# Check minimum RAM (2GB)
if [ "$OS" = "Linux" ]; then
  MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
  if [ "$MEM_KB" -lt 2000000 ]; then
    echo "Warning: Less than 2GB RAM detected. AnyClaw may run slowly."
  fi
fi

# Check disk space (at least 5GB free)
FREE_KB=$(df "$HOME" | tail -1 | awk '{print $4}')
if [ "$FREE_KB" -lt 5000000 ]; then
  echo "Warning: Less than 5GB free disk space. AnyClaw needs ~3GB."
fi

# ----------------------------------------------------------
# Phase 2: Install Docker (if not present)
# ----------------------------------------------------------

echo "[2/7] Checking Docker..."

if ! command -v docker &>/dev/null; then
  echo "Docker not found. Installing Docker..."
  if [ "$OS" = "Linux" ]; then
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    echo "Docker installed. You may need to log out and back in for group changes."
  elif [ "$OS" = "Darwin" ]; then
    echo "Error: Please install Docker Desktop for Mac from https://docker.com/products/docker-desktop"
    echo "Then re-run this installer."
    exit 1
  fi
fi

# Verify Docker is running
if ! docker info &>/dev/null; then
  echo "Error: Docker is installed but not running. Please start Docker and re-run."
  exit 1
fi

# Check docker compose (v2 plugin)
if ! docker compose version &>/dev/null; then
  echo "Error: docker compose (v2) not found. Please update Docker."
  exit 1
fi

# ----------------------------------------------------------
# Phase 3: Create Directory Structure
# ----------------------------------------------------------

echo "[3/7] Setting up AnyClaw directory..."

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Download docker-compose.yml and .env.template
curl -fsSL "https://releases.anyclaw.com/$ANYCLAW_VERSION/docker-compose.yml" \
  -o docker-compose.yml
curl -fsSL "https://releases.anyclaw.com/$ANYCLAW_VERSION/env.template" \
  -o .env.template

# ----------------------------------------------------------
# Phase 4: Configure Environment
# ----------------------------------------------------------

echo "[4/7] Configuring AnyClaw..."

if [ ! -f .env ]; then
  cp .env.template .env

  # Generate a PocketBase API token for programmatic access (not email/password)
  PB_API_TOKEN=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 40)

  sed -i.bak "s|POCKETBASE_API_TOKEN=.*|POCKETBASE_API_TOKEN=$PB_API_TOKEN|" .env
  rm -f .env.bak

  echo ""
  echo "  PocketBase API Token (saved in $INSTALL_DIR/.env):"
  echo "    Token: $PB_API_TOKEN"
  echo ""

  # Collect LLM API key -- will be stored encrypted in PocketBase after boot
  echo "AnyClaw needs an LLM API key for AI-powered features."
  echo "Supported providers: anthropic, openai"
  read -rp "LLM provider (anthropic/openai) [anthropic]: " LLM_PROVIDER
  LLM_PROVIDER="${LLM_PROVIDER:-anthropic}"

  read -rp "API key for $LLM_PROVIDER: " LLM_API_KEY

  # API keys are NOT stored in .env. They will be written to PocketBase
  # (encrypted at rest) after the services start. Store temporarily for
  # the bootstrap phase only.
  BOOTSTRAP_LLM_PROVIDER="$LLM_PROVIDER"
  BOOTSTRAP_LLM_KEY="$LLM_API_KEY"
else
  echo "Existing .env found, keeping current configuration."
  BOOTSTRAP_LLM_PROVIDER=""
  BOOTSTRAP_LLM_KEY=""
fi

# ----------------------------------------------------------
# Phase 5: Pull Images and Start Services
# ----------------------------------------------------------

echo "[5/7] Pulling Docker images..."
docker compose pull

echo "[6/7] Starting AnyClaw..."
docker compose up -d

# Wait for all services to be healthy
echo "Waiting for services to start..."
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  HEALTHY=$(docker compose ps --format json | grep -c '"healthy"' || true)
  TOTAL=$(docker compose ps --format json | wc -l)
  if [ "$HEALTHY" -ge "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
    break
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo "Warning: Some services did not become healthy within ${TIMEOUT}s."
  echo "Run 'docker compose -f $INSTALL_DIR/docker-compose.yml logs' to debug."
fi

# ----------------------------------------------------------
# Phase 5b: Store API Keys in PocketBase (encrypted)
# ----------------------------------------------------------

# API keys are stored encrypted in PocketBase, not in .env files.
# The PocketBase `api_keys` collection uses an encrypted JSON field.
# The control plane reads keys from PocketBase at runtime.

if [ -n "$BOOTSTRAP_LLM_KEY" ]; then
  echo "Storing API key in PocketBase (encrypted)..."
  PB_URL="http://localhost:8090"

  # Wait for PocketBase to be ready
  for i in $(seq 1 10); do
    if wget -q --spider "$PB_URL/api/health" 2>/dev/null; then break; fi
    sleep 1
  done

  # Use the API token to authenticate and store the key
  curl -s -X POST "$PB_URL/api/collections/api_keys/records" \
    -H "Authorization: Bearer $PB_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"provider\": \"$BOOTSTRAP_LLM_PROVIDER\",
      \"key\": \"$BOOTSTRAP_LLM_KEY\",
      \"active\": true
    }" > /dev/null

  echo "API key stored. You can manage keys from the mobile app Settings screen."
  # Clear the key from shell memory
  unset BOOTSTRAP_LLM_KEY
else
  if [ -z "$BOOTSTRAP_LLM_PROVIDER" ]; then
    echo "No new API key to store."
  else
    echo "Warning: No API key provided. Add one later via the mobile app Settings screen."
  fi
fi

# ----------------------------------------------------------
# Phase 6: Agent Configuration
# ----------------------------------------------------------

echo "[7/7] Configuring agent..."

# Detect which agent is available
AGENT=""
if command -v openclaw &>/dev/null; then
  AGENT="openclaw"
elif command -v claude &>/dev/null; then
  AGENT="claude-code"
fi

if [ "$AGENT" = "openclaw" ]; then
  echo "Detected OpenClaw. Installing AnyClaw skills..."
  # Run skill packaging for OpenClaw
  docker compose exec mcp /app/scripts/package-skills.sh
  echo "Skills installed. AnyClaw MCP server is available at localhost:3002."

elif [ "$AGENT" = "claude-code" ]; then
  echo "Detected Claude Code. Installing AnyClaw skills..."
  # Copy skills to .claude/commands in the workspace
  docker compose exec mcp /app/scripts/package-skills.sh
  echo "Skills installed as slash commands."
  echo "Add this to your Claude Code MCP config:"
  echo ""
  echo "  {"
  echo "    \"mcpServers\": {"
  echo "      \"anyclaw\": {"
  echo "        \"url\": \"http://localhost:3002/mcp\""
  echo "      }"
  echo "    }"
  echo "  }"

else
  echo "No recognized agent found (OpenClaw or Claude Code)."
  echo "You can connect any MCP-compatible agent to: http://localhost:3002/mcp"
  echo "System prompt template available at: $INSTALL_DIR/skills/system-prompt.txt"
fi

# ----------------------------------------------------------
# Done
# ----------------------------------------------------------

echo ""
echo "=== AnyClaw is running ==="
echo ""
echo "  Frontend:   http://localhost:5173"
echo "  PocketBase:  http://localhost:8090/_/"
echo "  MCP Server:  http://localhost:3002"
echo "  Tunnel:      Connecting to broker..."
echo ""
echo "  Install dir: $INSTALL_DIR"
echo "  Config:      $INSTALL_DIR/.env"
echo "  Logs:        docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
echo "  Stop:        docker compose -f $INSTALL_DIR/docker-compose.yml down"
echo "  Update:      curl -fsSL https://get.anyclaw.com | bash"
echo ""
echo "Open the AnyClaw mobile app and sign in to connect."
```

---

### 8. Cloud-Hosted Setup

#### Phase 1: Single VPS with Docker Compose

Start simple. A single VPS runs Docker Compose for all cloud-hosted users, with user isolation via separate compose projects. This VPS also hosts OpenClaw alongside AnyClaw.

**Why VPS first:**
- Cheapest to start -- a single $20-40/month VPS handles the first 10-20 users
- Same Docker Compose setup as self-hosted, so the deployment is battle-tested
- OpenClaw can run on the same VPS as a sibling Docker Compose project
- No new infrastructure to learn (no Fly.io API, no Machines provisioning)
- Migrate to Fly.io later when user count justifies per-user container isolation

**VPS layout:**

```
VPS (e.g., Hetzner CX32 -- 4 vCPU, 8GB RAM, 80GB disk)
  ├── /opt/anyclaw/users/
  │     ├── user-abc123/
  │     │     ├── docker-compose.yml    (AnyClaw three-container stack)
  │     │     └── data/                 (PocketBase data, git repo, snapshots)
  │     ├── user-def456/
  │     │     ├── docker-compose.yml
  │     │     └── data/
  │     └── ...
  ├── /opt/openclaw/
  │     └── docker-compose.yml          (OpenClaw instance, shared by all users)
  └── /opt/anyclaw/provisioner/
        └── docker-compose.yml          (Provisioning service + broker)
```

Each user gets their own Docker Compose project with isolated volumes. Port allocation is dynamic -- the provisioner assigns unique host ports per user and configures the tunnel client to route through the broker.

**Co-hosting OpenClaw:** OpenClaw runs as a separate Docker Compose project on the same VPS. AnyClaw's agent adapter for OpenClaw connects to it via internal Docker networking. Cloud-hosted users who choose OpenClaw as their agent share this single OpenClaw instance (each user's requests are dispatched with their own API keys and isolated workspace context).

#### Phase 2: Migrate to Fly.io (future)

When user count exceeds what a single VPS can handle (estimated 20-50 users depending on usage patterns), migrate to Fly.io Machines for per-user container isolation.

**Migration path:**
- Each user's Docker Compose stack becomes a single Fly Machine running all three containers via `s6-overlay` process supervisor
- Fly Volumes replace local bind mounts for persistent data
- The provisioner becomes a Fly.io management API client
- Idle shutdown: machines stop after 30 minutes of inactivity, wake on mobile app connect (3-5s boot)
- OpenClaw moves to its own Fly Machine or stays on a dedicated VPS depending on scale

**Fly.io cost model (per user/month, estimated):**

| Resource | Cost |
|----------|------|
| Fly Machine (shared-cpu-1x, ~50% active time) | ~$1.50 |
| Fly Volume (3GB) | ~$0.45 |
| Bandwidth (5GB/month typical) | ~$0.00 |
| **Infrastructure total** | **~$2.00/user/month** |
| LLM tokens (bundled, ~$3-5 of usage) | ~$4.00 |
| **Total COGS** | **~$6.00/user/month** |

This supports a subscription price point of $12-15/month with healthy margins. BYOK users (who supply their own LLM API keys) drop COGS to ~$2/month.

---

### 9. Technical Decisions (Resolved)

All open questions from the original design have been resolved by the locked decisions in the main spec. Summary of resolutions:

| # | Original Question | Resolution |
|---|-------------------|------------|
| 1 | Tailwind v3 or v4? | **Tailwind v4** with CSS-first `@theme` config. No `tailwind.config.ts`. |
| 2 | MCP transport (stdio vs HTTP/SSE)? | **HTTP/SSE from the start.** Cloud-ready from day one. |
| 3 | Cloud hosting (Fly.io vs VPS)? | **Single VPS with Docker Compose first.** Migrate to Fly.io later. Co-host OpenClaw on same VPS. |
| 4 | Skill versioning? | **Independent with compatibility check.** Skills declare `min_server_version`, server declares `min_skill_version`. Semver comparison at dispatch time. |
| 5 | Dev workspace isolation? | **Dedicated sandbox container** with blocklist rules, resource limits (1 CPU, 1GB RAM), isolated network. Commands dispatched from control plane to sandbox via API. |

---

## New Gaps

The following new technical decisions emerged from applying the locked decisions above. These need resolution before implementation.

**1. PocketBase API token provisioning and rotation**

PocketBase API tokens (not email/password) are the locked auth mechanism. Open questions:
- How is the initial API token created? PocketBase does not natively support pre-seeded API tokens -- it requires an admin account to generate them. The install script may need to create an admin account first, generate a token via the API, then disable password-based admin login.
- How are tokens rotated? If a token is compromised, the user needs a way to regenerate it. This likely requires a control plane endpoint or a mobile app settings action.
- How many tokens are needed? The app server and control plane each need one. Should they share a token or have separate tokens with different scopes?

**2. API key encryption scheme in PocketBase**

API keys are stored encrypted in PocketBase (not env vars). Open questions:
- What encryption algorithm? AES-256-GCM is the obvious choice, but the encryption key itself needs to be stored somewhere. If it is in the .env file, we have merely moved the problem.
- Should the encryption key be derived from the PocketBase API token (so there is only one secret to protect)?
- How does the control plane decrypt keys at runtime? It needs the decryption key in memory. If the container restarts, it must be able to recover the key from a persistent source.
- PocketBase does not have built-in field-level encryption. This must be application-level encryption (encrypt before writing, decrypt after reading). The `api_keys` collection stores ciphertext, not plaintext.

**3. Sandbox container command API design**

The sandbox container exposes a command execution API on port 3005. Open questions:
- What is the API contract? Likely `POST /exec` with `{ command, workdir, timeout }` and streaming stdout/stderr response.
- How does the control plane authenticate to the sandbox? The sandbox is on an internal-only network, but should there still be a shared secret or is network isolation sufficient?
- How does the blocklist work? String matching on the command? Parsing the command into executable + args and checking against a list? What about commands invoked indirectly (e.g., `bash -c "rm -rf /"`)?
- Should the sandbox have internet access for `npm install`? Currently the sandbox is on an internal-only network (`sandbox_net: internal: true`), which blocks all external traffic. But `npm install` requires registry access. Options: (a) give the sandbox default network access too, (b) run an npm registry proxy on the control plane, (c) pre-install common packages in the sandbox image.

**4. Control plane Docker socket access**

The control plane needs Docker socket access to restart the app container and dispatch commands to the sandbox. Open questions:
- Is mounting `/var/run/docker.sock` acceptable for the security model? It gives the control plane root-equivalent access to the host.
- Should we use a more restricted approach like a Docker socket proxy (e.g., Tecnativa docker-socket-proxy) that only allows specific API calls (restart container, exec in container)?
- For cloud-hosted mode, Docker socket access works differently on Fly.io. This needs a separate mechanism (Fly Machines API) for the Phase 2 migration.

**5. Tailwind v4 `@theme` token definition**

The style guide references semantic color tokens but the exact `@theme` block content is not defined. Open questions:
- What is the exact CSS for the default theme in `app.css`? Tailwind v4 uses `@theme { --color-primary: ...; }` syntax.
- Should the agent be allowed to add new `@theme` tokens, or only use pre-defined ones? Adding tokens means editing `app.css`, which could break the theme if done incorrectly.
- How does dark mode work with Tailwind v4? The `@theme` block supports `@media (prefers-color-scheme: dark)` overrides, but the exact pattern needs to be specified in the style guide.

**6. VPS provisioner design for cloud-hosted mode**

The VPS-first cloud hosting model needs a provisioner service. Open questions:
- How does the provisioner allocate ports for each user's Docker Compose stack? Each user needs unique host ports for PocketBase, logic, frontend, etc. (or all traffic routes through the tunnel and no host ports are exposed).
- How does the provisioner manage per-user Docker Compose projects? It needs to template the `docker-compose.yml` per user, manage lifecycle (create, start, stop, destroy), and handle resource limits.
- What is the resource limit per user on the shared VPS? How many concurrent users can a 4 vCPU / 8GB RAM VPS support?
- How does OpenClaw share across cloud users? Each user dispatches tasks to a shared OpenClaw instance, but with their own API keys and workspace paths. The adapter needs to handle concurrent requests from multiple users safely.
