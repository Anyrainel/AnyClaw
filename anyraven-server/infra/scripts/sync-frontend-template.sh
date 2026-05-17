#!/usr/bin/env bash
# Copy the bundled frontend template into the deployed dev workspace.
# This is intentionally separate from init-data-layout.sh so template updates
# can be installed for prototype/dev deployments without pretending every run
# is a first run.
set -euo pipefail

DATA_ROOT="${DATA_ROOT:-/data}"
FRONTEND_TEMPLATE_SRC="${FRONTEND_TEMPLATE_SRC:-/anyraven/frontend-template}"
DEV_DIR="${DEV_DIR:-$DATA_ROOT/dev}"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: sync-frontend-template.sh [--force]" >&2
      exit 2
      ;;
  esac
done

if [ ! -d "$FRONTEND_TEMPLATE_SRC" ]; then
  echo "Frontend template source not found: $FRONTEND_TEMPLATE_SRC" >&2
  exit 1
fi

mkdir -p "$DEV_DIR"

if [ -d "$DEV_DIR/.git" ] && [ "$FORCE" -ne 1 ]; then
  echo "$DEV_DIR already contains a git repo; pass --force to sync the template." >&2
  exit 1
fi

copy_template() {
  ( cd "$FRONTEND_TEMPLATE_SRC" \
    && find . -mindepth 1 \
         -not -path "./node_modules*" \
         -not -path "./dist*" \
         -not -path "./.git*" \
         -print0 \
      | xargs -0 -I {} cp -r --parents {} "$DEV_DIR/" )
}

copy_template

if [ ! -d "$DEV_DIR/.git" ]; then
  ( cd "$DEV_DIR" \
    && git init --initial-branch=main \
    && git config user.email "anyraven@local" \
    && git config user.name  "AnyRaven" \
    && git config commit.gpgsign false \
    && [ -f README.md ] || : > README.md \
    && git add -A \
    && git commit -m "initial: frontend-template seed" )
else
  ( cd "$DEV_DIR" \
    && git add -A -- . ':!.worktrees' ':!node_modules' ':!dist' \
    && if ! git diff --cached --quiet; then \
         git commit -m "chore: sync frontend template"; \
       fi )
fi

mkdir -p "$DEV_DIR/.worktrees"

if id anyraven-infra >/dev/null 2>&1; then
  chown -R anyraven-infra:anyraven-infra "$DEV_DIR" || true
fi

echo "Frontend template synced to $DEV_DIR"
