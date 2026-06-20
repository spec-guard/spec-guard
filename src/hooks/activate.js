#!/usr/bin/env node
'use strict';

// spec-guard — SessionStart activation hook.
//
// Runs on every session start:
//   1. Resolves default mode (on/off) from config/env.
//   2. If 'off' — removes the flag (statusline hides the badge) and emits nothing.
//   3. If 'on'  — writes the flag (statusline shows [SPEC-GUARD]) and emits the
//      spec-guard governance ruleset as hidden SessionStart context, so the
//      spec-driven workflow is active from the first message — no command needed.
//
// Reads SKILL.md at runtime so edits to the source of truth propagate automatically
// (no hardcoded duplication to go stale).
//
// Phase 2 extends skill-path resolution to walk up from the session CWD to the nearest
// `.spec-guard/config.json` and inject the per-repo rendered skill (with that repo's
// ${specDir}); if a repo config is found but its rendered skill is missing, it warns and
// falls back to the global skill rather than silently injecting the wrong spec dir.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultMode, safeWriteFlag, removeFlag, getFlagPath } = require('./config');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath = getFlagPath();
const skillPath = path.join(claudeDir, 'skills', 'spec-guard', 'SKILL.md');

const mode = getDefaultMode();

if (mode === 'off') {
  removeFlag(flagPath);
  process.stdout.write('OK');
  process.exit(0);
}

safeWriteFlag(flagPath, 'on');

let skillContent = '';
try {
  skillContent = fs.readFileSync(skillPath, 'utf8');
} catch (e) {
  process.stdout.write(
    'SPEC-GUARD ACTIVE\n\n' +
      'Prime directive: Context before code. Spec before edits. Verify against the spec, not the vibe.\n' +
      'For any non-trivial change (feature, refactor touching >1 file, schema/API/contract/event change, ' +
      'bugfix in load-bearing code): ORIENT (read repo CLAUDE.md + governing doc/ADR) -> SPEC -> PLAN -> ' +
      'BUILD -> VERIFY -> SYNC. Trivial edits skip the loop but still obey anti-regression invariants.'
  );
  process.exit(0);
}

const body = skillContent.replace(/^---[\s\S]*?---\s*/, '');

const output =
  'SPEC-GUARD ACTIVE — governance gate engaged for this session.\n\n' +
  'This loads automatically every session (no command needed). Apply it to any non-trivial ' +
  'code work BEFORE writing code. Persistence: stays active across the whole session, including ' +
  'after context compression. The reference files named below load on demand. ' +
  'To turn it off: run "spec-guard off" (persists across sessions); "spec-guard on" re-enables.\n\n' +
  body;

process.stdout.write(output);
