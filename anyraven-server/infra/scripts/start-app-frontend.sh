#!/usr/bin/env bash
set -euo pipefail

MODE="${APP_FRONTEND_SERVER_MODE:-static}"
DATA_ROOT="${ANYRAVEN_DATA_ROOT:-/data}"
DEV_DIR="${DEV_WORKSPACE:-$DATA_ROOT/dev}"
APP_FRONTEND_DIR="${APP_FRONTEND_DIR:-$DATA_ROOT/prod/app-frontend}"
PORT="${PORT:-5173}"
export HOME="$DATA_ROOT/.anyraven"
export npm_config_cache="$DATA_ROOT/.anyraven/npm-cache"

if [ "$MODE" = "dev" ]; then
  mkdir -p "$DEV_DIR"
  mkdir -p "$npm_config_cache"
  cd "$DEV_DIR"
  if [ ! -x "$DEV_DIR/node_modules/.bin/vite" ]; then
    rm -rf "$DEV_DIR/node_modules"
    npm install
  fi
  export VITE_DISPATCH_URL="${VITE_DISPATCH_URL:-http://127.0.0.1:4100}"
  exec "$DEV_DIR/node_modules/.bin/vite" --host 0.0.0.0 --port "$PORT"
fi

if [ "$MODE" = "static" ]; then
  export APP_FRONTEND_DIR
  exec /usr/local/bin/node /anyraven/app-frontend/dist/index.js
fi

echo "Unknown APP_FRONTEND_SERVER_MODE: $MODE" >&2
exit 2
