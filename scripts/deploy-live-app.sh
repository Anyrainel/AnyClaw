#!/usr/bin/env bash
set -euo pipefail

# Promote the live git-tracked app workspace in the running AnyRaven container
# to the production app frontend/backend service directories.
#
# This is the deploy path real agent work should use after changing /data/dev:
# build the frontend, atomically replace /data/prod/app-frontend, optionally
# replace /data/prod/app-backend, then restart the supervised app services.

CONTAINER_NAME="${ANYRAVEN_CONTAINER_NAME:-anyraven}"
DEV_DIR="${ANYRAVEN_DEV_DIR:-/data/dev}"
APP_FRONTEND_DIR="${ANYRAVEN_APP_FRONTEND_DIR:-/data/prod/app-frontend}"
APP_BACKEND_SRC="${ANYRAVEN_APP_BACKEND_SRC:-$DEV_DIR/app-backend}"
APP_BACKEND_DIR="${ANYRAVEN_APP_BACKEND_DIR:-/data/prod/app-backend}"

docker exec "$CONTAINER_NAME" bash -lc "
  set -euo pipefail
  DEV_DIR='$DEV_DIR'
  APP_FRONTEND_DIR='$APP_FRONTEND_DIR'
  APP_BACKEND_SRC='$APP_BACKEND_SRC'
  APP_BACKEND_DIR='$APP_BACKEND_DIR'
  export HOME=\"/data/.anyraven\"
  export npm_config_cache=\"/data/.anyraven/npm-cache\"
  mkdir -p \"\$npm_config_cache\"
  chown -R anyraven-infra:anyraven-infra \"\$HOME\" \"\$npm_config_cache\" 2>/dev/null || true

  run_as_app_user() {
    if id anyraven-infra >/dev/null 2>&1; then
      runuser -u anyraven-infra -- \"\$@\"
    else
      \"\$@\"
    fi
  }

  promote_dir() {
    src=\"\$1\"
    dest=\"\$2\"
    tmp=\"\$dest.next\"
    old=\"\$dest.previous\"
    rm -rf \"\$tmp\"
    mkdir -p \"\$tmp\"
    cp -a \"\$src/.\" \"\$tmp/\"
    rm -rf \"\$old\"
    if [ -e \"\$dest\" ]; then
      mv \"\$dest\" \"\$old\"
    fi
    mv \"\$tmp\" \"\$dest\"
  }

  cd \"\$DEV_DIR\"
  chown -R anyraven-infra:anyraven-infra \
    \"\$DEV_DIR/node_modules\" \
    \"\$DEV_DIR/dist\" \
    \"\$DEV_DIR/package-lock.json\" 2>/dev/null || true
  if [ ! -x \"\$DEV_DIR/node_modules/.bin/vite\" ]; then
    rm -rf \"\$DEV_DIR/node_modules\"
    run_as_app_user npm install
  fi
  rm -rf \"\$DEV_DIR/dist\"
  run_as_app_user \"\$DEV_DIR/node_modules/.bin/vite\" build
  test -f \"\$DEV_DIR/dist/index.html\"
  promote_dir \"\$DEV_DIR/dist\" \"\$APP_FRONTEND_DIR\"

  if [ -f \"\$APP_BACKEND_SRC/index.js\" ]; then
    promote_dir \"\$APP_BACKEND_SRC\" \"\$APP_BACKEND_DIR\"
    supervisorctl restart app-backend
  elif [ -f \"\$APP_BACKEND_SRC/dist/index.js\" ]; then
    promote_dir \"\$APP_BACKEND_SRC/dist\" \"\$APP_BACKEND_DIR\"
    supervisorctl restart app-backend
  fi

  supervisorctl restart app-frontend
"

echo "[AnyRaven] Deployed app-frontend from $CONTAINER_NAME:$DEV_DIR/dist to $APP_FRONTEND_DIR"
