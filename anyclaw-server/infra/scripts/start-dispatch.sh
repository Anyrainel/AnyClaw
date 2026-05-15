#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${ANYCLAW_DATA_ROOT:-/data}"
PB_DIR="${POCKETBASE_DATA_DIR:-$DATA_ROOT/pocketbase/pb_data}"
PB_URL="${POCKETBASE_URL:-http://127.0.0.1:8090}"
TOKEN_FILE="$DATA_ROOT/.anyclaw/pb-token"
ADMIN_FILE="$DATA_ROOT/.anyclaw/pb-admin"
ADMIN_EMAIL="${ANYCLAW_PB_ADMIN_EMAIL:-admin@anyclaw.local}"

wait_for_pocketbase() {
  for _ in $(seq 1 60); do
    if curl -fsS "$PB_URL/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "PocketBase did not become healthy at $PB_URL" >&2
  return 1
}

json_field() {
  node -e '
    const fs = require("fs");
    const field = process.argv[1];
    const input = fs.readFileSync(0, "utf8");
    const parsed = JSON.parse(input);
    const value = field.split(".").reduce((acc, key) => acc?.[key], parsed);
    if (typeof value !== "string" || value.length === 0) process.exit(1);
    process.stdout.write(value);
  ' "$1"
}

bootstrap_pocketbase_token() {
  if [ -s "$TOKEN_FILE" ]; then
    return 0
  fi

  mkdir -p "$DATA_ROOT/.anyclaw"
  local admin_password
  admin_password="$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("base64url"))')"

  /usr/local/bin/pocketbase superuser upsert "$ADMIN_EMAIL" "$admin_password" --dir "$PB_DIR" >/dev/null

  local auth_response jwt admin_id impersonate_response long_token
  auth_response="$(curl -fsS -X POST "$PB_URL/api/collections/_superusers/auth-with-password" \
    -H 'Content-Type: application/json' \
    -d "{\"identity\":\"$ADMIN_EMAIL\",\"password\":\"$admin_password\"}")"
  jwt="$(printf '%s' "$auth_response" | json_field token)"
  admin_id="$(printf '%s' "$auth_response" | json_field record.id)"

  impersonate_response="$(curl -fsS -X POST "$PB_URL/api/collections/_superusers/impersonate/$admin_id" \
    -H "Authorization: Bearer $jwt" \
    -H 'Content-Type: application/json' \
    -d '{"duration":31536000}')"
  long_token="$(printf '%s' "$impersonate_response" | json_field token)"

  printf '%s\n' "$admin_password" > "$ADMIN_FILE"
  printf '%s\n' "$long_token" > "$TOKEN_FILE"
  chmod 0600 "$ADMIN_FILE" "$TOKEN_FILE"
}

wait_for_pocketbase
bootstrap_pocketbase_token

exec /usr/local/bin/node /anyclaw/dispatch/dist/index.js
