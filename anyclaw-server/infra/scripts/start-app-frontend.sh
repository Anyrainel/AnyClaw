#!/usr/bin/env bash
set -euo pipefail

MODE="${APP_FRONTEND_SERVER_MODE:-static}"
DATA_ROOT="${ANYCLAW_DATA_ROOT:-/data}"
DEV_DIR="${DEV_WORKSPACE:-$DATA_ROOT/dev}"
APP_FRONTEND_DIR="${APP_FRONTEND_DIR:-$DATA_ROOT/prod/app-frontend}"
PORT="${PORT:-5173}"

if [ "$MODE" = "dev" ]; then
  mkdir -p "$DEV_DIR"
  if [ "$(readlink "$DEV_DIR/node_modules" 2>/dev/null || true)" != "/anyclaw/frontend-template/node_modules" ]; then
    rm -f "$DEV_DIR/node_modules"
    ln -s /anyclaw/frontend-template/node_modules "$DEV_DIR/node_modules"
  fi
  cd "$DEV_DIR"
  export VITE_DISPATCH_URL="${VITE_DISPATCH_URL:-http://127.0.0.1:4100}"
  exec /usr/local/bin/node /anyclaw/node_modules/vite/bin/vite.js --host 0.0.0.0 --port "$PORT"
fi

if [ "$MODE" = "static" ]; then
  export APP_FRONTEND_DIR
  exec /usr/local/bin/node /anyclaw/app-frontend/dist/index.js
fi

echo "Unknown APP_FRONTEND_SERVER_MODE: $MODE" >&2
exit 2
