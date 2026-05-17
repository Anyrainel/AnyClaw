#!/usr/bin/env bash
# Initialize the AnyRaven /data filesystem layout.
# Idempotent: safe to run multiple times.
set -euo pipefail

DATA_ROOT="${DATA_ROOT:-/data}"
FRONTEND_TEMPLATE_SRC="${FRONTEND_TEMPLATE_SRC:-/anyraven/frontend-template}"

mkdir -p "$DATA_ROOT/pocketbase/pb_data"
mkdir -p "$DATA_ROOT/dev"
mkdir -p "$DATA_ROOT/dev/.worktrees"
mkdir -p "$DATA_ROOT/prod/app-frontend"
mkdir -p "$DATA_ROOT/prod/app-backend"
mkdir -p "$DATA_ROOT/snapshots"
mkdir -p "$DATA_ROOT/.anyraven/logs"

chmod 0750 "$DATA_ROOT/.anyraven" || true

if ! git config --system --get-all safe.directory 2>/dev/null | grep -Fx "$DATA_ROOT/dev" >/dev/null; then
  git config --system --add safe.directory "$DATA_ROOT/dev" || true
fi

if [ ! -f "$DATA_ROOT/.anyraven/server-token" ]; then
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" > "$DATA_ROOT/.anyraven/server-token"
  chmod 0600 "$DATA_ROOT/.anyraven/server-token" || true
fi

if [ ! -f "$DATA_ROOT/.anyraven/device-keys.json" ]; then
  node -e "const crypto=require('crypto'); process.stdout.write(JSON.stringify({ publicKey: crypto.randomBytes(32).toString('base64'), secretKey: crypto.randomBytes(32).toString('base64') }))" > "$DATA_ROOT/.anyraven/device-keys.json"
  chmod 0600 "$DATA_ROOT/.anyraven/device-keys.json" || true
fi

# On first run, seed /data/dev with the frontend template so the agent has
# something to start with. We detect "first run" by the absence of .git.
if [ ! -d "$DATA_ROOT/dev/.git" ]; then
  /anyraven/scripts/sync-frontend-template.sh
fi

# Always ensure the worktrees dir exists (even after first run)
mkdir -p "$DATA_ROOT/dev/.worktrees"

if id anyraven-infra >/dev/null 2>&1; then
  chown -R anyraven-infra:anyraven-infra "$DATA_ROOT/pocketbase" "$DATA_ROOT/prod" "$DATA_ROOT/snapshots" "$DATA_ROOT/.anyraven" "$DATA_ROOT/dev" || true
fi

echo "AnyRaven data layout ready at $DATA_ROOT"
