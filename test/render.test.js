'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const render = require('../src/core/render.js');
const agents = require('../src/core/agents.js');

test('substitute replaces known vars and leaves unknown intact', () => {
  assert.strictEqual(render.substitute('a ${specDir} b', { specDir: 'docs/specs' }), 'a docs/specs b');
  assert.strictEqual(render.substitute('x ${nope} y', {}), 'x ${nope} y');
});

test('renderSkill resolves ${specDir} and appends the agent overlay', () => {
  const out = render.renderSkill('claude-code', { specDir: 'docs/specs', plansDir: 'docs/plans' });
  assert.match(out, /docs\/specs/);
  assert.doesNotMatch(out, /\$\{specDir\}/); // fully substituted
  assert.match(out, /In Claude Code/); // overlay appended
  assert.doesNotMatch(out, /superpowers/); // stays decoupled
});

test('renderCommand emits the right filename + format per agent', () => {
  const tpl = path.join(render.PKG_ROOT, 'templates', 'commands', 'orient.md');
  const claude = render.renderCommand(tpl, 'claude-md', { specDir: 'docs/specs' });
  assert.strictEqual(claude.filename, 'orient.md');
  assert.match(claude.content, /^---\ndescription: /);

  const copilot = render.renderCommand(tpl, 'copilot-prompt', { specDir: 'docs/specs' });
  assert.strictEqual(copilot.filename, 'spec-orient.prompt.md');

  const gemini = render.renderCommand(tpl, 'gemini-toml', { specDir: 'docs/specs' });
  assert.strictEqual(gemini.filename, 'orient.toml');
  assert.match(gemini.content, /^description = ".*"\nprompt = """\n/);
  assert.match(gemini.content, /"""\n$/);
});

test('renderCommand routes the umbrella (/spec) to the namespace root per format', () => {
  const tpl = path.join(render.PKG_ROOT, 'templates', 'commands', 'spec.md');

  const claude = render.renderCommand(tpl, 'claude-md', {});
  assert.strictEqual(claude.filename, 'spec.md');
  assert.strictEqual(claude.umbrella, true);

  const gemini = render.renderCommand(tpl, 'gemini-toml', {});
  assert.strictEqual(gemini.filename, 'spec.toml');
  assert.strictEqual(gemini.umbrella, true);

  // flat-prefix agents drop the `spec-` prefix so it is /spec, not /spec-spec
  const copilot = render.renderCommand(tpl, 'copilot-prompt', {});
  assert.strictEqual(copilot.filename, 'spec.prompt.md');
  assert.strictEqual(copilot.umbrella, true);

  const opencode = render.renderCommand(tpl, 'opencode-md', {});
  assert.strictEqual(opencode.filename, 'spec.md');
  assert.strictEqual(opencode.umbrella, true);

  // a phase command is NOT flagged umbrella
  const orient = render.renderCommand(
    path.join(render.PKG_ROOT, 'templates', 'commands', 'orient.md'), 'claude-md', {});
  assert.ok(!orient.umbrella);
});

test('all agents are known and parseAgentList validates', () => {
  assert.deepStrictEqual(agents.listAgents().sort(), ['claude-code', 'codex', 'gemini', 'github-copilot', 'opencode']);
  assert.deepStrictEqual(
    agents.parseAgentList('claude-code, codex,gemini').sort(),
    ['claude-code', 'codex', 'gemini']
  );
  assert.throws(() => agents.parseAgentList('claude-code,bogus'), /unknown agent/);
});

test('path resolvers honor repo vs home scope', () => {
  const ctx = { repoRoot: '/repo', homeDir: '/home' };
  assert.strictEqual(agents.resolveSkillDir(agents.get('claude-code'), ctx), '/repo/.claude/skills/spec-guard');
  assert.strictEqual(agents.resolveSkillDir(agents.get('codex'), ctx), '/home/.codex/skills/spec-guard');
  assert.strictEqual(agents.resolveHooksConfigPath(agents.get('codex'), ctx), '/home/.codex/hooks.json');
  assert.strictEqual(agents.resolveHooksConfigPath(agents.get('github-copilot'), ctx), null);
  assert.strictEqual(
    agents.resolveHooksConfigPath(agents.get('gemini'), ctx),
    '/repo/.gemini/extensions/spec-guard/hooks/hooks.json'
  );
});
