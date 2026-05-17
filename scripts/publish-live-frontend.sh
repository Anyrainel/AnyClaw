#!/usr/bin/env bash
set -euo pipefail

# Build-check the frontend template and refresh the running deployed
# environment's editable /data/dev workspace. In the prototype compose setup,
# that workspace is served by Vite inside the container on :5173.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/anyraven-server"
FRONTEND_DIR="$SERVER_DIR/packages/frontend-template"
CONTAINER_NAME="${ANYRAVEN_CONTAINER_NAME:-anyraven}"
DEV_TEMPLATE_TMP="/tmp/anyraven-template-src-$(date +%s)"

echo "[AnyRaven] Build-checking frontend template..."
npm run build --workspace @anyraven/frontend-template --prefix "$SERVER_DIR"

echo "[AnyRaven] Copying template source to $CONTAINER_NAME:$DEV_TEMPLATE_TMP ..."
docker exec "$CONTAINER_NAME" sh -lc "mkdir -p '$DEV_TEMPLATE_TMP'"
docker cp "$FRONTEND_DIR/." "$CONTAINER_NAME:$DEV_TEMPLATE_TMP/"

echo "[AnyRaven] Syncing deployed dev workspace..."
docker exec "$CONTAINER_NAME" sh -lc "FRONTEND_TEMPLATE_SRC='$DEV_TEMPLATE_TMP' /anyraven/scripts/sync-frontend-template.sh --force"

echo "[AnyRaven] Ensuring live frontend server is running..."
docker exec "$CONTAINER_NAME" supervisorctl restart app-frontend

echo "[AnyRaven] Live deployed template is available at http://127.0.0.1:5173/"
