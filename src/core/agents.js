'use strict';

// Per-agent path matrix. Adding an agent = adding a row here + an overlay under
// templates/agents/<id>/. Everything else (render, install, manifest) is generic.
//
// Scopes:
//   - 'repo'  -> path is under the target repo root (per-repo install via `init`)
//   - 'home'  -> path is under the user's home agent dir (machine install via `setup`)
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
    displayName: 'Claude Code',
    skill: { scope: 'repo', dir: '.claude/skills/spec-guard' },
    globalSkillDir: '.claude/skills/spec-guard', // under home, the fallback skill
    commands: { dir: '.claude/commands/spec', format: 'claude-md', namespaced: true },
    rulesFile: 'CLAUDE.md',
    hooks: { kind: 'claude-settings', scope: 'home', configPath: '.claude/settings.json', events: ['SessionStart', 'Stop'] },
    capabilities: {
      support: 'complete',
      activation: 'home-session-hook',
      invocation: 'slash-commands',
      sessionHooks: true,
      repoScopedSkill: true,
      homeScopedSkill: true,
      statusline: true,
      notes: 'Repo skill and commands are installed by init; setup wires machine hooks and the statusline.',
    },
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    skill: { scope: 'home', dir: '.codex/skills/spec-guard' },
    globalSkillDir: '.codex/skills/spec-guard',
    commands: null, // v0.1.0: skills + hooks only, natural-language invocation
    rulesFile: 'AGENTS.md',
    hooks: { kind: 'codex-hooks', scope: 'home', configPath: '.codex/hooks.json', events: ['SessionStart', 'Stop'] },
    capabilities: {
      support: 'partial',
      activation: 'home-session-hook',
      invocation: 'natural-language',
      sessionHooks: true,
      repoScopedSkill: false,
      homeScopedSkill: true,
      statusline: false,
      notes: 'Codex has no file-backed slash commands; init records repo rules, while setup owns the home-scoped skill and hooks.',
    },
  },
  'github-copilot': {
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    skill: { scope: 'repo', dir: '.github/skills/spec-guard' },
    commands: { dir: '.github/prompts', format: 'copilot-prompt' },
    rulesFile: '.github/copilot-instructions.md',
    hooks: { kind: 'copilot', scope: 'home', configPath: null, events: [] },
    capabilities: {
      support: 'instructional',
      activation: 'project-memory',
      invocation: 'prompt-files',
      sessionHooks: false,
      repoScopedSkill: true,
      homeScopedSkill: false,
      statusline: false,
      notes: 'Copilot has no lifecycle hooks in spec-guard; governance rides instructions and prompt files.',
    },
  },
  opencode: {
    // opencode.ai (terminal agent). Also covers OpenWork, which is powered by opencode and
    // shares its conventions (AGENTS.md + .opencode/). Always-on governance rides AGENTS.md
    // (opencode's project-memory file); no separate lifecycle hook in v1.
    id: 'opencode',
    displayName: 'opencode',
    skill: { scope: 'repo', dir: '.opencode/skills/spec-guard' },
    commands: { dir: '.opencode/commands', format: 'opencode-md' },
    rulesFile: 'AGENTS.md',
    hooks: { kind: 'none', scope: 'home', configPath: null, events: [] },
    capabilities: {
      support: 'instructional',
      activation: 'project-memory',
      invocation: 'custom-commands',
      sessionHooks: false,
      repoScopedSkill: true,
      homeScopedSkill: false,
      statusline: false,
      notes: 'opencode/OpenWork use AGENTS.md plus repo custom commands; no lifecycle hook is wired.',
    },
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini CLI',
    extension: true,
    extensionDir: '.gemini/extensions/spec-guard',
    skill: { scope: 'repo', dir: '.gemini/extensions/spec-guard/skills/spec-guard' },
    commands: { dir: '.gemini/extensions/spec-guard/commands/spec', format: 'gemini-toml', namespaced: true },
    rulesFile: 'GEMINI.md',
    hooks: { kind: 'gemini-extension', scope: 'repo', configPath: '.gemini/extensions/spec-guard/hooks/hooks.json', events: ['SessionStart', 'Stop'] },
    capabilities: {
      support: 'complete',
      activation: 'repo-extension-hook',
      invocation: 'slash-commands',
      sessionHooks: true,
      repoScopedSkill: true,
      homeScopedSkill: false,
      statusline: false,
      notes: 'Gemini is repo-scoped through a spec-guard extension with commands and extension hooks.',
    },
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

function capabilityRows() {
  return listAgents().map((id) => {
    const agent = get(id);
    return {
      id,
      name: agent.displayName || id,
      skillScope: agent.skill.scope,
      skillDir: agent.skill.dir,
      commands: agent.commands ? agent.commands.format : null,
      rulesFile: agent.rulesFile,
      hooks: agent.hooks ? agent.hooks.kind : 'none',
      hookScope: agent.hooks ? agent.hooks.scope : null,
      support: agent.capabilities && agent.capabilities.support,
      activation: agent.capabilities && agent.capabilities.activation,
      invocation: agent.capabilities && agent.capabilities.invocation,
      sessionHooks: !!(agent.capabilities && agent.capabilities.sessionHooks),
      notes: agent.capabilities && agent.capabilities.notes,
    };
  });
}

// Parse a comma-separated --agent value into a validated, de-duplicated list.
// Sugar (matching OpenSpec's `--tools`): `all` -> every known agent, `none` -> [].
function parseAgentList(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'all') return listAgents();
  if (raw === 'none') return [];
  const ids = raw
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
  capabilityRows,
  parseAgentList,
  resolveSkillDir,
  resolveCommandsDir,
  resolveRulesFile,
  resolveHooksConfigPath,
};
