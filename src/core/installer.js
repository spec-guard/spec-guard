'use strict';

// Reusable install building blocks shared by `init` (per-repo) and `install --global`
// (machine). Everything goes through the manifest guard so re-runs are idempotent and never
// clobber user-edited files.

const fs = require('fs');
const path = require('path');

const render = require('./render');
const agents = require('./agents');
const manifest = require('./manifest');

const PKG_ROOT = render.PKG_ROOT;
const pkg = require(path.join(PKG_ROOT, 'package.json'));

function renderVars(settings) {
  return {
    specDir: (settings && settings.specDir) || 'docs/specs',
    plansDir: (settings && settings.plansDir) || 'docs/plans',
    ipDir: (settings && settings.ipDir) || '.private',
    version: pkg.version,
  };
}

// Write the rendered SKILL.md + all references into a skill directory.
function installSkillTree(skillDir, agentId, vars, m, keyspace, force) {
  const actions = [];
  actions.push(
    manifest.writeManaged({
      absPath: path.join(skillDir, 'SKILL.md'),
      content: render.renderSkill(agentId, vars),
      manifest: m,
      key: `${keyspace}:skill:SKILL.md`,
      force,
    })
  );
  for (const ref of render.listReferences()) {
    actions.push(
      manifest.writeManaged({
        absPath: path.join(skillDir, 'references', ref),
        content: render.renderReference(ref, vars),
        manifest: m,
        key: `${keyspace}:skill:references/${ref}`,
        force,
      })
    );
  }
  return actions;
}

// Write the per-agent command files (skips agents with no commands, e.g. codex).
function installCommands(agent, ctx, vars, m, keyspace, force) {
  if (!agent.commands) return [];
  const dir = agents.resolveCommandsDir(agent, ctx);
  const actions = [];
  for (const tpl of render.listCommandTemplates()) {
    const out = render.renderCommand(tpl, agent.commands.format, vars);
    actions.push(
      manifest.writeManaged({
        absPath: path.join(dir, out.filename),
        content: out.content,
        manifest: m,
        key: `${keyspace}:cmd:${agent.id}:${out.filename}`,
        force,
      })
    );
  }
  return actions;
}

// Write/refresh the managed rules-file block (CLAUDE.md / AGENTS.md / etc).
function installRulesBlock(agent, ctx, vars, m, keyspace, force) {
  const rulesblock = require('./rulesblock');
  const file = agents.resolveRulesFile(agent, ctx);
  return manifest.writeBlockManaged({
    absPath: file,
    body: rulesblock.buildBody(vars),
    manifest: m,
    key: `${keyspace}:rules:${agent.id}`,
    force,
  });
}

// Copy the self-contained runtime hook bundle into destDir (e.g. <agentRoot>/hooks/spec-guard/).
function copyHookBundle(destDir, m, keyspace, force) {
  fs.mkdirSync(destDir, { recursive: true });
  const files = [
    [path.join(PKG_ROOT, 'src', 'hooks', 'activate.js'), 'activate.js'],
    [path.join(PKG_ROOT, 'src', 'core', 'config.js'), 'config.js'],
    [path.join(PKG_ROOT, 'src', 'hooks', 'sync-check.sh'), 'sync-check.sh'],
    [path.join(PKG_ROOT, 'src', 'hooks', 'statusline.sh'), 'statusline.sh'],
  ];
  const actions = [];
  for (const [src, name] of files) {
    const abs = path.join(destDir, name);
    const r = manifest.writeManaged({
      absPath: abs,
      content: fs.readFileSync(src, 'utf8'),
      manifest: m,
      key: `${keyspace}:hookbundle:${name}`,
      force,
    });
    if (name.endsWith('.js') || name.endsWith('.sh')) {
      try { fs.chmodSync(abs, 0o755); } catch (e) {}
    }
    actions.push(r);
  }
  return actions;
}

function statuslineCombinedContent() {
  return [
    '#!/usr/bin/env bash',
    '# spec-guard managed: composite statusline (spec-guard + co-tenant badges).',
    'HOOKS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks"',
    'parts=()',
    'CV="$HOOKS/caveman-statusline.sh"',
    'SG="$HOOKS/spec-guard/statusline.sh"',
    '[ -x "$CV" ] && { b=$("$CV" 2>/dev/null); [ -n "$b" ] && parts+=("$b"); }',
    '[ -x "$SG" ] && { b=$("$SG" 2>/dev/null); [ -n "$b" ] && parts+=("$b"); }',
    "( IFS=' '; printf '%s' \"${parts[*]}\" )",
    '',
  ].join('\n');
}

