#!/usr/bin/env bash
# spec-guard - Stop hook. Emits a SYNC reminder when functional code changed
# without a corresponding doc update. Runs after each agent turn.
#
# Fires only when:
#   - >=1 functional source file changed (non-test, non-migration Python/TS/JS)
#   - AND no docs updated (.claude/docs/ or docs/ or CLAUDE.md)
#
# Stays silent when:
#   - Only tests/migrations/configs changed
#   - At least one doc file was also updated (deliverable docs/, the IP knowledge base, or a
#     rules file). The IP dir is harness-agnostic and configurable; the common defaults plus
#     legacy .claude/docs are matched.
#   - Not in a git repo

PROJECT_DIR="${CLAUDE_CWD:-$(pwd)}"
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
HOOK_FORMAT="${SPEC_GUARD_HOOK_FORMAT:-}"

# Codex loads hook commands at session start. If `setup` updates hooks.json during the
# same session, the running process may still call this script without the new env var.
# Detect the Codex-installed copy so current sessions emit only JSON on stdout.
case "$SCRIPT_PATH" in
  */.codex/hooks/*) HOOK_FORMAT="${HOOK_FORMAT:-codex-silent}" ;;
esac

if ! git -C "$PROJECT_DIR" rev-parse --git-dir > /dev/null 2>&1; then
  exit 0
fi

ALL_CHANGED=$(git -C "$PROJECT_DIR" diff HEAD --name-only 2>/dev/null)
NEW_FILES=$(git -C "$PROJECT_DIR" ls-files --others --exclude-standard 2>/dev/null)
ALL_CHANGED=$(printf '%s\n%s' "$ALL_CHANGED" "$NEW_FILES" | sort -u | grep -v '^$')

# Functional code: Python/TS/JS/JSX - excluding tests, migrations, configs, scripts.
FUNC_CODE=$(echo "$ALL_CHANGED" | grep -E '\.(py|ts|tsx|js|jsx)$' | \
  grep -v -E '(test_|_test\.|\.test\.|\.spec\.|/tests/|/test/|alembic|versions/|\.config\.|scripts/)' | \
  head -10)

# Docs: deliverables (docs/) + IP knowledge base (.private/ .internal/ .ip/, legacy .claude/docs/)
# + any rules file (CLAUDE.md / AGENTS.md / GEMINI.md / copilot-instructions.md).
DOCS=$(echo "$ALL_CHANGED" | grep -E '(/docs/|^docs/|\.private/|\.internal/|\.ip/|\.claude/docs/|CLAUDE\.md|AGENTS\.md|GEMINI\.md|copilot-instructions\.md)' | head -1)

if [ -n "$FUNC_CODE" ] && [ -z "$DOCS" ]; then
  if [ "$HOOK_FORMAT" = "codex-json" ] || [ "$HOOK_FORMAT" = "codex-silent" ]; then
    printf '%s\n' '{}'
  else
    {
      echo "[SPEC-GUARD] Step 6 (SYNC) pending - functional code changed without docs."
      echo "Changed files:"
      echo "$FUNC_CODE" | sed 's/^/  /'
      echo "Check whether architecture docs, the relevant ADR, or CLAUDE.md need updating."
    }
  fi
elif [ "$HOOK_FORMAT" = "codex-json" ] || [ "$HOOK_FORMAT" = "codex-silent" ]; then
  printf '%s\n' '{}'
fi
