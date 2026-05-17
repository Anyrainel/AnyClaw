#!/usr/bin/env bash
# AnyRaven baseline e2e smoke test
# Verifies: docker compose up → health → create task → task appears in list
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
BASE_URL="${BASE_URL:-http://127.0.0.1:4100}"
APP_URL="${APP_URL:-http://127.0.0.1:5173}"
TIMEOUT_SEC="${TIMEOUT_SEC:-60}"
export ANYRAVEN_DISABLE_TASK_AUTORUN="${ANYRAVEN_DISABLE_TASK_AUTORUN:-1}"

echo "=== AnyRaven Baseline E2E Smoke Test ==="
echo "Compose file: $COMPOSE_FILE"
echo "API base:     $BASE_URL"
echo "App URL:      $APP_URL"
echo ""

# ---------------------------------------------------------------------------
# 1. Build and start
# ---------------------------------------------------------------------------
echo "[1/6] Building docker image..."
docker compose -f "$COMPOSE_FILE" build --quiet

echo "[2/6] Starting services..."
docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout "$TIMEOUT_SEC"

# ---------------------------------------------------------------------------
# 2. Health check
# ---------------------------------------------------------------------------
echo "[3/6] Waiting for dispatch health..."
for i in $(seq 1 "$TIMEOUT_SEC"); do
  if curl -fsS "$BASE_URL/api/health" >/dev/null 2>&1; then
echo "    ✓ dispatch healthy"
    break
  fi
  if [ "$i" -eq "$TIMEOUT_SEC" ]; then
    echo "    ✗ dispatch health timeout"
    docker compose -f "$COMPOSE_FILE" logs --tail 50
    exit 1
  fi
  sleep 1
done

echo "[3b/6] Verifying app frontend..."
for i in $(seq 1 "$TIMEOUT_SEC"); do
  if curl -fsS "$APP_URL/" >/dev/null 2>&1; then
    echo "    ✓ app frontend reachable"
    break
  fi
  if [ "$i" -eq "$TIMEOUT_SEC" ]; then
    echo "    ✗ app frontend not reachable"
    docker compose -f "$COMPOSE_FILE" logs --tail 50 app-frontend 2>/dev/null || docker compose -f "$COMPOSE_FILE" logs --tail 50
    exit 1
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# 3. Create a task
# ---------------------------------------------------------------------------
echo "[4/6] Creating test task..."
TASK_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
TASK_REQ="Build a simple counter app"

CREATE_RESP=$(curl -fsS -X POST "$BASE_URL/api/tasks" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-token" \
  -d "{\"taskId\":\"$TASK_ID\",\"request\":\"$TASK_REQ\"}")

TASK_STATE=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])" 2>/dev/null || echo "unknown")
if [ "$TASK_STATE" != "queued" ]; then
  echo "    ✗ Expected state 'queued', got '$TASK_STATE'"
  echo "    Response: $CREATE_RESP"
  exit 1
fi
echo "    ✓ task created (state=$TASK_STATE, id=$TASK_ID)"

# ---------------------------------------------------------------------------
# 4. Task appears in list
# ---------------------------------------------------------------------------
echo "[5/6] Verifying task list..."
LIST_RESP=$(curl -fsS -X GET "$BASE_URL/api/tasks" \
  -H "Authorization: Bearer dev-token")

if echo "$LIST_RESP" | grep -q "$TASK_ID"; then
  echo "    ✓ task visible in list"
else
  echo "    ✗ task not found in list"
  echo "    Response: $LIST_RESP"
  exit 1
fi

# ---------------------------------------------------------------------------
# 5. Get task detail
# ---------------------------------------------------------------------------
echo "[6/6] Fetching task detail..."
GET_RESP=$(curl -fsS -X GET "$BASE_URL/api/tasks/$TASK_ID" \
  -H "Authorization: Bearer dev-token")

GET_STATE=$(echo "$GET_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])" 2>/dev/null || echo "unknown")
if [ "$GET_STATE" = "queued" ]; then
  echo "    ✓ task detail correct (state=$GET_STATE)"
else
  echo "    ✗ task detail unexpected state: $GET_STATE"
  echo "    Response: $GET_RESP"
  exit 1
fi

echo ""
echo "=== All checks passed ==="
echo "Task ID: $TASK_ID"
echo "Web UI:  $APP_URL"
echo "API:     $BASE_URL"
