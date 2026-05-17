#!/usr/bin/env bash
# Lightweight test harness for package-skills.sh (no bats dependency).
# Run:  bash anyraven-server/scripts/test/package-skills.test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_SKILLS="$SCRIPT_DIR/../package-skills.sh"
SKILLS_SRC="$SCRIPT_DIR/../../skills/raw"

pass=0
fail=0

assert() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS: $name"
    pass=$((pass + 1))
  else
    echo "  FAIL: $name"
    fail=$((fail + 1))
  fi
}

assert_fail() {
  local name="$1"
  shift
  if ! "$@" >/dev/null 2>&1; then
    echo "  PASS: $name"
    pass=$((pass + 1))
  else
    echo "  FAIL: $name (expected failure but succeeded)"
    fail=$((fail + 1))
  fi
}

assert_contains() {
  local name="$1"
  local file="$2"
  local pattern="$3"
  if grep -q "$pattern" "$file"; then
    echo "  PASS: $name"
    pass=$((pass + 1))
  else
    echo "  FAIL: $name (pattern '$pattern' not found in $file)"
    fail=$((fail + 1))
  fi
}

assert_not_contains() {
  local name="$1"
  local file="$2"
  local pattern="$3"
  if ! grep -q "$pattern" "$file"; then
    echo "  PASS: $name"
    pass=$((pass + 1))
  else
    echo "  FAIL: $name (pattern '$pattern' found in $file but should not be)"
    fail=$((fail + 1))
  fi
}

# ────────────────────────────────────────────────────────────────
echo "=== OpenClaw target tests ==="

TMPDIR_OC=$(mktemp -d)
trap 'rm -rf "$TMPDIR_OC" "$TMPDIR_CC" "$TMPDIR_GEN" 2>/dev/null' EXIT

# Test 1: Happy path — 6 files in, 6 files out
bash "$PACKAGE_SKILLS" openclaw --source "$SKILLS_SRC" --dest "$TMPDIR_OC/skills"
assert "openclaw: 6 files created" test "$(ls "$TMPDIR_OC/skills/"*.md 2>/dev/null | wc -l)" -eq 6

# Test 2: No frontmatter in output
for f in "$TMPDIR_OC/skills/"*.md; do
  assert_not_contains "openclaw: no frontmatter in $(basename "$f")" "$f" "^skill_version:"
done

# Test 3: Body starts with heading
for f in "$TMPDIR_OC/skills/"*.md; do
  first_line=$(head -1 "$f")
  assert "openclaw: $(basename "$f") starts with #" test "${first_line:0:1}" = "#"
done

# Test 4: Missing source dir -> exit 1
assert_fail "openclaw: missing source dir -> exit 1" bash "$PACKAGE_SKILLS" openclaw --source /nonexistent --dest "$TMPDIR_OC/nope"

# Test 5: Dest dir gets created if absent
rm -rf "$TMPDIR_OC/newdest"
bash "$PACKAGE_SKILLS" openclaw --source "$SKILLS_SRC" --dest "$TMPDIR_OC/newdest"
assert "openclaw: dest dir created" test -d "$TMPDIR_OC/newdest"

# Test 6: Pre-existing files overwritten
echo "old content" > "$TMPDIR_OC/skills/anyraven-build-feature.md"
bash "$PACKAGE_SKILLS" openclaw --source "$SKILLS_SRC" --dest "$TMPDIR_OC/skills"
assert_not_contains "openclaw: pre-existing overwritten" "$TMPDIR_OC/skills/anyraven-build-feature.md" "old content"

# ────────────────────────────────────────────────────────────────
echo ""
echo "=== Claude Code target tests ==="

TMPDIR_CC=$(mktemp -d)

# Test 1: Fresh project — both .claude/commands/ and CLAUDE.md created
bash "$PACKAGE_SKILLS" claude-code --project-dir "$TMPDIR_CC"
assert "claude-code: .claude/commands/ created" test -d "$TMPDIR_CC/.claude/commands"
assert "claude-code: CLAUDE.md created" test -f "$TMPDIR_CC/CLAUDE.md"
assert "claude-code: 6 slash commands" test "$(ls "$TMPDIR_CC/.claude/commands/"*.md 2>/dev/null | wc -l)" -eq 6

# Test 2: Generated slash commands have no frontmatter
for f in "$TMPDIR_CC/.claude/commands/"*.md; do
  assert_not_contains "claude-code: no frontmatter in $(basename "$f")" "$f" "^skill_version:"
done

# Test 3: CLAUDE.md contains sentinel markers and all skill names
assert_contains "claude-code: begin sentinel" "$TMPDIR_CC/CLAUDE.md" "<!-- anyraven:begin -->"
assert_contains "claude-code: end sentinel" "$TMPDIR_CC/CLAUDE.md" "<!-- anyraven:end -->"
assert_contains "claude-code: lists developer-loop" "$TMPDIR_CC/CLAUDE.md" "anyraven-developer-loop"
assert_contains "claude-code: lists build-feature" "$TMPDIR_CC/CLAUDE.md" "anyraven-build-feature"
assert_contains "claude-code: lists style-guide" "$TMPDIR_CC/CLAUDE.md" "anyraven-style-guide"
assert_contains "claude-code: lists canonical-example" "$TMPDIR_CC/CLAUDE.md" "anyraven-canonical-example"
assert_contains "claude-code: lists refactor" "$TMPDIR_CC/CLAUDE.md" "anyraven-refactor"
assert_contains "claude-code: lists describe-version" "$TMPDIR_CC/CLAUDE.md" "anyraven-describe-version"

