#!/usr/bin/env bash
# Download the PocketBase binary for the current platform.
# Used by the Dockerfile and by native installs.
set -euo pipefail

# Pinned to 0.25.x — must stay consistent with the JS SDK version in
# frontend-template (pocketbase ^0.25.0) and the bootstrap migrations in Plan 2.
POCKETBASE_VERSION="${POCKETBASE_VERSION:-0.25.0}"
DEST="${DEST:-/usr/local/bin/pocketbase}"

UNAME_S="$(uname -s | tr '[:upper:]' '[:lower:]')"
UNAME_M="$(uname -m)"

case "$UNAME_S" in
  linux)  OS="linux"  ;;
  darwin) OS="darwin" ;;
  *) echo "Unsupported OS: $UNAME_S" >&2; exit 1 ;;
esac

case "$UNAME_M" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported arch: $UNAME_M" >&2; exit 1 ;;
esac

URL="https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_${OS}_${ARCH}.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading PocketBase $POCKETBASE_VERSION ($OS/$ARCH)..."
curl -fsSL -o "$TMP/pb.zip" "$URL"
unzip -q "$TMP/pb.zip" -d "$TMP"
install -m 0755 "$TMP/pocketbase" "$DEST"

echo "Installed: $DEST"
"$DEST" --version || true
