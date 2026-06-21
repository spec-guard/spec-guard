'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'specguard.js');
const jm = require('../src/core/jsonmerge');

function sgStatus(home, args) {
  const r = spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    // Neutralize XDG_CONFIG_HOME / APPDATA so the global config+manifest resolve under the
    // sandbox home regardless of the host environment (hermetic on any CI machine).
    env: Object.assign({}, process.env, { SPEC_GUARD_HOME: home, XDG_CONFIG_HOME: '', APPDATA: '' }),
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-repo-'));
  return { home, repo, cleanup: () => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); } };
}

function sg(home, args) {
  return execFileSync('node', [BIN, ...args], {
    encoding: 'utf8',
    // Neutralize XDG_CONFIG_HOME / APPDATA so the global config+manifest resolve under the
    // sandbox home regardless of the host environment (hermetic on any CI machine).
    env: Object.assign({}, process.env, { SPEC_GUARD_HOME: home, XDG_CONFIG_HOME: '', APPDATA: '' }),
  });
}

test('init installs all four agents and global wiring is single-entry', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code,codex,github-copilot,gemini', '--spec-dir', 'docs/specs']);

    const expect = [
      path.join(repo, '.claude/skills/spec-guard/SKILL.md'),
      path.join(repo, '.claude/commands/spec/orient.md'),
      path.join(repo, '.claude/commands/spec.md'), // bare /spec umbrella at namespace root
      path.join(home, '.codex/skills/spec-guard/SKILL.md'),
      path.join(repo, '.github/skills/spec-guard/SKILL.md'),
      path.join(repo, '.github/prompts/spec-orient.prompt.md'),
      path.join(repo, '.github/prompts/spec.prompt.md'), // /spec umbrella (flat)
      path.join(repo, '.gemini/extensions/spec-guard/skills/spec-guard/SKILL.md'),
      path.join(repo, '.gemini/extensions/spec-guard/commands/spec/orient.toml'),
      path.join(repo, '.gemini/extensions/spec-guard/commands/spec.toml'), // /spec umbrella
      path.join(repo, 'CLAUDE.md'),
      path.join(repo, 'AGENTS.md'),
      path.join(repo, '.github/copilot-instructions.md'),
      path.join(repo, 'GEMINI.md'),
    ];
    for (const f of expect) assert.ok(fs.existsSync(f), `missing ${f}`);

    // the umbrella must NOT be double-namespaced into the phase-command subdir
    assert.ok(!fs.existsSync(path.join(repo, '.claude/commands/spec/spec.md')),
      'umbrella must not land in the phase-command subdir');

    // rendered content: specDir substituted, no leaks
    const skill = fs.readFileSync(path.join(repo, '.claude/skills/spec-guard/SKILL.md'), 'utf8');
    assert.match(skill, /docs\/specs/);
    assert.doesNotMatch(skill, /\$\{specDir\}/);
    assert.doesNotMatch(skill, /superpowers/);

    sg(home, ['setup']);
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

    sg(home, ['setup']);
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
    sg(home, ['setup']);
    // Idempotent re-run reports the no-op concisely instead of re-printing the full wiring report.
    const out = sg(home, ['setup']);
    assert.match(out, /machine already set up \(nothing changed\)/);
  } finally {
    cleanup();
  }
});

test('greenfield --scaffold builds the doc tree; doctor wall clean + flags unfilled placeholders (exit 0)', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code', '--scaffold', '--spec-dir', 'docs/specs']);
    for (const f of ['docs/specs/README.md', 'docs/plans/README.md', 'docs/templates/spec-template.md', 'docs/architecture/code-architecture.md', 'docs/standards/error-handling.md', 'docs/standards/coding-guidelines.md', 'docs/database/schema-template.md', 'docs/observability/observability.md', 'CLAUDE.md', '.private/docs/troubleshootings', '.private/credentials', '.private/README.md']) {
      assert.ok(fs.existsSync(path.join(repo, f)), `missing ${f}`);
    }
    const d = sgStatus(home, ['doctor', repo]);
    assert.strictEqual(d.status, 0, 'doctor exit 0 on clean wall');
    assert.match(d.stdout, /wall: clean/);
    // The 4 fill-once convention docs carry the placeholder sentinel; doctor warns but never fails.
    assert.match(d.stdout, /scaffold: 4 convention doc\(s\) still hold the placeholder/);
    // Resolving one (redirect to a one-line pointer, dropping the sentinel) reduces the count; exit stays 0.
    fs.writeFileSync(path.join(repo, 'docs/standards/error-handling.md'), '# Error Handling\n\nSee [architecture/error-handling.md](../architecture/error-handling.md).\n');
    const d2 = sgStatus(home, ['doctor', repo]);
    assert.strictEqual(d2.status, 0, 'placeholder warning never changes exit code');
    assert.match(d2.stdout, /scaffold: 3 convention doc\(s\) still hold the placeholder/);
  } finally {
    cleanup();
  }
});