# Test 4: CLAUDE.md lists all 7 MCP tools
assert_contains "claude-code: lists anyraven_deploy" "$TMPDIR_CC/CLAUDE.md" "anyraven_deploy"
assert_contains "claude-code: lists anyraven_rollback" "$TMPDIR_CC/CLAUDE.md" "anyraven_rollback"
assert_contains "claude-code: lists anyraven_snapshot_db" "$TMPDIR_CC/CLAUDE.md" "anyraven_snapshot_db"
assert_contains "claude-code: lists anyraven_create_collection" "$TMPDIR_CC/CLAUDE.md" "anyraven_create_collection"
assert_contains "claude-code: lists anyraven_ask_user" "$TMPDIR_CC/CLAUDE.md" "anyraven_ask_user"
assert_contains "claude-code: lists anyraven_update_progress" "$TMPDIR_CC/CLAUDE.md" "anyraven_update_progress"
assert_contains "claude-code: lists anyraven_list_versions" "$TMPDIR_CC/CLAUDE.md" "anyraven_list_versions"

# Test 5: Re-run does not duplicate block
bash "$PACKAGE_SKILLS" claude-code --project-dir "$TMPDIR_CC"
sentinel_count=$(grep -c "<!-- anyraven:begin -->" "$TMPDIR_CC/CLAUDE.md" || true)
assert "claude-code: re-run idempotent (1 begin sentinel)" test "$sentinel_count" -eq 1

# Test 6: Re-run preserves content outside sentinels
echo "# My Project" > "$TMPDIR_CC/CLAUDE2.md"
echo "" >> "$TMPDIR_CC/CLAUDE2.md"
echo "Some custom instructions here." >> "$TMPDIR_CC/CLAUDE2.md"
cp "$TMPDIR_CC/CLAUDE2.md" "$TMPDIR_CC/CLAUDE.md"
bash "$PACKAGE_SKILLS" claude-code --project-dir "$TMPDIR_CC"
assert_contains "claude-code: preserves custom content" "$TMPDIR_CC/CLAUDE.md" "Some custom instructions here."
assert_contains "claude-code: has block after re-run" "$TMPDIR_CC/CLAUDE.md" "<!-- anyraven:begin -->"

# ────────────────────────────────────────────────────────────────
echo ""
echo "=== Generic system prompt target tests ==="

TMPDIR_GEN=$(mktemp -d)

# Test 1: Output file exists and contains all 6 skill bodies
bash "$PACKAGE_SKILLS" generic --source "$SKILLS_SRC" --out "$TMPDIR_GEN/system-prompt.txt"
assert "generic: output file exists" test -f "$TMPDIR_GEN/system-prompt.txt"
assert_contains "generic: contains developer-loop" "$TMPDIR_GEN/system-prompt.txt" "# anyraven-developer-loop"
assert_contains "generic: contains build-feature" "$TMPDIR_GEN/system-prompt.txt" "# anyraven-build-feature"
assert_contains "generic: contains canonical-example" "$TMPDIR_GEN/system-prompt.txt" "# anyraven-canonical-example"
assert_contains "generic: contains style-guide" "$TMPDIR_GEN/system-prompt.txt" "# anyraven-style-guide"
assert_contains "generic: contains refactor" "$TMPDIR_GEN/system-prompt.txt" "# anyraven-refactor"
assert_contains "generic: contains describe-version" "$TMPDIR_GEN/system-prompt.txt" "# anyraven-describe-version"

# Test 2: No frontmatter in output
assert_not_contains "generic: no frontmatter" "$TMPDIR_GEN/system-prompt.txt" "^skill_version:"

# Test 3: Preamble present
assert_contains "generic: preamble line 1" "$TMPDIR_GEN/system-prompt.txt" "# AnyRaven Agent System Prompt"
assert_contains "generic: preamble line 2" "$TMPDIR_GEN/system-prompt.txt" "Combined skill suite"

# Test 4: Re-run overwrites cleanly
bash "$PACKAGE_SKILLS" generic --source "$SKILLS_SRC" --out "$TMPDIR_GEN/system-prompt.txt"
preamble_count=$(grep -c "# AnyRaven Agent System Prompt" "$TMPDIR_GEN/system-prompt.txt" || true)
assert "generic: re-run overwrites (1 preamble)" test "$preamble_count" -eq 1

# Test 5: Correct order (developer-loop first, describe-version last)
first_skill=$(grep "^# anyraven-" "$TMPDIR_GEN/system-prompt.txt" | head -1)
last_skill=$(grep "^# anyraven-" "$TMPDIR_GEN/system-prompt.txt" | tail -1)
assert "generic: first skill is developer-loop" test "$first_skill" = "# anyraven-developer-loop"
assert "generic: last skill is describe-version" test "$last_skill" = "# anyraven-describe-version"

# ────────────────────────────────────────────────────────────────
echo ""
echo "=== Results ==="
echo "Passed: $pass"
echo "Failed: $fail"

if [ "$fail" -gt 0 ]; then
  exit 1
fi
