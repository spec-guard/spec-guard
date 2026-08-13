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
    assert.ok(!fs.existsSync(path.join(home, '.codex/skills/spec-guard/SKILL.md')),
      'repo init must not write the home-scoped Codex skill');

    sg(home, ['setup']);
    assert.ok(fs.existsSync(path.join(home, '.codex/skills/spec-guard/SKILL.md')),
      'setup owns the home-scoped Codex skill');
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
      '.opencode/skills/spec-guard/SKILL.md',
      '.gemini/extensions/spec-guard/skills/spec-guard/SKILL.md',
    ]) assert.ok(fs.existsSync(path.join(repo, f)), `missing ${f}`);
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.spec-guard/config.json'), 'utf8'));
    assert.ok(cfg.agents.includes('opencode') && cfg.agents.includes('gemini'), 'all agents recorded');
  } finally {
    cleanup();
  }
});

test('re-init with a different --agent unions with the existing config, never shrinks it (ADR 0011)', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code,codex,github-copilot,opencode,gemini']);
    // Simulates `doctor`'s own stale-hook repair hint: re-init naming just ONE agent.
    sg(home, ['init', repo, '--agent', 'gemini', '--force']);
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.spec-guard/config.json'), 'utf8'));
    assert.deepStrictEqual(
      cfg.agents.slice().sort(),
      ['claude-code', 'codex', 'gemini', 'github-copilot', 'opencode'],
      'naming one agent on re-init must not drop the others'
    );
    for (const f of [
      '.claude/skills/spec-guard/SKILL.md',
      '.github/skills/spec-guard/SKILL.md',
      '.opencode/skills/spec-guard/SKILL.md',
    ]) assert.ok(fs.existsSync(path.join(repo, f)), `${f} must survive the single-agent re-init`);

    // Bare re-init (no --agent at all, defaults to claude-code non-interactively) must also be a no-op.
    sg(home, ['init', repo]);
    const cfg2 = JSON.parse(fs.readFileSync(path.join(repo, '.spec-guard/config.json'), 'utf8'));
    assert.deepStrictEqual(cfg2.agents.slice().sort(), ['claude-code', 'codex', 'gemini', 'github-copilot', 'opencode']);
  } finally {
    cleanup();
  }
});

test('a bare non-interactive re-init does not silently add the claude-code default', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'codex']);
    // No --agent this time, and no TTY (this is `execFileSync`) — must re-sync `codex` only,
    // never grow in claude-code as a side effect of the silent non-interactive default.
    sg(home, ['init', repo]);
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.spec-guard/config.json'), 'utf8'));
    assert.deepStrictEqual(cfg.agents, ['codex'], 'bare re-init must not add the claude-code default');
  } finally {
    cleanup();
  }
});

test('a fresh init is unaffected by the re-init merge (agents = exactly what was resolved)', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'codex']);
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.spec-guard/config.json'), 'utf8'));
    assert.deepStrictEqual(cfg.agents, ['codex']);
  } finally {
    cleanup();
  }
});

