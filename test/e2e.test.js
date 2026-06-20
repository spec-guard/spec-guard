'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'spec-guard.js');
const jm = require('../src/core/jsonmerge');

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-repo-'));
  return { home, repo, cleanup: () => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); } };
}

function sg(home, args) {
  return execFileSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { SPEC_GUARD_HOME: home }),
  });
}

test('init installs all four agents and global wiring is single-entry', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code,codex,github-copilot,gemini', '--spec-dir', 'docs/specs']);

    const expect = [
      path.join(repo, '.claude/skills/spec-guard/SKILL.md'),
      path.join(repo, '.claude/commands/spec/orient.md'),
      path.join(home, '.codex/skills/spec-guard/SKILL.md'),
      path.join(repo, '.github/skills/spec-guard/SKILL.md'),
      path.join(repo, '.github/prompts/spec-orient.prompt.md'),
      path.join(repo, '.gemini/extensions/spec-guard/skills/spec-guard/SKILL.md'),
      path.join(repo, '.gemini/extensions/spec-guard/commands/spec/orient.toml'),
      path.join(repo, 'CLAUDE.md'),
      path.join(repo, 'AGENTS.md'),
      path.join(repo, '.github/copilot-instructions.md'),
      path.join(repo, 'GEMINI.md'),
    ];
    for (const f of expect) assert.ok(fs.existsSync(f), `missing ${f}`);

    // rendered content: specDir substituted, no leaks
    const skill = fs.readFileSync(path.join(repo, '.claude/skills/spec-guard/SKILL.md'), 'utf8');
    assert.match(skill, /docs\/specs/);
    assert.doesNotMatch(skill, /\$\{specDir\}/);
    assert.doesNotMatch(skill, /superpowers/);

    sg(home, ['install', '--global']);
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'));
    assert.strictEqual(jm.countOwned(settings, 'SessionStart'), 1);
    assert.strictEqual(jm.countOwned(settings, 'Stop'), 1);
    assert.ok(settings.statusLine && /statusline-combined/.test(settings.statusLine.command));
    const codex = JSON.parse(fs.readFileSync(path.join(home, '.codex/hooks.json'), 'utf8'));
    assert.strictEqual(jm.countOwned(codex, 'SessionStart'), 1);
    assert.strictEqual(jm.countOwned(codex, 'Stop'), 1);
  } finally {
    cleanup();
  }
});

test('install --global preserves co-tenant hooks and collapses a legacy entry (no double-injection)', () => {
  const { home, cleanup } = sandbox();
  try {
    // Seed a settings.json with caveman + a legacy unmarked spec-guard entry at an OLD path.
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.claude/settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [
              { type: 'command', command: 'node "/x/caveman-activate.js"' },
              { type: 'command', command: 'node "/x/.claude/hooks/spec-guard-activate.js"' },
            ] },
          ],
        },
      }, null, 2)
    );

    sg(home, ['install', '--global']);
    const s = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'));
    const cmds = s.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes('caveman')), 'caveman preserved');
    assert.strictEqual(jm.countOwned(s, 'SessionStart'), 1, 'exactly one spec-guard entry');
    assert.ok(!cmds.some((c) => c.includes('spec-guard-activate.js')), 'legacy path replaced');
  } finally {
    cleanup();
  }
});

test('install --global is idempotent', () => {
  const { home, cleanup } = sandbox();
  try {
    sg(home, ['install', '--global']);
    const out = sg(home, ['install', '--global']);
    assert.match(out, /SessionStart noop/);
  } finally {
    cleanup();
  }
});

test('update protects a user-edited owned file with a sidecar', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code', '--spec-dir', 'docs/specs']);
    const skillFile = path.join(repo, '.claude/skills/spec-guard/SKILL.md');
    fs.writeFileSync(skillFile, 'I hand-edited this skill\n');
    sg(home, ['update', repo]);
    assert.strictEqual(fs.readFileSync(skillFile, 'utf8'), 'I hand-edited this skill\n', 'original preserved');
    assert.ok(fs.existsSync(skillFile + '.spec-guard-update'), 'sidecar written');
  } finally {
    cleanup();
  }
});
