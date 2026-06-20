'use strict';

// Per-agent path matrix. Adding an agent = adding a row here + an overlay under
// templates/agents/<id>/. Everything else (render, install, manifest) is generic.
//
// Scopes:
//   - 'repo'  -> path is under the target repo root (per-repo install via `init`)
//   - 'home'  -> path is under the user's home agent dir (machine install via `install --global`)
//
// Hook config kinds:
//   - 'claude-settings'  -> ~/.claude/settings.json  (SessionStart + Stop + statusLine)
//   - 'codex-hooks'      -> ~/.codex/hooks.json      (SessionStart + Stop)
//   - 'gemini-extension' -> <repo>/.gemini/extensions/spec-guard/hooks/hooks.json
//   - 'copilot'          -> no standardized hook config yet; governance rides the rules-file block

const path = require('path');

const AGENTS = {
  'claude-code': {
    id: 'claude-code',
    skill: { scope: 'repo', dir: '.claude/skills/spec-guard' },
    globalSkillDir: '.claude/skills/spec-guard', // under home, the fallback skill
    commands: { dir: '.claude/commands/spec', format: 'claude-md' },
    rulesFile: 'CLAUDE.md',
    hooks: { kind: 'claude-settings', scope: 'home', configPath: '.claude/settings.json', events: ['SessionStart', 'Stop'] },
  },
  codex: {
    id: 'codex',
    skill: { scope: 'home', dir: '.codex/skills/spec-guard' },
    globalSkillDir: '.codex/skills/spec-guard',
    commands: null, // v0.1.0: skills + hooks only, natural-language invocation
    rulesFile: 'AGENTS.md',
    hooks: { kind: 'codex-hooks', scope: 'home', configPath: '.codex/hooks.json', events: ['SessionStart', 'Stop'] },
  },
  'github-copilot': {
    id: 'github-copilot',
    skill: { scope: 'repo', dir: '.github/skills/spec-guard' },
    commands: { dir: '.github/prompts', format: 'copilot-prompt' },
    rulesFile: '.github/copilot-instructions.md',
    hooks: { kind: 'copilot', scope: 'home', configPath: null, events: [] },
  },
  gemini: {
    id: 'gemini',
    extension: true,
    extensionDir: '.gemini/extensions/spec-guard',
    skill: { scope: 'repo', dir: '.gemini/extensions/spec-guard/skills/spec-guard' },
    commands: { dir: '.gemini/extensions/spec-guard/commands/spec', format: 'gemini-toml' },
    rulesFile: 'GEMINI.md',
    hooks: { kind: 'gemini-extension', scope: 'repo', configPath: '.gemini/extensions/spec-guard/hooks/hooks.json', events: ['SessionStart', 'Stop'] },
  },
};

function listAgents() {
  return Object.keys(AGENTS);
}

function isKnown(id) {
  return Object.prototype.hasOwnProperty.call(AGENTS, id);
}

function get(id) {
  if (!isKnown(id)) throw new Error(`unknown agent: ${id}`);
  return AGENTS[id];
}

// Parse a comma-separated --agent value into a validated, de-duplicated list.
function parseAgentList(value) {
  const ids = String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = ids.filter((id) => !isKnown(id));
  if (unknown.length) throw new Error(`unknown agent(s): ${unknown.join(', ')}. Known: ${listAgents().join(', ')}`);
  return Array.from(new Set(ids));
}

function baseFor(scope, ctx) {
  return scope === 'home' ? ctx.homeDir : ctx.repoRoot;
}

// Absolute directory the agent's skill lives in (repo or home, per scope).
function resolveSkillDir(agent, ctx) {
  return path.join(baseFor(agent.skill.scope, ctx), agent.skill.dir);
}

function resolveCommandsDir(agent, ctx) {
  if (!agent.commands) return null;
  return path.join(ctx.repoRoot, agent.commands.dir);
}

function resolveRulesFile(agent, ctx) {
  return path.join(ctx.repoRoot, agent.rulesFile);
}

function resolveHooksConfigPath(agent, ctx) {
  if (!agent.hooks || !agent.hooks.configPath) return null;
  return path.join(baseFor(agent.hooks.scope, ctx), agent.hooks.configPath);
}

module.exports = {
  AGENTS,
  listAgents,
  isKnown,
  get,
  parseAgentList,
  resolveSkillDir,
  resolveCommandsDir,
  resolveRulesFile,
  resolveHooksConfigPath,
};
