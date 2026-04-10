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