// Gemini extension scaffolding: manifest + bundled hooks + hooks.json wiring.
function installGeminiExtension(agent, ctx, vars, m, keyspace, force) {
  const jsonmerge = require('./jsonmerge');
  const extDir = path.join(ctx.repoRoot, agent.extensionDir);
  const actions = [];

  // gemini-extension.json
  const tpl = fs.readFileSync(path.join(PKG_ROOT, 'templates', 'agents', 'gemini', 'gemini-extension.json'), 'utf8');
  actions.push(
    manifest.writeManaged({
      absPath: path.join(extDir, 'gemini-extension.json'),
      content: render.substitute(tpl, vars),
      manifest: m,
      key: `${keyspace}:gemini:manifest`,
      force,
    })
  );

  // Bundled hooks + hooks.json
  const hooksDir = path.join(extDir, 'hooks', 'spec-guard');
  actions.push(...copyHookBundle(hooksDir, m, `${keyspace}:gemini`, force));
  const activate = path.join(hooksDir, 'activate.js');
  const syncCheck = path.join(hooksDir, 'sync-check.sh');
  let hooksCfg = {};
  const hooksJsonPath = agents.resolveHooksConfigPath(agent, ctx);
  try { hooksCfg = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8')); } catch (e) {}
  jsonmerge.upsertHookCommand(hooksCfg, 'SessionStart', { command: `node "${activate}"` });
  jsonmerge.upsertHookCommand(hooksCfg, 'Stop', { command: `bash "${syncCheck}"` });
  fs.mkdirSync(path.dirname(hooksJsonPath), { recursive: true });
  fs.writeFileSync(hooksJsonPath, JSON.stringify(hooksCfg, null, 2) + '\n');
  actions.push({ action: 'wired', absPath: hooksJsonPath });

  return actions;
}

// Greenfield project scaffold: the proven deliverable + IP doc structure. Never clobbers
// existing files (write-if-absent), so it is safe to run on a partially-populated repo.
function scaffoldProject(repoRoot, vars) {
  const created = [];
  const dirs = [
    vars.specDir,
    vars.plansDir,
    'docs/architecture',
    'docs/reference/decisions',
    'docs/runbooks',
    'docs/guides',
    'docs/standards',
    'docs/product',
    'docs/templates',
    `${vars.ipDir}/docs/troubleshootings`,
    `${vars.ipDir}/docs/action_plans`,
    `${vars.ipDir}/docs/audits`,
    `${vars.ipDir}/docs/reviews`,
    `${vars.ipDir}/docs/standards`,
    `${vars.ipDir}/credentials`,
  ];
  for (const d of dirs) fs.mkdirSync(path.join(repoRoot, d), { recursive: true });

  const writeIfAbsent = (rel, content) => {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      created.push(rel);
    }
  };

  const scaffoldDir = path.join(PKG_ROOT, 'templates', 'project-scaffold');
  const sub = (rel) => render.substitute(fs.readFileSync(path.join(scaffoldDir, rel), 'utf8'), vars);

  writeIfAbsent(path.join(vars.specDir, 'README.md'),
    `# Specs\n\nLiving, per-feature specs (In-Scope / Out-of-Scope / Acceptance / Traceability / Status).\nPlans live in \`${vars.plansDir}\`; ADRs in \`docs/reference/decisions/\`.\n`);
  writeIfAbsent(path.join(vars.plansDir, 'README.md'),
    `# Plans\n\nImplementation plans paired with the specs in \`${vars.specDir}\`.\n`);
  writeIfAbsent('docs/templates/spec-template.md', sub('templates/spec-template.md'));
  writeIfAbsent('docs/templates/plan-template.md', sub('templates/plan-template.md'));
  writeIfAbsent('docs/templates/adr-template.md', sub('templates/adr-template.md'));
  writeIfAbsent('CLAUDE.md', sub('CLAUDE.md'));
  writeIfAbsent(
    path.join(vars.ipDir, 'README.md'),
    `# Internal (not shipped)\n\nThe team's intellectual property — harness-agnostic, read by humans and any AI agent:\ntroubleshooting, action plans, audits, internal rationale, internal standards, and credentials.\nAdd \`${vars.ipDir}/\` to every deliverable repo's .gitignore. Deliverable docs (\`docs/\`) must\nnever link in here.\n`
  );

  return created;
}

// Apply the full per-agent repo install for a list of agents. Shared by `init` and `update`.
// Returns [{ id, acts }].
function applyAgents(ctx, agentList, vars, m, opts) {
  const options = opts || {};
  const summary = [];
  for (const id of agentList) {
    const agent = agents.get(id);
    const acts = [];
    acts.push(...installSkillTree(agents.resolveSkillDir(agent, ctx), id, vars, m, `repo:${id}`, options.force));
    acts.push(...installCommands(agent, ctx, vars, m, 'repo', options.force));
    if (agent.extension) acts.push(...installGeminiExtension(agent, ctx, vars, m, 'repo', options.force));
    if (!options.skipRules) acts.push(installRulesBlock(agent, ctx, vars, m, 'repo', options.force));
    summary.push({ id, acts });
  }
  return summary;
}

module.exports = {
  PKG_ROOT,
  renderVars,
  installSkillTree,
  installCommands,
  installRulesBlock,
  copyHookBundle,
  statuslineCombinedContent,
  installGeminiExtension,
  scaffoldProject,
  applyAgents,
};