test('doctor exits 2 when a docs/ file hyperlinks into .claude/', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code']);
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/bad.md'), 'See [secret](../.claude/docs/x.md).\n');
    const d = sgStatus(home, ['doctor', repo]);
    assert.strictEqual(d.status, 2, 'wall violation -> exit 2');
    assert.match(d.stdout, /wall: 1 violation/);
  } finally {
    cleanup();
  }
});

test('init --private-dir is honored in config, scaffold tree, and the wall lint', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code', '--scaffold', '--private-dir', '.ip']);
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.spec-guard/config.json'), 'utf8'));
    assert.strictEqual(cfg.privateDir, '.ip', 'privateDir persisted to config');
    assert.ok(fs.existsSync(path.join(repo, '.ip/credentials')), 'scaffold uses custom privateDir');
    assert.ok(!fs.existsSync(path.join(repo, '.private')), 'default .private not created');

    // The wall lint should now flag docs/ links into the CUSTOM private dir.
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/bad.md'), 'See [x](../.ip/docs/x.md).\n');
    const d = sgStatus(home, ['doctor', repo]);
    assert.strictEqual(d.status, 2, 'wall violation against custom privateDir -> exit 2');
  } finally {
    cleanup();
  }
});

test('init --agent all installs every known agent', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'all']);
    for (const f of [
      '.claude/skills/spec-guard/SKILL.md',
      '.github/skills/spec-guard/SKILL.md',
      '.opencode/skill/spec-guard/SKILL.md',
      '.gemini/extensions/spec-guard/skills/spec-guard/SKILL.md',
    ]) assert.ok(fs.existsSync(path.join(repo, f)), `missing ${f}`);
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.spec-guard/config.json'), 'utf8'));
    assert.ok(cfg.agents.includes('opencode') && cfg.agents.includes('gemini'), 'all agents recorded');
  } finally {
    cleanup();
  }
});

test('init --with-global wires the machine in one shot (no separate setup)', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code', '--with-global']);
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'));
    assert.strictEqual(jm.countOwned(settings, 'SessionStart'), 1, 'SessionStart wired by init --with-global');
    assert.strictEqual(jm.countOwned(settings, 'Stop'), 1, 'Stop wired by init --with-global');
  } finally {
    cleanup();
  }
});

test('init (non-interactive, no flag) does NOT wire the machine silently', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code']);
    assert.ok(!fs.existsSync(path.join(home, '.claude/settings.json')), 'no machine mutation without --with-global on a non-TTY');
  } finally {
    cleanup();
  }
});

test('re-init after setup reports already-wired + already-initialized (no silent skips)', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code']);
    sg(home, ['setup']);
    const out = sg(home, ['init', repo, '--agent', 'claude-code']);
    assert.match(out, /machine hooks already wired/);
    assert.match(out, /already initialized/);
  } finally {
    cleanup();
  }
});

test('doctor --quiet (machine-check) fails before install, passes after', () => {
  const { home, cleanup } = sandbox();
  try {
    assert.strictEqual(sgStatus(home, ['doctor', '--quiet']).status, 1, 'no global install -> non-zero');
    sg(home, ['setup']);
    assert.strictEqual(sgStatus(home, ['doctor', '--quiet']).status, 0, 'after install -> zero');
  } finally {
    cleanup();
  }
});

test('brownfield init (no --scaffold) does not create a docs tree', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code']);
    assert.ok(!fs.existsSync(path.join(repo, 'docs/templates')), 'no scaffold without --scaffold');
  } finally {
    cleanup();
  }
});

test('self-dogfood: init in an @spec-guard/cli repo skips the rules-block', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: '@spec-guard/cli' }));
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# handcrafted\n');
    sg(home, ['init', repo, '--agent', 'codex']);
    const agentsMd = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
    assert.strictEqual(agentsMd, '# handcrafted\n', 'AGENTS.md untouched in self-dogfood');
  } finally {
    cleanup();
  }
});

