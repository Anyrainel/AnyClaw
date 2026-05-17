# AnyRaven Local Setup Checklist

## Prerequisites (user must have)
- [x] OpenClaw installed with valid API keys
- [x] `anyraven-test` agent created in OpenClaw config

## Setup Steps (to automate in install script)

### 1. PocketBase Binary
```bash
curl -fsSL -o /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v0.25.0/pocketbase_0.25.0_linux_amd64.zip"
unzip -o /tmp/pb.zip -d ~/.local/bin
chmod +x ~/.local/bin/pocketbase
```

### 2. Data Directory Layout
```bash
mkdir -p /data/pocketbase/pb_data
mkdir -p /data/dev/.worktrees
mkdir -p /data/prod/app-frontend
mkdir -p /data/prod/app-backend
mkdir -p /data/snapshots
mkdir -p /data/.anyraven/logs
mkdir -p /var/log/anyraven
```

### 3. Git Repo Initialization
```bash
cd /data/dev
git init
git config user.email "anyraven@local"
git config user.name "AnyRaven"
# Seed frontend-template source here
touch README.md
git add README.md
git commit -m "initial: frontend-template seed"
```

### 4. Environment Variables
```bash
export ADAPTER=openclaw                    # or claude-code
export OPENCLAW_WORKSPACE=anyraven-test
export OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789/gateway
export OPENCLAW_TOKEN=<from ~/.openclaw/openclaw.json>
export ANYRAVEN_DATA_ROOT=/data
export PORT=4100
export ANYRAVEN_ALLOWED_TOOLS="anyraven_ask_user,anyraven_update_progress,anyraven_create_collection,anyraven_snapshot_db,anyraven_deploy,anyraven_rollback,anyraven_list_versions"
```

### 5. Build All Packages
```bash
cd anyraven-server
npm ci
npm run build        # builds all packages including dispatch
```

### 6. Start Services (supervisord or manual)
```bash
# PocketBase
pocketbase serve --http=127.0.0.1:8090 --dir=/data/pocketbase/pb_data &

# Dispatch
node anyraven-server/packages/dispatch/dist/index.js &

# Prod-static (serves built frontend)
# node anyraven-server/packages/app-frontend/dist/index.js &

# Logic-runner (watches /data/dev for changes)
# node anyraven-server/packages/app-backend/dist/index.js &

# Tunnel-manager (optional, for external access)
# node anyraven-server/packages/tunnel-manager/dist/index.js &
```

### 7. Verify
```bash
curl http://127.0.0.1:4100/api/health
curl http://127.0.0.1:8090/api/health
```

### 8. Test End-to-End
```bash
curl -X POST http://127.0.0.1:4100/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"taskId":"test-1","request":"Say hello from AnyRaven"}'
```

## Notes
- The `init-data-layout.sh` script exists in `anyraven-server/infra/scripts/` but assumes `/data` is writable
- For non-root installs, use `ANYRAVEN_DATA_ROOT=$HOME/.anyraven/data`
- PocketBase collections (`_tasks`, `_task_clarifications`) are auto-created on first dispatch boot
- The dispatch server needs the `pocketbase` package installed (already in package.json)

## TODO for Installer Script
- [ ] Detect OS/arch for PocketBase download
- [ ] Check Node.js version (>=20)
- [ ] Check git availability
- [ ] Prompt for data root directory
- [ ] Auto-detect OpenClaw token from config
- [ ] Create systemd/supervisord service files
- [ ] Add `--dry-run` mode
