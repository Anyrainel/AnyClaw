#!/usr/bin/env bash
set -euo pipefail

# Milestone 1 evidence smoke:
# - mutate the live app repo in /data/dev
# - commit the app change
# - deploy app-frontend/app-backend artifacts without rebuilding Docker
# - verify promoted frontend artifacts, running app-backend, and unchanged image

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="${ANYRAVEN_CONTAINER_NAME:-anyraven}"
DEV_DIR="${ANYRAVEN_DEV_DIR:-/data/dev}"
APP_FRONTEND_DIR="${ANYRAVEN_APP_FRONTEND_DIR:-/data/prod/app-frontend}"
APP_BACKEND_DIR="${ANYRAVEN_APP_BACKEND_DIR:-/data/prod/app-backend}"
APP_BACKEND_URL="${APP_BACKEND_URL:-http://127.0.0.1:3000}"

MARKER="${ANYRAVEN_SMOKE_MARKER:-milestone1-$(date +%Y%m%d%H%M%S)}"
COMMIT_MSG="test: live deploy smoke $MARKER"

echo "[Milestone 1] Marker: $MARKER"

IMAGE_BEFORE="$(docker inspect "$CONTAINER_NAME" --format '{{.Image}}')"

docker exec "$CONTAINER_NAME" bash -lc "
  set -euo pipefail
  cd '$DEV_DIR'
  chown -R anyraven-infra:anyraven-infra '$DEV_DIR' 2>/dev/null || true

  runuser -u anyraven-infra -- perl -0pi -e 's/(Your app starts here\.|Live deploy smoke [A-Za-z0-9_-]+)/Live deploy smoke $MARKER/' src/pages/Welcome.tsx

  runuser -u anyraven-infra -- mkdir -p app-backend
  runuser -u anyraven-infra -- tee app-backend/index.js >/dev/null <<'BACKEND'
const http = require('node:http');

const marker = process.env.ANYRAVEN_BACKEND_MARKER || 'MARKER_PLACEHOLDER';
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health') {
    res.end(JSON.stringify({ ok: true, marker }));
    return;
  }
  res.end(JSON.stringify({ service: 'app-backend', marker }));
});

server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
BACKEND
  runuser -u anyraven-infra -- perl -pi -e 's/MARKER_PLACEHOLDER/$MARKER/g' app-backend/index.js

  runuser -u anyraven-infra -- git add src/pages/Welcome.tsx app-backend/index.js
  runuser -u anyraven-infra -- git commit -m '$COMMIT_MSG'
"

"$ROOT_DIR/scripts/deploy-live-app.sh"

IMAGE_AFTER="$(docker inspect "$CONTAINER_NAME" --format '{{.Image}}')"
if [ "$IMAGE_BEFORE" != "$IMAGE_AFTER" ]; then
  echo "Docker image changed during live deploy." >&2
  exit 1
fi

docker exec "$CONTAINER_NAME" bash -lc "
  set -euo pipefail
  test -f '$APP_FRONTEND_DIR/index.html'
  grep -R '$MARKER' '$APP_FRONTEND_DIR' >/dev/null
  test -f '$APP_BACKEND_DIR/index.js'
  cd '$DEV_DIR'
  git log -1 --pretty=%s | grep -F '$COMMIT_MSG' >/dev/null
"

for _ in $(seq 1 30); do
  if curl -fsS "$APP_BACKEND_URL/health" | grep -F "$MARKER" >/dev/null; then
    echo "[Milestone 1] app-backend health returned marker."
    break
  fi
  sleep 1
done

curl -fsS "$APP_BACKEND_URL/health" | grep -F "$MARKER" >/dev/null

echo "[Milestone 1] Live deploy smoke passed without Docker rebuild."
echo "[Milestone 1] Commit: $COMMIT_MSG"
echo "[Milestone 1] Frontend artifact: $CONTAINER_NAME:$APP_FRONTEND_DIR"
echo "[Milestone 1] Backend URL: $APP_BACKEND_URL/health"
