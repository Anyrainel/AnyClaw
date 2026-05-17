#!/usr/bin/env bash
# AnyRaven One-Command Installer
# Usage: curl -fsSL https://get.anyravenapp.com | bash
set -euo pipefail

ANYRAVEN_VERSION="${ANYRAVEN_VERSION:-latest}"
INSTALL_DIR="${ANYRAVEN_DIR:-$HOME/.anyraven-host}"
RELEASE_BASE="${ANYRAVEN_RELEASE_BASE:-https://releases.anyravenapp.com}"
CONTAINER_NAME="anyraven"

# ── Helpers ──────────────────────────────────────────────────────────

info()  { echo "[AnyRaven]  $*"; }
warn()  { echo "[AnyRaven]  WARNING: $*" >&2; }
error() { echo "[AnyRaven]  ERROR: $*" >&2; exit 1; }

detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "macos" ;;
    *)       echo "unknown" ;;
  esac
}

# ── [1/6] Prerequisites ─────────────────────────────────────────────

check_prerequisites() {
  info "=== [1/6] Checking prerequisites ==="
  local os
  os="$(detect_os)"

  if [ "$os" = "unknown" ]; then
    error "Unsupported operating system: $(uname -s). AnyRaven requires Linux or macOS."
  fi

  # RAM check
  local mem_kb=0
  if [ "$os" = "linux" ] && [ -f /proc/meminfo ]; then
    mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
  elif [ "$os" = "macos" ]; then
    mem_kb=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 ))
  fi

  if [ "$mem_kb" -gt 0 ] && [ "$mem_kb" -lt 2097152 ]; then
    warn "Less than 2 GB RAM detected (${mem_kb} kB). AnyRaven may run slowly."
  fi

  # Disk check (install dir parent)
  local parent_dir
  parent_dir="$(dirname "$INSTALL_DIR")"
  mkdir -p "$parent_dir" 2>/dev/null || true
  local avail_kb
  avail_kb=$(df -k "$parent_dir" 2>/dev/null | awk 'NR==2{print $4}' || echo 0)
  if [ "${avail_kb:-0}" -gt 0 ] && [ "$avail_kb" -lt 5242880 ]; then
    warn "Less than 5 GB disk space available. AnyRaven needs room for images and data."
  fi

  # cgroup v2 warning on Linux
  if [ "$os" = "linux" ]; then
    if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
      : # cgroup v2 present, good
    else
      warn "cgroup v2 not detected. Some Docker features may not work correctly."
    fi
  fi

  info "  OS: $os  RAM: $((mem_kb / 1024)) MB  Disk: $((${avail_kb:-0} / 1024)) MB free"
}

# ── [2/6] Docker ─────────────────────────────────────────────────────

ensure_docker() {
  info "=== [2/6] Ensuring Docker is available ==="
  local os
  os="$(detect_os)"

  if ! command -v docker &>/dev/null; then
    if [ "$os" = "macos" ]; then
      error "Docker not found. Install Docker Desktop from https://docker.com/products/docker-desktop and try again."
    elif [ "$os" = "linux" ]; then
      info "  Installing Docker via get.docker.com ..."
      curl -fsSL https://get.docker.com | sh
    fi
  fi

  if ! docker info &>/dev/null; then
    error "Docker daemon is not running. Start Docker and try again."
  fi

  # Verify compose v2
  if ! docker compose version &>/dev/null; then
    error "Docker Compose v2 not found. Install it via 'docker compose' plugin."
  fi

  info "  Docker OK: $(docker --version)"
}

# ── [3/6] Install directory ──────────────────────────────────────────

