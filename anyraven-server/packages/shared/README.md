# @anyraven/shared

Shared library consumed by all anyraven-server packages. Provides cryptographic primitives, filesystem path resolution, git worktree management, database snapshot management, version store, and deploy/rollback orchestration.

## Exports

| Module | Exports | Purpose |
|---|---|---|
| `paths.ts` | `AnyRavenPaths` | Resolve all well-known `/data/*` paths from a configurable root |
| `crypto.ts` | `generateKeyPair`, `encryptJSON`, `decryptJSON` | NaCl box (X25519 + XSalsa20-Poly1305) via libsodium |
| `snapshots.ts` | `SnapshotManager` | Create/restore/list gzip SQLite snapshots |
| `versionStore.ts` | `VersionStore` | Git-based version history (commit, tag, list, checkout) |
| `worktrees.ts` | `WorktreeManager` | Create/remove/list git worktrees per task |
| `deployManager.ts` | `DeployManager` | Validate → snapshot → merge → restart orchestration |
| `rollbackManager.ts` | `RollbackManager` | Restore snapshot + checkout prior git tag |

## Usage

```typescript
import {
  AnyRavenPaths,
  SnapshotManager,
  VersionStore,
  WorktreeManager,
  DeployManager,
  RollbackManager,
} from "@anyraven/shared";

const paths = new AnyRavenPaths(process.env.ANYRAVEN_DATA_ROOT ?? "/data");
```

All classes accept an `AnyRavenPaths` instance so tests can override the data root via `ANYRAVEN_DATA_ROOT`.

## `AnyRavenPaths` Reference

```typescript
paths.dev              // /data/dev
paths.devWorktrees     // /data/dev/.worktrees
paths.prod             // /data/prod
paths.prodAppFrontend     // /data/prod/app-frontend
paths.prodAppBackend        // /data/prod/app-backend
paths.snapshots        // /data/snapshots
paths.secrets          // /data/.anyraven
paths.worktreeFor(taskId)         // /data/dev/.worktrees/<taskId>
paths.snapshotFile(isoStamp)      // /data/snapshots/<isoStamp>.sqlite.gz
```

## Crypto Notes

- Uses `libsodium-wrappers` pinned to `0.7.15`. Do not upgrade to `0.7.16` — its ESM build is broken (missing `libsodium.mjs`).
- NaCl box is asymmetric (sender secret key + recipient public key). The same key pair is used throughout the server↔mobile handshake.

## Build & Test

```bash
npm run build          # tsc -b
npm test               # vitest run
```

## Dependencies

- `libsodium-wrappers` 0.7.15 — encryption
- `simple-git` — git worktree and version operations
