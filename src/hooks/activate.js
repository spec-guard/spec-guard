#!/usr/bin/env node
'use strict';

// spec-guard — SessionStart activation hook.
//
// Runs on every session start:
//   1. Resolves default mode (on/off) from config/env.
//   2. If 'off' — removes the flag (statusline hides the badge) and emits nothing.
//   3. If 'on'  — writes the flag (statusline shows [SPEC-GUARD]) and emits the spec-guard
//      governance ruleset as hidden SessionStart context, so the spec-driven workflow is
//      active from the first message.
//
// Skill-path resolution (in order):
//   a. Per-repo rendered skill: walk up from the session CWD to the nearest
//      `.spec-guard/config.json`; if found, use that repo's rendered skill (carrying its
//      ${specDir}). If a repo config IS found but its rendered skill is missing, warn and
//      fall through to the global skill — never silently inject the wrong spec dir.
//   b. The global skill installed next to this hook bundle (<agentRoot>/skills/spec-guard).
//   c. CLAUDE_CONFIG_DIR / ~/.claude global skill (back-compat).
//   d. A hardcoded one-paragraph fallback.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getDefaultMode, safeWriteFlag, removeFlag, getFlagPath } = require('./config');

const PREAMBLE =
  'SPEC-GUARD ACTIVE — governance gate engaged for this session.\n\n' +
  'This loads automatically every session (no command needed). Apply it to any non-trivial ' +
  'code work BEFORE writing code. Persistence: stays active across the whole session, including ' +
  'after context compression. The reference files named below load on demand. ' +
  'To turn it off: run "specguard off" (persists across sessions); "specguard on" re-enables.\n\n';

const FALLBACK =
  'SPEC-GUARD ACTIVE\n\n' +
  'Prime directive: Context before code. Spec before edits. Verify against the spec, not the vibe.\n' +
  'For any non-trivial change (feature, refactor touching >1 file, schema/API/contract/event change, ' +
  'bugfix in load-bearing code): ORIENT (read repo CLAUDE.md + governing doc/ADR) -> SPEC -> PLAN -> ' +
  'BUILD -> VERIFY -> SYNC. Trivial edits skip the loop but still obey anti-regression invariants.';

const GLOBAL_SKILL_DIR = path.resolve(__dirname, '..', '..', 'skills', 'spec-guard');
const REPO_SKILL_REL = '.claude/skills/spec-guard';

function hashContent(content) {
  return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');
}

function tryAutoUpdate(repoRoot) {
  const manifestPath = path.join(repoRoot, '.spec-guard', 'manifest.json');
  let m;
  try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (e) { return null; }

  let refs = [];
  try { refs = fs.readdirSync(path.join(GLOBAL_SKILL_DIR, 'references')).map(f => 'references/' + f); }
  catch (e) { return null; }
  const allFiles = ['SKILL.md', ...refs];

  let updated = 0, protectedCount = 0;
  for (const rel of allFiles) {
    const key = 'repo:claude-code:skill:' + rel;
    const globalPath = path.join(GLOBAL_SKILL_DIR, rel);
    const repoPath = path.join(repoRoot, REPO_SKILL_REL, rel);

    let newContent;
    try { newContent = fs.readFileSync(globalPath, 'utf8'); }
    catch (e) { continue; }

    const newHash = hashContent(newContent);
    const recorded = m.files[key] && m.files[key].hash;

    let currentContent = null;
    try { currentContent = fs.readFileSync(repoPath, 'utf8'); } catch (e) {}

    // User-edited: current hash differs from recorded → protect
    if (currentContent !== null && recorded && hashContent(currentContent) !== recorded) {
      protectedCount++;
      continue;
    }

    // Already current
    if (currentContent !== null && hashContent(currentContent) === newHash) continue;

    // Update
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });
    fs.writeFileSync(repoPath, newContent);
    m.files[key] = { hash: newHash };
    updated++;
  }

  if (updated > 0) {
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
  }

  return { updated, protectedCount };
}

const REPO_SKILL_LOCATIONS = [
  '.claude/skills/spec-guard/SKILL.md',
  '.github/skills/spec-guard/SKILL.md',
  '.gemini/extensions/spec-guard/skills/spec-guard/SKILL.md',
];

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (fs.statSync(path.join(dir, '.spec-guard', 'config.json')).isFile()) return dir;
    } catch (e) {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Returns { content, warn } — content is null if no skill file was found.
function resolveSkill(repoRoot) {
  // a. Per-repo
  if (repoRoot) {
    for (const rel of REPO_SKILL_LOCATIONS) {
      const p = path.join(repoRoot, rel);
      try {
        return { content: fs.readFileSync(p, 'utf8'), warn: null };
      } catch (e) {
        // try next location
      }
    }
  }

  // b. Sibling global (next to this hook bundle: <agentRoot>/hooks/spec-guard/ -> ../../skills/...)
  const sibling = path.resolve(__dirname, '..', '..', 'skills', 'spec-guard', 'SKILL.md');
  try {
    return { content: fs.readFileSync(sibling, 'utf8'), warn: null };
  } catch (e) {
    // c. CLAUDE_CONFIG_DIR global
  }

  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  try {
    return { content: fs.readFileSync(path.join(claudeDir, 'skills', 'spec-guard', 'SKILL.md'), 'utf8'), warn: null };
  } catch (e) {
    return { content: null, warn: null };
  }
}

function main() {
  const flagPath = getFlagPath();
  const mode = getDefaultMode();

  if (mode === 'off') {
    removeFlag(flagPath);
    process.stdout.write('OK');
    return;
  }

  safeWriteFlag(flagPath, 'on');

  const repoRoot = findRepoRoot(process.env.CLAUDE_CWD || process.cwd());

  let autoUpdateNote = '';
  if (repoRoot) {
    const result = tryAutoUpdate(repoRoot);
    if (result && result.updated > 0) {
      if (result.protectedCount > 0) {
        autoUpdateNote = `Skill auto-updated (${result.updated} file${result.updated !== 1 ? 's' : ''} refreshed, ${result.protectedCount} user-edited file${result.protectedCount !== 1 ? 's' : ''} protected — review .spec-guard-update sidecars).\n\n`;
      } else {
        autoUpdateNote = `Skill auto-updated (${result.updated} file${result.updated !== 1 ? 's' : ''} refreshed).\n\n`;
      }
    }
  }

  const { content, warn } = resolveSkill(repoRoot);
  if (warn) process.stderr.write(warn);

  if (!content) {
    process.stdout.write(autoUpdateNote + FALLBACK);
    return;
  }
  const body = content.replace(/^---[\s\S]*?---\s*/, '');
  process.stdout.write(autoUpdateNote + PREAMBLE + body);
}

main();
