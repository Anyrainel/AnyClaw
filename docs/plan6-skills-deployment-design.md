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
and a Vite+React+TypeScript frontend. You have MCP tools to interact with all layers.

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
1. Use `anyclaw_write_file` to create the route file in `packages/logic/src/routes/`
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
1. Use `anyclaw_write_file` to create the job file in `packages/logic/src/jobs/`
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
1. Use `anyclaw_create_page` to scaffold the page with routing
2. Use `anyclaw_write_file` to implement the page component
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

1. Use `anyclaw_run_dev` to execute: `npm run lint`
   - Fix any lint errors before proceeding
2. Use `anyclaw_run_dev` to execute: `npm run typecheck`
   - Fix any type errors before proceeding
3. Use `anyclaw_run_dev` to execute: `npm run build`
   - Fix any build errors before proceeding
4. Use `anyclaw_run_dev` to execute: `npm run test`
   - Fix any failing tests before proceeding

If you created new API routes, manually test them:
- Use `anyclaw_run_dev` to curl the endpoints and verify responses

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
  `anyclaw_run_dev` to run `npm install <package>` in the appropriate workspace.
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

## CSS Approach: Tailwind CSS

Use Tailwind CSS utility classes for all styling. Do not use:
- Inline style objects (`style={{ }}`)
- CSS Modules
- Styled-components or CSS-in-JS libraries
- Separate .css files (except for Tailwind's base imports)

Tailwind is already configured in the project. Use utility classes directly
on JSX elements.

## Color System

Use the following semantic color tokens defined in `tailwind.config.ts`.
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

Use the AnyClaw MCP tools (anyclaw_create_page, anyclaw_create_collection,
anyclaw_deploy, etc.) for all infrastructure operations. Do not manually edit
PocketBase files or the prod/ directory.
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

#### 5e. Packaging Script

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

The self-hosted deployment runs as a single `docker compose` stack. All services share a Docker network and communicate via internal hostnames.

```yaml
# docker-compose.yml

version: "3.8"

services:
  pocketbase:
    image: ghcr.io/anyclaw/pocketbase:latest
    container_name: anyclaw-pocketbase
    restart: unless-stopped
    ports:
      - "8090:8090"
    volumes:
      - pb_data:/app/pb_data
      - pb_migrations:/app/pb_migrations
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8090/api/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 10s
    environment:
      - ANYCLAW_ADMIN_EMAIL=${ANYCLAW_ADMIN_EMAIL}
      - ANYCLAW_ADMIN_PASSWORD=${ANYCLAW_ADMIN_PASSWORD}

  logic:
    image: ghcr.io/anyclaw/logic:latest
    container_name: anyclaw-logic
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - logic_data:/app/data
      - dev_workspace:/app/dev
      - prod_workspace:/app/prod
      - git_repo:/app/repo
    depends_on:
      pocketbase:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3001/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 15s
    environment:
      - POCKETBASE_URL=http://pocketbase:8090
      - POCKETBASE_ADMIN_EMAIL=${ANYCLAW_ADMIN_EMAIL}
      - POCKETBASE_ADMIN_PASSWORD=${ANYCLAW_ADMIN_PASSWORD}
      - LLM_API_KEY=${LLM_API_KEY:-}
      - LLM_PROVIDER=${LLM_PROVIDER:-anthropic}
      - NODE_ENV=production

  frontend:
    image: ghcr.io/anyclaw/frontend:latest
    container_name: anyclaw-frontend
    restart: unless-stopped
    ports:
      - "5173:5173"
    volumes:
      - dev_workspace:/app/dev
      - prod_workspace:/app/prod
    depends_on:
      logic:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:5173/"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 10s
    environment:
      - VITE_POCKETBASE_URL=http://pocketbase:8090
      - VITE_LOGIC_URL=http://logic:3001
      - SERVE_MODE=prod

  mcp:
    image: ghcr.io/anyclaw/mcp-server:latest
    container_name: anyclaw-mcp
    restart: unless-stopped
    ports:
      - "3002:3002"
    volumes:
      - dev_workspace:/app/dev
      - prod_workspace:/app/prod
      - git_repo:/app/repo
      - pb_data:/app/pb_data
      - pb_migrations:/app/pb_migrations
      - snapshots:/app/snapshots
    depends_on:
      pocketbase:
        condition: service_healthy
      logic:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3002/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 10s
    environment:
      - POCKETBASE_URL=http://pocketbase:8090
      - POCKETBASE_ADMIN_EMAIL=${ANYCLAW_ADMIN_EMAIL}
      - POCKETBASE_ADMIN_PASSWORD=${ANYCLAW_ADMIN_PASSWORD}
      - LOGIC_URL=http://logic:3001
      - FRONTEND_URL=http://frontend:5173
      - DEV_WORKSPACE=/app/dev
      - PROD_WORKSPACE=/app/prod
      - GIT_REPO=/app/repo
      - SNAPSHOTS_DIR=/app/snapshots

  tunnel:
    image: ghcr.io/anyclaw/tunnel:latest
    container_name: anyclaw-tunnel
    restart: unless-stopped
    ports:
      - "3003:3003"
    depends_on:
      frontend:
        condition: service_healthy
      mcp:
        condition: service_healthy
    environment:
      - BROKER_URL=${BROKER_URL:-https://broker.anyclaw.com}
      - ANYCLAW_USER_TOKEN=${ANYCLAW_USER_TOKEN}
      - FRONTEND_URL=http://frontend:5173
      - POCKETBASE_URL=http://pocketbase:8090
      - MCP_URL=http://mcp:3002

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

**Service summary:**

| Service | Port | Purpose |
|---------|------|---------|
| `pocketbase` | 8090 | Database, auth, file storage, real-time subscriptions |
| `logic` | 3001 | Node.js logic service (custom API routes, background jobs, LLM calls) |
| `frontend` | 5173 | Vite dev server (dev mode) or static file server (prod mode) |
| `mcp` | 3002 | MCP server exposing AnyClaw tools to the coding agent |
| `tunnel` | 3003 | Tunnel client connecting to the connection broker for mobile access |

**Volume purposes:**

| Volume | Shared By | Purpose |
|--------|-----------|---------|
| `pb_data` | pocketbase, mcp | PocketBase data directory (SQLite DB, uploaded files) |
| `pb_migrations` | pocketbase, mcp | PocketBase migration files (tracked in git) |
| `dev_workspace` | logic, frontend, mcp | The agent's working copy of frontend + logic source |
| `prod_workspace` | logic, frontend, mcp | Production build artifacts |
| `git_repo` | logic, mcp | Git repository for version tracking |
| `snapshots` | mcp | SQLite DB snapshots for rollback |
| `logic_data` | logic | Persistent data for background jobs (caches, state files) |

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

  # Generate PocketBase admin credentials
  ADMIN_EMAIL="admin@localhost"
  ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)

  sed -i.bak "s|ANYCLAW_ADMIN_EMAIL=.*|ANYCLAW_ADMIN_EMAIL=$ADMIN_EMAIL|" .env
  sed -i.bak "s|ANYCLAW_ADMIN_PASSWORD=.*|ANYCLAW_ADMIN_PASSWORD=$ADMIN_PASSWORD|" .env
  rm -f .env.bak

  echo ""
  echo "  PocketBase Admin Credentials (saved in $INSTALL_DIR/.env):"
  echo "    Email:    $ADMIN_EMAIL"
  echo "    Password: $ADMIN_PASSWORD"
  echo ""

  # Prompt for LLM API key
  echo "AnyClaw needs an LLM API key for AI-powered features."
  echo "Supported providers: anthropic, openai"
  read -rp "LLM provider (anthropic/openai) [anthropic]: " LLM_PROVIDER
  LLM_PROVIDER="${LLM_PROVIDER:-anthropic}"

  read -rp "API key for $LLM_PROVIDER: " LLM_API_KEY
  if [ -n "$LLM_API_KEY" ]; then
    sed -i.bak "s|LLM_PROVIDER=.*|LLM_PROVIDER=$LLM_PROVIDER|" .env
    sed -i.bak "s|LLM_API_KEY=.*|LLM_API_KEY=$LLM_API_KEY|" .env
    rm -f .env.bak
  else
    echo "Warning: No API key provided. LLM features will not work until configured."
    echo "Edit $INSTALL_DIR/.env to add your key later."
  fi
else
  echo "Existing .env found, keeping current configuration."
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

#### Architecture: Container-per-user on Fly.io

**Why Fly.io over Kubernetes/ECS:**
- Fly.io Machines are individual containers that can be started/stopped independently -- natural fit for per-user isolation
- No cluster management overhead (no node pools, no control plane costs)
- Built-in global anycast networking and automatic TLS
- Machines can be stopped when idle and started on-demand (cost savings)
- Simpler than ECS (no task definitions, no ALB config) and far simpler than Kubernetes
- Pricing is per-machine-second -- idle users cost near zero when machines are stopped

#### Per-User Container Model

Each subscriber gets a single Fly Machine running all AnyClaw services in a supervised process (using `supervisord` or `s6-overlay`). This is a deliberate choice: running PocketBase, the Node.js logic service, the Vite frontend, and the MCP server in a single container avoids the network complexity and cost of multi-container orchestration for what is fundamentally a single-user system.

**Container spec:**
- Base image: Debian slim with Node.js 20, Go (for PocketBase), and git
- CPU: 1 shared vCPU (scalable to 2 on demand)
- RAM: 512MB base (scalable to 1GB)
- Disk: 3GB persistent volume (Fly Volumes) per user for PocketBase data, git repo, and snapshots
- Region: auto-selected based on user's location at signup

**Process layout inside the container:**

```
supervisord
  ├── pocketbase (port 8090)
  ├── node logic-service (port 3001)
  ├── node frontend-server (port 5173, serving prod build as static files)
  ├── node mcp-server (port 3002)
  └── node tunnel-client (connects to broker)
```

Only the tunnel client has external connectivity. No ports are exposed directly. The mobile app reaches the container through the connection broker, same as self-hosted.

#### Provisioning Flow

When a new user subscribes:

1. **Signup:** User creates account on anyclaw.com (Stripe for payment, PocketBase on the control plane for user records)
2. **Provision API call:** The control plane calls the provisioning service, which:
   a. Creates a Fly Machine from the AnyClaw template image in the nearest region
   b. Attaches a new Fly Volume (3GB) to the machine
   c. Generates a unique PocketBase admin credential pair
   d. Stores the machine ID, region, and credentials in the control plane database
   e. Starts the machine
3. **Initialization:** On first boot, the container:
   a. Initializes PocketBase with admin credentials
   b. Initializes the git repository in the dev workspace
   c. Installs the default frontend scaffold (home page, layout, empty state)
   d. Runs a first deployment to populate prod
   e. Registers with the connection broker using the user's auth token
4. **Ready:** The provisioning service marks the user as active. The mobile app can now connect.

Total provisioning time target: under 60 seconds from payment confirmation to a working instance.

#### Lifecycle Management

- **Idle shutdown:** If a user's machine has no active connections (no mobile app connected, no agent task running) for 30 minutes, the machine is stopped. The Fly Volume persists. Stopped machines cost nothing.
- **Wake on connect:** When the mobile app tries to connect through the broker, the broker calls the provisioning API to start the machine. The machine boots in 3-5 seconds (process startup, not image pull -- the image is cached on the host).
- **Scaling up:** If an agent task is consuming heavy CPU (large build, many LLM calls), the machine can be temporarily scaled to 2 vCPU / 1GB RAM via Fly's machine update API. It scales back down after the task completes.
- **Backups:** Fly Volumes are snapshotted daily by Fly.io. Additionally, the PocketBase SQLite file is backed up to object storage (Fly Tigris or S3-compatible) every 24 hours as a disaster recovery measure.

#### Cost Model

| Resource | Cost (per user/month, estimated) |
|----------|----------------------------------|
| Fly Machine (shared-cpu-1x, ~50% active time) | ~$1.50 |
| Fly Volume (3GB) | ~$0.45 |
| Bandwidth (5GB/month typical) | ~$0.00 (included in free tier) |
| Object storage backups (100MB) | ~$0.01 |
| **Infrastructure total** | **~$2.00/user/month** |
| LLM tokens (bundled, ~$3-5 of usage) | ~$4.00 |
| **Total COGS** | **~$6.00/user/month** |

This supports a subscription price point of $12-15/month with healthy margins. BYOK users (who supply their own LLM API keys) drop COGS to ~$2/month.

---

### 9. Technical Decisions Needed

The following open questions require human input before implementation begins:

**1. Tailwind CSS version and configuration scope**

The style guide specifies Tailwind with semantic color tokens. Decision needed:
- Should we use Tailwind v3 (stable, widely known by agents) or Tailwind v4 (newer, CSS-first config)?
- How many semantic tokens should we pre-define vs. let the agent create on demand?
- Should we bundle a set of pre-made themes (light, dark, color accents) or start with a single default theme?

This affects the `tailwind.config.ts` that ships with the scaffold and every component the agent builds.

**2. MCP server transport protocol**

The MCP server needs to communicate with coding agents. Decision needed:
- Should it use stdio transport (standard for Claude Code, requires the agent to spawn the MCP process)?
- Should it use HTTP/SSE transport (works over the network, needed for remote agents)?
- Should it support both, with auto-detection?

Stdio is simpler and more secure for local use. HTTP/SSE is required for the cloud-hosted case where the agent may run separately from the container. Supporting both adds complexity to the MCP server but maximizes compatibility.

**3. Fly.io vs. alternatives for cloud hosting**

The design proposes Fly.io Machines for cloud hosting. Decision needed:
- Is Fly.io's pricing and reliability acceptable for production use?
- Should we prototype with a simpler setup first (e.g., a single VPS with Docker Compose and user isolation via separate compose projects)?
- Is the single-container-per-user model the right granularity, or should we share PocketBase instances across users (multi-tenant)?

A single VPS with Docker Compose is cheaper to start but harder to scale. Multi-tenant PocketBase reduces costs but complicates isolation and rollback.

**4. Skill versioning and update mechanism**

Skills will evolve as we learn what works and what fails. Decision needed:
- Should skills be versioned independently from the AnyClaw server release?
- When a skill is updated, should existing users get the update automatically (the install script re-runs), or should the user opt-in?
- Should the agent be able to read the current skill version and check for updates?

Automatic updates are simpler for users but risk breaking a working agent workflow. Opt-in is safer but means most users will run stale skills.

**5. Dev workspace isolation model inside Docker**

The agent writes code in the `dev_workspace` volume. Decision needed:
- Should the dev workspace be a full Node.js environment with its own `node_modules`, or should it share the base image's installed packages?
- Should `anyclaw_run_dev` execute commands inside the MCP container (fast, shared resources) or spin up a temporary container (isolated, but slower)?
- What resource limits should dev commands have (CPU time, memory, network access)?

Running inside the MCP container is faster but a runaway `npm install` could starve other services. A temporary container provides isolation but adds 1-2 seconds of startup latency per command.
