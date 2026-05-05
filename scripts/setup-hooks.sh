#!/usr/bin/env bash
# Configure git to use the project's tracked hooks.
# Run once after cloning: bash scripts/setup-hooks.sh
set -euo pipefail

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push
echo "Git hooks configured (.githooks/)."
