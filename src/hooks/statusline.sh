#!/usr/bin/env bash
# spec-guard — statusline badge. Outputs [SPEC-GUARD] when the flag is present.
# Hardened: refuse symlinks, cap the read, whitelist the content.

FLAG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.spec-guard-active"

# Refuse symlinks — a local attacker could point the flag at a secret and have the
# statusline render its bytes (incl. ANSI escapes) every keystroke.
[ -L "$FLAG" ] && exit 0
[ ! -f "$FLAG" ] && exit 0

MODE=$(head -c 16 "$FLAG" 2>/dev/null | tr -d '\n\r' | tr '[:upper:]' '[:lower:]')
MODE=$(printf '%s' "$MODE" | tr -cd 'a-z')

case "$MODE" in
  on) printf '\033[38;5;78m[SPEC-GUARD]\033[0m' ;;
  *) exit 0 ;;
esac