test('codex init does not let one repo clobber the home-scoped skill for another repo', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-home-'));
  const repoA = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-repo-a-'));
  const repoB = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-repo-b-'));
  try {
    sg(home, ['init', repoA, '--agent', 'codex', '--spec-dir', 'docs/specs-a']);
    assert.ok(!fs.existsSync(path.join(home, '.codex/skills/spec-guard/SKILL.md')),
      'codex init alone must not write a repo-specific home skill');
    assert.match(fs.readFileSync(path.join(repoA, 'AGENTS.md'), 'utf8'), /docs\/specs-a/);

    sg(home, ['setup']);
    const afterSetup = fs.readFileSync(path.join(home, '.codex/skills/spec-guard/SKILL.md'), 'utf8');

    sg(home, ['init', repoB, '--agent', 'codex', '--spec-dir', 'docs/specs-b']);
    const afterRepoB = fs.readFileSync(path.join(home, '.codex/skills/spec-guard/SKILL.md'), 'utf8');

    assert.strictEqual(afterRepoB, afterSetup, 'second repo init must not rewrite the global Codex skill');
    assert.match(fs.readFileSync(path.join(repoB, 'AGENTS.md'), 'utf8'), /docs\/specs-b/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

test('init --with-global refreshes machine wiring even when the global manifest is partial', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    fs.mkdirSync(path.join(home, '.config/spec-guard'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.config/spec-guard/manifest.json'),
      JSON.stringify({ version: 1, files: { 'global:claude-code:hooks:hookbundle:activate.js': { hash: 'old' } } }, null, 2) + '\n'
    );

    sg(home, ['init', repo, '--agent', 'codex', '--with-global']);

    assert.ok(fs.existsSync(path.join(home, '.codex/skills/spec-guard/SKILL.md')),
      'explicit --with-global must create the Codex home skill even with a partial manifest');
    const hooks = JSON.parse(fs.readFileSync(path.join(home, '.codex/hooks.json'), 'utf8'));
    assert.strictEqual(jm.countOwned(hooks, 'SessionStart'), 1);
    assert.strictEqual(jm.countOwned(hooks, 'Stop'), 1);
  } finally {
    cleanup();
  }
});

// Regression: the "already wired" gate only checked that the global manifest was non-empty, so a
// claude-code-only manifest made `init --agent codex` (no flag) claim the machine was wired and
// skip the setup pointer for the genuinely-unwired agent.
test('init without --with-global does not claim "already wired" for an unwired agent', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    fs.mkdirSync(path.join(home, '.config/spec-guard'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.config/spec-guard/manifest.json'),
      JSON.stringify({ version: 1, files: { 'global:claude-code:hooks:hookbundle:activate.js': { hash: 'old' } } }, null, 2) + '\n'
    );

    const out = sg(home, ['init', repo, '--agent', 'codex']);
    assert.doesNotMatch(out, /already wired/, 'a claude-only manifest must not read as wired for codex');
    assert.match(out, /run 'specguard setup'/, 'must point at setup for the missing codex wiring');
    assert.ok(!fs.existsSync(path.join(home, '.codex/skills/spec-guard/SKILL.md')),
      'non-interactive init must still never wire the machine silently');

    // A separate, fresh repo whose only configured agent (claude-code) IS covered by the manifest
    // (re-initing `repo` itself here would union in the already-configured `codex`, which is NOT
    // wired, and correctly stop claiming "already wired" — that's ADR 0011's merge, not this bug).
    const repo2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-repo-'));
    try {
      const out2 = sg(home, ['init', repo2, '--agent', 'claude-code']);
      assert.match(out2, /already wired/, 'agents covered by the manifest still report already wired');
    } finally {
      fs.rmSync(repo2, { recursive: true, force: true });
    }
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

test('doctor reports per-agent incomplete installs without implying hooks for every agent', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'codex']);
    let d = sgStatus(home, ['doctor', repo]);
    assert.strictEqual(d.status, 0);
    assert.match(d.stdout, /agent health:/);
    assert.match(d.stdout, /codex: warning \(partial; home-scoped skill\).*hooks missing/);

    sg(home, ['setup']);
    d = sgStatus(home, ['doctor', repo]);
    assert.strictEqual(d.status, 0);
    assert.match(d.stdout, /codex: ok \(partial; home-scoped skill; hooks wired\)/);

    const hooksPath = path.join(home, '.codex/hooks.json');
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    hooks.hooks.Stop[0].hooks[0].command = 'bash "/old/.codex/hooks/spec-guard/sync-check.sh"';
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + '\n');

    d = sgStatus(home, ['doctor', repo]);
    assert.strictEqual(d.status, 0);
    assert.match(d.stdout, /codex: warning \(partial; home-scoped skill\).*hooks stale \(Stop; run: specguard setup\)/);
    assert.strictEqual(sgStatus(home, ['doctor', '--quiet']).status, 1, 'machine check fails on stale global hook');

    sg(home, ['setup', '--force']);
    const syncCheck = path.join(home, '.codex/hooks/spec-guard/sync-check.sh');
    fs.writeFileSync(syncCheck, '#!/usr/bin/env bash\necho old text\n');
    d = sgStatus(home, ['doctor', repo]);
    assert.strictEqual(d.status, 0);
    assert.match(d.stdout, /codex: warning \(partial; home-scoped skill\).*hook bundle stale \(run: specguard setup --force\)/);
    assert.strictEqual(sgStatus(home, ['doctor', '--quiet']).status, 1, 'machine check fails on stale hook bundle');
  } finally {
    cleanup();
  }
});

test('doctor gives repo-scoped repair hint for stale Gemini hooks', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'gemini']);
    let d = sgStatus(home, ['doctor', repo]);
    assert.strictEqual(d.status, 0);
    assert.match(d.stdout, /gemini: ok \(complete; repo-scoped skill; hooks wired\)/);

    const hooksPath = path.join(repo, '.gemini/extensions/spec-guard/hooks/hooks.json');
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    hooks.hooks.Stop[0].hooks[0].command = 'bash "/old/.gemini/extensions/spec-guard/hooks/spec-guard/sync-check.sh"';
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + '\n');

    d = sgStatus(home, ['doctor', repo]);
    assert.strictEqual(d.status, 0);
    assert.match(d.stdout, /gemini: warning \(complete; repo-scoped skill\).*hooks stale \(Stop; run: specguard init <repo> --agent gemini\)/);
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

test('uninstall --agent <x> removes that agent from config.json too, not just its files', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code,codex,gemini']);

    sg(home, ['uninstall', repo, '--agent', 'gemini']);

    assert.ok(!fs.existsSync(path.join(repo, '.gemini/extensions/spec-guard')), 'gemini files removed');
    assert.ok(fs.existsSync(path.join(repo, '.spec-guard/config.json')), 'control dir kept for a scoped uninstall');
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.spec-guard/config.json'), 'utf8'));
    assert.deepStrictEqual(cfg.agents.slice().sort(), ['claude-code', 'codex'],
      'gemini must be dropped from config.agents, not just have its files removed');

    // doctor's repo line reflects config.agents directly; the untouched agents stay configured
    const d = sgStatus(home, ['doctor', repo]);
    assert.match(d.stdout, /agents=claude-code,codex\)/);
    assert.doesNotMatch(d.stdout, /gemini/, 'doctor should no longer even mention the removed agent');
  } finally {
    cleanup();
  }
});

test('uninstall --agent <x> --dry-run previews the config.json update without writing it', () => {
  const { home, repo, cleanup } = sandbox();
  try {
    sg(home, ['init', repo, '--agent', 'claude-code,gemini']);
    const before = fs.readFileSync(path.join(repo, '.spec-guard/config.json'), 'utf8');

    const out = sg(home, ['uninstall', repo, '--agent', 'gemini', '--dry-run']);
    assert.match(out, /agents: \[claude-code\]/);

    assert.strictEqual(fs.readFileSync(path.join(repo, '.spec-guard/config.json'), 'utf8'), before, 'dry-run must not write');
    assert.ok(fs.existsSync(path.join(repo, '.gemini/extensions/spec-guard')), 'dry-run must not remove files either');
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

// removed: update command is no longer user-facing (auto-update on session start)

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

// removed: update command is no longer user-facing (auto-update on session start)

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