setup_install_dir() {
  info "=== [3/6] Setting up install directory ==="
  mkdir -p "$INSTALL_DIR"

  # Fetch docker-compose.yml if missing
  if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    info "  Downloading docker-compose.yml ..."
    curl -fsSL "$RELEASE_BASE/$ANYRAVEN_VERSION/docker-compose.yml" \
      -o "$INSTALL_DIR/docker-compose.yml"
  fi

  # Fetch env.template and generate .env if missing
  if [ ! -f "$INSTALL_DIR/.env" ]; then
    info "  Downloading env template ..."
    curl -fsSL "$RELEASE_BASE/$ANYRAVEN_VERSION/env.template" \
      -o "$INSTALL_DIR/env.template"

    # Generate user token
    local user_token
    user_token="$(openssl rand -hex 32)"
    cp "$INSTALL_DIR/env.template" "$INSTALL_DIR/.env"
    sed -i.bak "s|ANYRAVEN_USER_TOKEN=.*|ANYRAVEN_USER_TOKEN=$user_token|" "$INSTALL_DIR/.env"
    rm -f "$INSTALL_DIR/.env.bak"

    # Prompt for LLM provider and key
    prompt_llm_key
  else
    info "  Existing .env found — preserving configuration."
  fi

  info "  Install dir: $INSTALL_DIR"
}

prompt_llm_key() {
  echo ""
  info "  Choose your LLM provider:"
  echo "    1) Anthropic (Claude)"
  echo "    2) OpenAI"
  echo ""
  local choice
  read -rp "  Enter 1 or 2: " choice

  local provider
  case "$choice" in
    1) provider="anthropic" ;;
    2) provider="openai" ;;
    *) provider="anthropic"; warn "Invalid choice, defaulting to Anthropic." ;;
  esac

  echo ""
  local api_key
  read -rsp "  Enter your $provider API key: " api_key
  echo ""

  if [ -z "$api_key" ]; then
    error "API key cannot be empty."
  fi

  # Store for phase 5
  ANYRAVEN_LLM_PROVIDER="$provider"
  ANYRAVEN_LLM_KEY="$api_key"
}

# ── [4/6] Pull + start ──────────────────────────────────────────────

pull_and_start() {
  info "=== [4/6] Pulling images and starting services ==="
  cd "$INSTALL_DIR"

  docker compose pull
  docker compose up -d

  # Run init-data-layout.sh inside the container (idempotent)
  info "  Running data layout init ..."
  docker compose exec "$CONTAINER_NAME" /anyraven/scripts/init-data-layout.sh || true

  if [ "${ANYRAVEN_SYNC_FRONTEND_TEMPLATE:-0}" = "1" ]; then
    info "  Syncing frontend template into the dev workspace ..."
    docker compose exec "$CONTAINER_NAME" \
      /anyraven/scripts/sync-frontend-template.sh --force
  fi

  # Wait for PocketBase health
  info "  Waiting for PocketBase to become healthy ..."
  wait_for_pocketbase

  # Bootstrap PocketBase superuser
  bootstrap_pocketbase
}

wait_for_pocketbase() {
  local max_attempts=30
  local attempt=0
  while [ "$attempt" -lt "$max_attempts" ]; do
    if docker compose exec "$CONTAINER_NAME" \
        curl -fsS http://127.0.0.1:8090/api/health &>/dev/null; then
      info "  PocketBase is healthy."
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  error "PocketBase did not become healthy within 60 seconds."
}

