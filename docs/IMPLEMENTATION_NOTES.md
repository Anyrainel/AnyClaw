# Implementation Notes — Non-Blocking Questions for Review

This document accumulates technical decisions and observations made during implementation that deserve user review but did NOT block progress. Review when convenient.

## Plan 1: Server Infrastructure (Complete)

### Q1.1 — libsodium-wrappers version pin
**Decision made:** Pinned `libsodium-wrappers` to `0.7.15` (was `^0.7.13` in plan).
**Why:** `0.7.16` ships a broken ESM build that imports `./libsodium.mjs` which is not packaged. `0.7.15` ships only the CJS bundle, which Node imports via automatic interop.
**Impact:** None at runtime. All 13 crypto tests pass. Verified at runtime via compiled output.
**Action needed:** None unless we need a feature in 0.7.16+ later.

### Q1.2 — TypeScript version
**Observation:** Plan said `typescript@^5.4.5`, npm resolved to `5.9.3` (caret range, semver-compatible).
**Action needed:** None. The build works fine. Just be aware the version isn't literally 5.4.x.

### Q1.3 — Root tsconfig.json added (not in plan)
**Decision made:** Added `anyclaw-server/tsconfig.json` (root LSP config) and added `"types": ["node"]` to `tsconfig.base.json`.
**Why:** Without these, the LSP couldn't find `node:fs`, `node:path`, etc. for test files (test/ wasn't included in any package's tsconfig because composite + rootDir=src excludes it).
**Impact:** Cleaner LSP experience. The `tsc -b` build path is unaffected.
**Action needed:** None.

### Q1.4 — Frontend-template excluded from root LSP
**Decision made:** Added `packages/frontend-template/**` to root tsconfig.json's `exclude`.
**Why:** Frontend-template uses Vite-flavored tsconfig (jsx: react-jsx, lib: DOM, moduleResolution: Bundler) which conflicts with the Node-flavored root config.
**Impact:** Frontend-template uses its own tsconfig. The LSP picks the right config per file.
**Action needed:** None.

### Q1.5 — DeployManager test pattern (minor type narrowing)
**Subagent deviation:** Plan's test snippet had `expect(result.version.tag).toBe("v1")` outside any narrowing on a discriminated union. Subagent wrapped in `if (result.ok)` to satisfy the typechecker.
**Impact:** Pure type narrowing, no behavioral change.
**Action needed:** None.

### Q1.6 — exactOptionalPropertyTypes pattern enforced
**Decision made:** Document that all optional class fields must use `: T | undefined` syntax (not `?: T`) due to repo's `exactOptionalPropertyTypes: true`.
**Action needed:** None — this is now baked into prior work and noted in batch prompts.

### Q1.7 — Docker build not attempted on Windows
**Observation:** Plan 1's Dockerfile was written verbatim but not built (no Docker on the dev host). The Dockerfile will need to be tested in CI or on a Linux host before we can deliver a real container.
**Action needed:** Run `docker build -f anyclaw-server/infra/Dockerfile anyclaw-server/` on a machine with Docker before relying on the image. Probably best done as part of Plan 6's CI/CD.
