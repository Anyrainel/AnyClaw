#!/usr/bin/env bash
set -euo pipefail

# package-skills.sh — Package AnyClaw skill files for different agent platforms.
#
# Usage:
#   package-skills.sh openclaw    [--source DIR] [--dest DIR]
#   package-skills.sh claude-code [--project-dir DIR]
#   package-skills.sh generic     [--source DIR] [--out FILE]

EXPECTED_SKILLS=(
  "anyclaw-developer-loop.md"
  "anyclaw-build-feature.md"
  "anyclaw-canonical-example.md"
  "anyclaw-style-guide.md"
  "anyclaw-refactor.md"
  "anyclaw-describe-version.md"
)

# Order for generic concatenation
GENERIC_ORDER=(
  "anyclaw-developer-loop.md"
  "anyclaw-build-feature.md"
  "anyclaw-canonical-example.md"
  "anyclaw-style-guide.md"
  "anyclaw-refactor.md"
  "anyclaw-describe-version.md"
)

strip_frontmatter() {
  local file="$1"
  # Remove everything from first --- to second --- (inclusive), then trim leading whitespace
  awk '
    BEGIN { in_fm=0; past_fm=0 }
    /^---/ && !in_fm && !past_fm { in_fm=1; next }
    /^---/ && in_fm { in_fm=0; past_fm=1; next }
    in_fm { next }
    past_fm { print }
  ' "$file" | sed '/./,$!d'
}

verify_source() {
  local source="$1"
  if [ ! -d "$source" ]; then
    echo "Error: source directory does not exist: $source" >&2
    exit 1
  fi
  local missing=()
  for skill in "${EXPECTED_SKILLS[@]}"; do
    if [ ! -f "$source/$skill" ]; then
      missing+=("$skill")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "Error: missing skill files in $source:" >&2
    for m in "${missing[@]}"; do
      echo "  - $m" >&2
    done
    exit 1
  fi
}

cmd_openclaw() {
  local source="anyclaw-server/skills/raw"
  local dest="$HOME/.openclaw/skills"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --source) source="$2"; shift 2 ;;
      --dest)   dest="$2";   shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  verify_source "$source"
  mkdir -p "$dest"

  local count=0
  for skill in "${EXPECTED_SKILLS[@]}"; do
    strip_frontmatter "$source/$skill" > "$dest/$skill"
    count=$((count + 1))
  done

  echo "Installed $count skills to $dest"
}

cmd_claude_code() {
  local project_dir="${PWD}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project-dir) project_dir="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  # Default source relative to script location
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local source="$script_dir/../skills/raw"

  verify_source "$source"

  # 1. Copy skill files (frontmatter stripped) into .claude/commands/
  local commands_dir="$project_dir/.claude/commands"
  mkdir -p "$commands_dir"

  for skill in "${EXPECTED_SKILLS[@]}"; do
    strip_frontmatter "$source/$skill" > "$commands_dir/$skill"
  done

  # 2. Generate or update CLAUDE.md with AnyClaw Agent Instructions block
  local claude_md="$project_dir/CLAUDE.md"
  local sentinel_begin="<!-- anyclaw:begin -->"
  local sentinel_end="<!-- anyclaw:end -->"

  local block
  block=$(cat <<'AGENTBLOCK'
<!-- anyclaw:begin -->
## AnyClaw Agent Instructions

### Skills (slash commands)

Use these skills during every task:

- `/anyclaw-developer-loop` — Use this as the top-level state machine for every request: clarify only requirements, break work into commit-sized vertical slices, test each slice, publish, then report.
- `/anyclaw-build-feature` — Use this for the concrete AnyClaw implementation steps inside each feature request.
- `/anyclaw-style-guide` — Follow this for all frontend code. Tailwind v4 conventions, component patterns, voice and tone.
- `/anyclaw-canonical-example` — Read `dev/_examples/welcome.tsx` before writing any new frontend code. Every task, every time.
- `/anyclaw-refactor` — Run a cleanup pass every 5 deployments or when complexity grows.
- `/anyclaw-describe-version` — Write a non-technical version description for every deployment.

### AnyClaw MCP tools

These are the ONLY MCP tools you should use. For file operations and shell commands, use your own built-in tools.

- `anyclaw_deploy` — validate, snapshot, commit, promote dev to prod atomically
- `anyclaw_rollback` — restore a specific version (code + DB snapshot together)
- `anyclaw_snapshot_db` — take a DB snapshot before risky schema changes
- `anyclaw_create_collection` — create a PocketBase collection via admin API
- `anyclaw_ask_user` — post a clarifying question to the mobile app and wait
- `anyclaw_update_progress` — post a progress update to the mobile app task card
- `anyclaw_list_versions` — read deployment history

File and shell tools are your own — do NOT look for MCP equivalents.
<!-- anyclaw:end -->
AGENTBLOCK
)

  if [ ! -f "$claude_md" ]; then
    echo "$block" > "$claude_md"
  elif grep -q "$sentinel_begin" "$claude_md"; then
    # Replace existing block between sentinels
    local tmp
    tmp=$(mktemp)
    awk -v begin="$sentinel_begin" -v end="$sentinel_end" '
      $0 == begin { skip=1; next }
      $0 == end   { skip=0; next }
      !skip { print }
    ' "$claude_md" > "$tmp"
    # Insert new block at the end
    cat "$tmp" > "$claude_md"
    echo "" >> "$claude_md"
    echo "$block" >> "$claude_md"
    rm -f "$tmp"
  else
    # Append block
    echo "" >> "$claude_md"
    echo "$block" >> "$claude_md"
  fi

  echo "Installed ${#EXPECTED_SKILLS[@]} slash commands to $commands_dir"
  echo "Updated $claude_md with AnyClaw Agent Instructions"
}

cmd_generic() {
  local source="anyclaw-server/skills/raw"
  local out="anyclaw-server/skills/raw/system-prompt.txt"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --source) source="$2"; shift 2 ;;
      --out)    out="$2";    shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  verify_source "$source"

  # Ensure output directory exists
  mkdir -p "$(dirname "$out")"

  {
    echo "# AnyClaw Agent System Prompt"
    echo "# Combined skill suite — do not edit, regenerate via package-skills.sh generic."
    echo ""

    local first=true
    for skill in "${GENERIC_ORDER[@]}"; do
      if [ "$first" = true ]; then
        first=false
      else
        printf '\n---\n\n'
      fi
      strip_frontmatter "$source/$skill"
    done
  } > "$out"

  echo "Generated system prompt at $out"
}

# Main dispatch
if [ $# -lt 1 ]; then
  echo "Usage: package-skills.sh {openclaw|claude-code|generic} [options]" >&2
  exit 1
fi

subcommand="$1"
shift

case "$subcommand" in
  openclaw)    cmd_openclaw "$@" ;;
  claude-code) cmd_claude_code "$@" ;;
  generic)     cmd_generic "$@" ;;
  *)
    echo "Unknown subcommand: $subcommand" >&2
    echo "Usage: package-skills.sh {openclaw|claude-code|generic} [options]" >&2
    exit 1
    ;;
esac