bootstrap_pocketbase() {
  info "  Bootstrapping PocketBase superuser ..."

  local admin_email="admin@anyraven.local"
  local admin_password
  admin_password="$(openssl rand -base64 24)"

  # Create superuser via CLI
  docker compose exec "$CONTAINER_NAME" \
    /usr/local/bin/pocketbase superuser create "$admin_email" "$admin_password" 2>/dev/null || true

  # Authenticate via _superusers collection (PB 0.25.x)
  local auth_response
  auth_response=$(docker compose exec "$CONTAINER_NAME" \
    curl -fsS -X POST http://127.0.0.1:8090/api/collections/_superusers/auth-with-password \
      -H 'Content-Type: application/json' \
      -d "{\"identity\":\"$admin_email\",\"password\":\"$admin_password\"}")

  local jwt
  jwt=$(echo "$auth_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  local admin_id
  admin_id=$(echo "$auth_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # Get impersonation token for long-lived access
  local impersonate_response
  impersonate_response=$(docker compose exec "$CONTAINER_NAME" \
    curl -fsS -X POST "http://127.0.0.1:8090/api/collections/_superusers/impersonate/$admin_id" \
      -H "Authorization: Bearer $jwt" \
      -H 'Content-Type: application/json' \
      -d '{"duration": 31536000}')

  local long_token
  long_token=$(echo "$impersonate_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

  # Store credentials securely inside the container
  docker compose exec "$CONTAINER_NAME" bash -c "
    mkdir -p /data/.anyraven
    echo '$admin_password' > /data/.anyraven/pb-admin
    chmod 0600 /data/.anyraven/pb-admin
    chown anyraven-infra:anyraven-infra /data/.anyraven/pb-admin 2>/dev/null || true
    echo '$long_token' > /data/.anyraven/pb-token
    chmod 0600 /data/.anyraven/pb-token
    chown anyraven-infra:anyraven-infra /data/.anyraven/pb-token 2>/dev/null || true
  "

  # Export for use by seed script
  ANYRAVEN_PB_TOKEN="$long_token"
  info "  PocketBase superuser bootstrapped."
}

# ── [5/6] LLM key storage ───────────────────────────────────────────

store_llm_key() {
  info "=== [5/6] Storing LLM API key ==="

  # Generate master encryption key
  docker compose exec "$CONTAINER_NAME" bash -c "
    if [ ! -f /data/.anyraven/master.key ]; then
      openssl rand -base64 32 > /data/.anyraven/master.key
      chmod 0600 /data/.anyraven/master.key
      chown anyraven-infra:anyraven-infra /data/.anyraven/master.key 2>/dev/null || true
    fi
  "

  # POST the key to Plan 3's internal endpoint on port 4100
  local response
  response=$(docker compose exec "$CONTAINER_NAME" \
    curl -fsS -X POST http://127.0.0.1:4100/internal/api-keys \
      -H 'Content-Type: application/json' \
      -d "{\"provider\":\"$ANYRAVEN_LLM_PROVIDER\",\"key\":\"$ANYRAVEN_LLM_KEY\"}" \
  ) || error "Failed to store LLM key via dispatch endpoint."

  # Clear the key from memory (best effort in bash)
  ANYRAVEN_LLM_KEY=""

  info "  LLM key stored securely (provider: $ANYRAVEN_LLM_PROVIDER)."
}

# ── [6/6] Package skills ────────────────────────────────────────────

package_skills() {
  info "=== [6/6] Packaging skills ==="

  if command -v openclaw &>/dev/null; then
    info "  Detected openclaw — packaging for OpenClaw."
    docker compose exec "$CONTAINER_NAME" \
      /.anyraven/scripts/package-skills.sh openclaw \
        --source /.anyraven/skills/raw \
        --dest /data/.openclaw/skills
  elif command -v claude &>/dev/null; then
    info "  Detected claude — packaging for Claude Code."
    docker compose exec "$CONTAINER_NAME" \
      /.anyraven/scripts/package-skills.sh claude-code \
        --project-dir /data/dev
  else
    info "  No agent CLI detected on host."
    info "  To connect an MCP-capable agent, add this MCP server URL:"
    info "    http://127.0.0.1:4100/mcp"
    info ""
    info "  For OpenClaw: install openclaw, then re-run this script."
    info "  For Claude Code: install claude, then re-run this script."
  fi

  # Seed the welcome page tips collection
  info "  Seeding welcome page tips ..."
  docker compose exec "$CONTAINER_NAME" \
    PB_URL=http://127.0.0.1:8090 PB_TOKEN="${ANYRAVEN_PB_TOKEN:-}" \
    node /.anyraven/scripts/seed-welcome-collection.js || warn "Tip seeding failed (non-fatal)."
}

# ── Main ─────────────────────────────────────────────────────────────

main() {
  echo "=== AnyRaven Installer ==="
  echo ""

  # Initialize variables that will be set by prompts
  ANYRAVEN_LLM_PROVIDER=""
  ANYRAVEN_LLM_KEY=""
  ANYRAVEN_PB_TOKEN=""

  check_prerequisites
  ensure_docker
  setup_install_dir
  pull_and_start
  store_llm_key
  package_skills

  echo ""
  info "=== Installation complete ==="
  info "  Install dir:  $INSTALL_DIR"
  info "  View logs:    cd $INSTALL_DIR && docker compose logs -f"
  info "  Stop:         cd $INSTALL_DIR && docker compose down"
  info ""
  info "  Open the AnyRaven mobile app to get started!"
}

main "$@"