test('uninstall removes owned files, strips the rules block, and keeps user content', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code,gemini', '--spec-dir', 'docs/specs']);
    // user authored content around our managed block + their own spec
    const claudeMd = path.join(repo, 'CLAUDE.md');
    fs.writeFileSync(claudeMd, '# My Project\n\nHand-written rules.\n\n' + fs.readFileSync(claudeMd, 'utf8'));
    fs.mkdirSync(path.join(repo, 'docs/specs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/specs/0001-mine.md'), '# my spec\n');

    sg(home, ['uninstall', repo]);

    // owned artifacts gone
    for (const f of [
      '.claude/skills/spec-guard', '.claude/commands/spec', '.claude/commands/spec.md',
      '.gemini/extensions/spec-guard', '.spec-guard',
    ]) assert.ok(!fs.existsSync(path.join(repo, f)), `should be removed: ${f}`);

    // rules block stripped, user content preserved
    const md = fs.readFileSync(claudeMd, 'utf8');
    assert.match(md, /# My Project/);
    assert.match(md, /Hand-written rules\./);
    assert.doesNotMatch(md, /spec-guard:start/);

    // user docs untouched
    assert.ok(fs.existsSync(path.join(repo, 'docs/specs/0001-mine.md')), 'user spec preserved');
  } finally {
    cleanup();
  }
});

test('uninstall --dry-run changes nothing', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code']);
    const out = sg(home, ['uninstall', repo, '--dry-run']);
    assert.match(out, /dry-run/);
    assert.ok(fs.existsSync(path.join(repo, '.claude/skills/spec-guard/SKILL.md')), 'still present after dry-run');
    assert.ok(fs.existsSync(path.join(repo, '.spec-guard')), '.spec-guard still present after dry-run');
  } finally {
    cleanup();
  }
});

test('uninstall --global unwires hooks and preserves co-tenant entries', () => {
  const { home, cleanup } = sandbox();
  try {
    // seed a co-tenant hook
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude/settings.json'),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "/x/caveman.js"' }] }] } }, null, 2));

    sg(home, ['setup']);
    let s = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'));
    assert.strictEqual(jm.countOwned(s, 'SessionStart'), 1, 'installed');

    sg(home, ['uninstall', '--global']);
    s = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'));
    assert.strictEqual(jm.countOwned(s, 'SessionStart'), 0, 'spec-guard SessionStart unwired');
    assert.strictEqual(jm.countOwned(s, 'Stop'), 0, 'spec-guard Stop unwired');
    const cmds = (s.hooks && s.hooks.SessionStart ? s.hooks.SessionStart : []).flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes('caveman')), 'co-tenant caveman preserved');

    // global skill + hook bundle removed
    assert.ok(!fs.existsSync(path.join(home, '.claude/skills/spec-guard')), 'global skill removed');
    assert.ok(!fs.existsSync(path.join(home, '.claude/hooks/spec-guard')), 'hook bundle removed');
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

test('init is honest on re-run: re-rendered, not "installed into"', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    const first = sg(home, ['init', repo, '--agent', 'claude-code']);
    assert.match(first, /installed into/, 'fresh install says installed into');

    const second = sg(home, ['init', repo, '--agent', 'claude-code']);
    assert.match(second, /re-rendered/, 're-run says re-rendered');
    assert.match(second, /already initialized/);
    assert.doesNotMatch(second, /installed into/, 're-run must not claim a fresh install');
  } finally {
    cleanup();
  }
});

test('update with nothing to change says "already up to date"', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    // Include gemini: its hooks.json write must also be idempotent (a literal "wired" verb would
    // mask a no-op re-run and wrongly print "update complete").
    sg(home, ['init', repo, '--agent', 'claude-code,gemini']);
    // init just wrote every owned file, so an immediate update changes nothing.
    const out = sg(home, ['update', repo]);
    assert.match(out, /already up to date — nothing to re-render/);
    assert.doesNotMatch(out, /update complete/);
  } finally {
    cleanup();
  }
});

test('setup is honest on re-run: "machine already set up (nothing changed)"', () => {
  const { home, cleanup } = sandbox();
  try {
    const first = sg(home, ['setup']);
    assert.match(first, /machine setup/, 'first run wires and reports');

    const second = sg(home, ['setup']);
    assert.match(second, /machine already set up \(nothing changed\)/);
    assert.doesNotMatch(second, /you may delete them now/, 'loose-files note suppressed when nothing changed');
  } finally {
    cleanup();
  }
});
