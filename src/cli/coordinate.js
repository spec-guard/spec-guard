'use strict';

// `specguard coordinate` — the deterministic mechanics behind orchestrating several independent
// front-loop instances (each front is a full, unchanged, sequential ORIENT->SYNC run) in
// parallel, each isolated in its own git worktree. This module NEVER decides what a front is,
// never dispatches a subagent, and never fatigates the 6-step loop into stages — it only owns:
//
//   - the ledger (a run's state, one small JSON file per lane, written by whichever party owns
//     that lane at the time — the CLI never needs a lockfile because ownership transfers cleanly
//     on each status transition)
//   - file-level overlap detection between lanes (a mechanical safety net; the coordinating
//     agent's own semantic/"tech lead" review is a separate, non-mechanical judgment call made
//     above this layer)
//   - git-worktree creation/removal, always as a sibling of the repo, never inside it
//   - sequential merge of verified lanes into the base branch, behind a test gate, never two
//     merges concurrently, and never a silent retry/abort on failure — every failure becomes a
//     `blocked` lane (a human-in-the-loop question), resolved explicitly via `resolve-merge`
//
//   specguard coordinate plan --file lanes.json           # validate + create a run (no conflicts -> writes)
//   specguard coordinate start --run <id>                  # create one worktree per lane (x module)
//   specguard coordinate report --run <id> --lane <id> --status running   # a front updates its own lane
//   specguard coordinate status --run <id>                 # dashboard + aggregated open blockers
//   specguard coordinate watch --run <id>                  # poll until every lane is terminal
//   specguard coordinate answer --run <id> --lane <id> --text "..."       # resume a blocked lane
//   specguard coordinate merge --run <id>                   # sequential merge + test gate
//   specguard coordinate resolve-merge --run <id> --lane <id> --action retry|abort
//   specguard coordinate finish --run <id>                  # terminal housekeeping
//   specguard coordinate list [--active]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { parseArgs } = require('./_shared');
const config = require('../core/config');
const topology = require('../core/topology');

const VALID_STATUS = ['pending', 'running', 'blocked', 'verified', 'merging', 'merged', 'failed', 'aborted'];
const TERMINAL_STATUS = new Set(['merged', 'failed', 'aborted']);

// --------------------------------------------------------------------------------------------
// Small utilities
// --------------------------------------------------------------------------------------------

function stdout(s) { process.stdout.write(s); }
function stderr(s) { process.stderr.write(s); }
function nowIso() { return new Date().toISOString(); }

function git(repoDir, args, opts) {
  return spawnSync('git', ['-C', repoDir].concat(args), Object.assign({ encoding: 'utf8' }, opts || {}));
}

function currentBranch(repoDir) {
  const r = git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.status === 0 ? r.stdout.trim() : null;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 40) || 'run';
}

function timestampStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function generateRunId(seed) {
  return `${timestampStamp()}-${slugify(seed)}`;
}

// Every run-id/lane-id that reaches this module from outside (a --run/--lane flag, or a lane
// "id" field in the --file JSON) flows straight into path.join() to build ledger/worktree paths.
// A value like "../../../tmp/x" or ".." would escape `.spec-guard/coordination/` entirely — this
// is the single choke point that rejects that before any path is built. IDs generated internally
// (generateRunId, always timestamp+slugify) are exempt because they're already safe by
// construction, never round-tripped through this check.
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function isSafeId(s) {
  return typeof s === 'string' && SAFE_ID_RE.test(s) && s !== '.' && !s.includes('..');
}
function assertSafeId(kind, value) {
  if (isSafeId(value)) return null;
  return `invalid ${kind} "${value}" — only letters, digits, "." "_" "-" are allowed, and it must not contain ".." or "/"`;
}

// Resolve which repo root + coordination settings this invocation operates against. Works even
// when the repo has never run `specguard init` (no `.spec-guard/config.json`) — coordinate is
// usable in any git repo, falling back to DEFAULTS.coordination.
function resolveContext(flags) {
  const cwd = path.resolve((typeof flags.root === 'string' && flags.root) || '.');
  const settings = config.resolveRepoSettings(cwd);
  const baseRepoRoot = settings.root || cwd;
  return { baseRepoRoot, coordination: settings.coordination, settings };
}

// --------------------------------------------------------------------------------------------
// Ledger paths + atomic I/O (tmp-file + rename; append-only for the log)
// --------------------------------------------------------------------------------------------

function runDir(baseRepoRoot, runId) {
  return path.join(baseRepoRoot, '.spec-guard', 'coordination', runId);
}
function runJsonPath(rd) { return path.join(rd, 'run.json'); }
function laneJsonPath(rd, laneId) { return path.join(rd, 'lanes', `${laneId}.json`); }
function hitlQuestionPath(rd, laneId) { return path.join(rd, 'hitl', `${laneId}.question.json`); }
function hitlAnswerPath(rd, laneId) { return path.join(rd, 'hitl', `${laneId}.answer.json`); }
function logPath(rd) { return path.join(rd, 'log.ndjson'); }

// `coordinate` is usable in any git repo, with or without `specguard init`/`migrate` ever having
// run — so this cannot rely on the installer's `.gitignore` handling (repo-scaffold time, and
// only for `privateDir`). Every run's ledger is ephemeral local state and must never be
// accidentally committed: ensure a nested, self-contained .gitignore the first time anything is
// written under `.spec-guard/coordination/`. Write-if-absent — never touches a user's own root
// .gitignore, never clobbers a .gitignore already customized here.
function ensureCoordinationGitignore(baseRepoRoot) {
  const dir = path.join(baseRepoRoot, '.spec-guard', 'coordination');
  const gi = path.join(dir, '.gitignore');
  if (fs.existsSync(gi)) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(gi, '# Ephemeral coordinator run state — never meant to be committed.\n*\n!.gitignore\n');
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return null; }
}

function appendLog(rd, entry) {
  fs.mkdirSync(rd, { recursive: true });
  fs.appendFileSync(logPath(rd), JSON.stringify(Object.assign({ at: nowIso() }, entry)) + '\n');
}

function readLogEntries(rd) {
  let raw;
  try { raw = fs.readFileSync(logPath(rd), 'utf8'); } catch (e) { return []; }
  return raw.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

// --------------------------------------------------------------------------------------------
// File-level overlap detection (Portao A: mechanical, syntactic — never a substitute for the
// coordinating agent's own semantic review of contradicting rules/contracts between lanes)
// --------------------------------------------------------------------------------------------

// Minimal glob -> RegExp: supports `**` (any depth), `*` (single segment), `?` (single char).
// No dependency is added on purpose — this project ships with zero runtime dependencies.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function gitLsFiles(repoDir) {
  const r = spawnSync('git', ['-C', repoDir, 'ls-files'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

// Tracked-file inventory for collision detection, topology-aware. A `multi-git-root` backup
// monorepo is several NESTED git repos, each with its own working tree — `git ls-files` from the
// root does not descend into a nested repo, so a naive single-root scan would silently never
// match any file declared inside a module (e.g. "module-a/src/shared.js"), making the overlap
// check blind to exactly the multi-repo case it most needs to cover. Collect each module's own
// `ls-files`, path-prefixed, plus whatever the root itself tracks outside any module.
function collectTrackedFiles(baseRepoRoot, topo) {
  const files = new Set();
  if (topo && topo.kind === 'multi-git-root' && topo.modules && topo.modules.length) {
    for (const m of topo.modules) {
      const modRoot = path.join(baseRepoRoot, m);
      for (const f of gitLsFiles(modRoot)) files.add(`${m}/${f}`);
    }
    if (fs.existsSync(path.join(baseRepoRoot, '.git'))) {
      for (const f of gitLsFiles(baseRepoRoot)) {
        if (!topo.modules.some((m) => f === m || f.startsWith(`${m}/`))) files.add(f);
      }
    }
  } else {
    for (const f of gitLsFiles(baseRepoRoot)) files.add(f);
  }
  return files;
}

// NOTE (known limitation, documented in the plan's Risk 1): this only matches files that already
// exist and are tracked. A lane whose declaredPaths point at files it will CREATE won't show an
// overlap here even if two lanes plan to create the same new file — `coordinate plan` always
// requires human review of the report before `start`, precisely because this heuristic is
// syntactic and imperfect, not a guarantee.
function expandDeclaredPaths(trackedFiles, patterns) {
  const matched = new Set();
  if (!patterns || !patterns.length) return matched;
  for (const p of patterns) {
    const re = globToRegExp(p);
    for (const f of trackedFiles) if (re.test(f)) matched.add(f);
  }
  return matched;
}

function detectCollisions(trackedFiles, lanes) {
  const collisions = [];
  const expanded = new Map();
  for (const lane of lanes) expanded.set(lane.id, expandDeclaredPaths(trackedFiles, lane.declaredPaths));

  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const a = lanes[i], b = lanes[j];

      const overlapFiles = [...expanded.get(a.id)].filter((f) => expanded.get(b.id).has(f));
      if (overlapFiles.length) collisions.push({ a: a.id, b: b.id, kind: 'file', files: overlapFiles });

      // Two lanes declaring the exact same glob (even before any matching file exists) is also a
      // conflict — catches the "both plan to create files under the same tree" case.
      const sharedPattern = (a.declaredPaths || []).find((p) => (b.declaredPaths || []).includes(p));
      if (sharedPattern) collisions.push({ a: a.id, b: b.id, kind: 'pattern', pattern: sharedPattern });

      if (a.specPath && b.specPath && a.specPath === b.specPath) {
        collisions.push({ a: a.id, b: b.id, kind: 'spec', specPath: a.specPath });
      }
    }
  }
  return collisions;
}

function formatCollision(c) {
  if (c.kind === 'file') return `${c.a} <-> ${c.b}: file overlap: ${c.files.join(', ')}`;
  if (c.kind === 'pattern') return `${c.a} <-> ${c.b}: same declared path "${c.pattern}"`;
  return `${c.a} <-> ${c.b}: same spec: ${c.specPath}`;
}

// --------------------------------------------------------------------------------------------
// Worktree / branch naming + module targeting
// --------------------------------------------------------------------------------------------

function laneBranchName(branchPrefix, runId, laneId, moduleName) {
  return `${branchPrefix}/${runId}/${laneId}${moduleName ? '--' + moduleName : ''}`;
}

// Always a SIBLING of the repo root, never inside it (topology.isGitRepoDir hardening is the
// second line of defense; this convention is the primary one).
function laneWorktreePath(baseRepoRoot, worktreeRoot, runId, laneId, moduleName) {
  const root = path.resolve(baseRepoRoot, worktreeRoot);
  return path.join(root, runId, `${laneId}${moduleName ? '--' + moduleName : ''}`);
}

// Second line of defense on top of the "sibling of the repo" naming convention and the
// `topology.isGitRepoDir` hardening: refuse outright if a misconfigured `coordination.worktreeRoot`
// would resolve to somewhere inside the repo, instead of silently creating it there.
function isPathInside(parentDir, candidate) {
  const rel = path.relative(parentDir, candidate);
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

function orderedModules(settings, topo) {
  return (settings.modules && settings.modules.length) ? settings.modules : topo.modules;
}

// `topology.detect(root)` (no options) returns `kind: 'already-initialized'` — not the real
// structural kind — for ANY repo that already has `.spec-guard/config.json`, which is the normal
// state after `specguard init` and exactly the state most real usage of `coordinate` runs in.
// Without `{ reinit: true }` here, a genuinely multi-git-root backup monorepo that has been
// through `init` would never be recognized as `multi-git-root` by this module, silently breaking
// per-module worktree creation and per-module file-overlap detection. `coordinate` only ever
// wants the real physical topology, never the installer's init-state short-circuit.
function detectTopology(baseRepoRoot) {
  return topology.detect(baseRepoRoot, { reinit: true });
}

// Which modules (of a multi-git-root backup monorepo) does this lane's declaredPaths touch? An
// unrecognized/empty declaration is treated conservatively (touches every module) — safer than
// silently under-isolating a lane whose real footprint wasn't correctly declared.
function modulesTouchedBy(declaredPaths, modules) {
  const touched = modules.filter((m) => (declaredPaths || []).some((p) => p === m || p.startsWith(m + '/')));
  return touched.length ? touched : modules;
}

// --------------------------------------------------------------------------------------------
// coordinate plan
// --------------------------------------------------------------------------------------------

function cmdPlan(flags) {
  const filePath = flags.file;
  if (!filePath) { stderr('specguard coordinate plan: --file <lanes.json> is required\n'); return 1; }

  let inputLanes;
  try {
    inputLanes = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    stderr(`specguard coordinate plan: could not read/parse ${filePath}: ${e.message}\n`);
    return 1;
  }
  if (!Array.isArray(inputLanes) || inputLanes.length === 0) {
    stderr('specguard coordinate plan: input file must be a non-empty JSON array of lanes\n');
    return 1;
  }

  const ids = new Set();
  for (const lane of inputLanes) {
    if (!lane || typeof lane.id !== 'string' || !lane.id) {
      stderr('specguard coordinate plan: every lane needs a non-empty string "id"\n');
      return 1;
    }
    {
      const err = assertSafeId('lane id', lane.id);
      if (err) { stderr(`specguard coordinate plan: ${err}\n`); return 1; }
    }
    if (ids.has(lane.id)) { stderr(`specguard coordinate plan: duplicate lane id "${lane.id}"\n`); return 1; }
    ids.add(lane.id);
    if (lane.kind !== 'spec-ref' && lane.kind !== 'adhoc') {
      stderr(`specguard coordinate plan: lane "${lane.id}": kind must be "spec-ref" or "adhoc"\n`);
      return 1;
    }
    if (!Array.isArray(lane.declaredPaths)) lane.declaredPaths = [];
    if (lane.kind === 'adhoc' && lane.declaredPaths.length === 0) {
      stderr(`specguard coordinate plan: ad-hoc lane "${lane.id}" requires a non-empty declaredPaths hint — refusing a lane that could touch the whole repo\n`);
      return 1;
    }
    if (lane.dependsOn && !Array.isArray(lane.dependsOn)) {
      stderr(`specguard coordinate plan: lane "${lane.id}": dependsOn must be an array\n`);
      return 1;
    }
  }
  for (const lane of inputLanes) {
    for (const dep of lane.dependsOn || []) {
      if (!ids.has(dep)) { stderr(`specguard coordinate plan: lane "${lane.id}" depends on unknown lane "${dep}"\n`); return 1; }
    }
  }

  const { baseRepoRoot } = resolveContext(flags);
  const trackedFiles = collectTrackedFiles(baseRepoRoot, detectTopology(baseRepoRoot));
  const collisions = detectCollisions(trackedFiles, inputLanes);
  if (collisions.length) {
    stdout('specguard coordinate plan: REFUSED — overlapping lanes detected, nothing was written:\n');
    for (const c of collisions) stdout(`  ${formatCollision(c)}\n`);
    return 1;
  }

  if (typeof flags['run-id'] === 'string' && flags['run-id']) {
    const err = assertSafeId('--run-id', flags['run-id']);
    if (err) { stderr(`specguard coordinate plan: ${err}\n`); return 1; }
  }
  const runId = (typeof flags['run-id'] === 'string' && flags['run-id']) || generateRunId(inputLanes.map((l) => l.id).join('-'));
  const rd = runDir(baseRepoRoot, runId);
  if (fs.existsSync(rd)) { stderr(`specguard coordinate plan: run "${runId}" already exists\n`); return 1; }

  if (flags['dry-run']) {
    stdout(`specguard coordinate plan: DRY RUN — would create run "${runId}" with ${inputLanes.length} lane(s), no conflicts found\n`);
    return 0;
  }

  const baseBranch = (typeof flags['base-branch'] === 'string' && flags['base-branch']) || currentBranch(baseRepoRoot) || 'main';
  const runDoc = {
    schemaVersion: 1,
    runId,
    goal: (typeof flags.goal === 'string' && flags.goal) || null,
    baseRepoRoot,
    baseBranch,
    status: 'planning',
    laneIds: inputLanes.map((l) => l.id),
    mergeOrder: inputLanes.map((l) => l.id),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  ensureCoordinationGitignore(baseRepoRoot);
  writeJsonAtomic(runJsonPath(rd), runDoc);
  for (const lane of inputLanes) {
    writeJsonAtomic(laneJsonPath(rd, lane.id), {
      id: lane.id,
      kind: lane.kind,
      specPath: lane.specPath || null,
      description: lane.description || null,
      status: 'pending',
      dependsOn: lane.dependsOn || [],
      declaredPaths: lane.declaredPaths,
      worktrees: [],
      blockedQuestion: null,
      answer: null,
      notes: [],
      mergeAttempts: [],
      verifiedAt: null,
      mergedAt: null,
      mergeCommit: null,
    });
  }
  appendLog(rd, { laneId: null, event: 'plan-created', detail: { laneIds: runDoc.laneIds, baseBranch } });
  stdout(`specguard coordinate plan: created run "${runId}" with ${inputLanes.length} lane(s), no conflicts\n`);
  return 0;
}

// --------------------------------------------------------------------------------------------
// coordinate start
// --------------------------------------------------------------------------------------------

function cmdStart(flags) {
  const runId = flags.run;
  if (!runId) { stderr('specguard coordinate start: --run <id> is required\n'); return 1; }
  { const err = assertSafeId('--run', runId); if (err) { stderr(`specguard coordinate start: ${err}\n`); return 1; } }
  const { baseRepoRoot, coordination, settings } = resolveContext(flags);
  const rd = runDir(baseRepoRoot, runId);
  const runDoc = readJson(runJsonPath(rd));
  if (!runDoc) { stderr(`specguard coordinate start: run "${runId}" not found\n`); return 1; }

  const topo = detectTopology(baseRepoRoot);
  const modules = orderedModules(settings, topo);
  const wantLanes = flags.lane ? String(flags.lane).split(',') : runDoc.laneIds;
  for (const lid of wantLanes) {
    const err = assertSafeId('--lane', lid);
    if (err) { stderr(`specguard coordinate start: ${err}\n`); return 1; }
  }

  const out = [];
  for (const laneId of wantLanes) {
    const lane = readJson(laneJsonPath(rd, laneId));
    if (!lane) { out.push(`  ${laneId}: SKIPPED (lane not found)`); continue; }
    if (lane.status !== 'pending') { out.push(`  ${laneId}: SKIPPED (status=${lane.status}, not pending)`); continue; }

    const touched = topo.kind === 'multi-git-root' ? modulesTouchedBy(lane.declaredPaths, modules) : [null];
    const worktrees = [];
    for (const m of touched) {
      const gitRoot = m ? path.join(baseRepoRoot, m) : baseRepoRoot;
      const branch = laneBranchName(coordination.branchPrefix, runId, laneId, m);
      const wtPath = laneWorktreePath(baseRepoRoot, coordination.worktreeRoot, runId, laneId, m);
      if (isPathInside(baseRepoRoot, wtPath)) {
        out.push(`  ${laneId}${m ? '/' + m : ''}: REFUSED — worktree path ${wtPath} resolves inside the repo (check coordination.worktreeRoot in .spec-guard/config.json); worktrees must always be a sibling of the repo, never inside it`);
        continue;
      }
      fs.mkdirSync(path.dirname(wtPath), { recursive: true });
      const r = git(gitRoot, ['worktree', 'add', '-b', branch, wtPath, runDoc.baseBranch]);
      if (r.status !== 0) {
        out.push(`  ${laneId}${m ? '/' + m : ''}: FAILED to create worktree: ${(r.stderr || '').trim()}`);
        continue;
      }
      worktrees.push({ module: m, path: wtPath, branch });
      out.push(`  ${laneId}${m ? '/' + m : ''}: worktree ${wtPath} (branch ${branch})`);
    }
    lane.worktrees = worktrees;
    lane.status = worktrees.length ? 'running' : 'failed';
    writeJsonAtomic(laneJsonPath(rd, laneId), lane);
    appendLog(rd, { laneId, event: 'started', detail: { worktrees, status: lane.status } });
  }

  runDoc.status = 'running';
  runDoc.updatedAt = nowIso();
  writeJsonAtomic(runJsonPath(rd), runDoc);
  stdout(`specguard coordinate start (run ${runId}):\n` + (out.length ? out.join('\n') : '  nothing to start') + '\n');
  return 0;
}

// --------------------------------------------------------------------------------------------
// coordinate report — the ONLY way a front updates its own lane
// --------------------------------------------------------------------------------------------

function cmdReport(flags) {
  const runId = flags.run, laneId = flags.lane;
  if (!runId || !laneId) { stderr('specguard coordinate report: --run <id> and --lane <id> are required\n'); return 1; }
  { const err = assertSafeId('--run', runId) || assertSafeId('--lane', laneId); if (err) { stderr(`specguard coordinate report: ${err}\n`); return 1; } }
  const { baseRepoRoot } = resolveContext(flags);
  const rd = runDir(baseRepoRoot, runId);
  const lane = readJson(laneJsonPath(rd, laneId));
  if (!lane) { stderr(`specguard coordinate report: lane "${laneId}" not found in run "${runId}"\n`); return 1; }
  // A terminal lane (merged/failed/aborted) is done — its worktree may already be gone and, for
  // 'merged', its changes already landed on the base branch. Nothing about it should be mutable
  // after that; in particular this is what stops a stale `--declared-paths` update from later
  // getting reinterpreted as scope drift by `status --refresh` and reopening a lane that already
  // shipped (see refreshCollisions, which independently also excludes terminal lanes as a second
  // line of defense).
  if (TERMINAL_STATUS.has(lane.status)) {
    stderr(`specguard coordinate report: lane "${laneId}" is already terminal (status=${lane.status}) — a finished lane cannot be updated\n`);
    return 1;
  }

  if (flags.status) {
    if (!VALID_STATUS.includes(flags.status)) {
      stderr(`specguard coordinate report: invalid --status "${flags.status}" (expected one of ${VALID_STATUS.join('|')})\n`);
      return 1;
    }
    if (flags.status === 'blocked') {
      const urgency = ['low', 'normal', 'high'].includes(flags.urgency) ? flags.urgency : 'normal';
      lane.blockedQuestion = {
        question: (typeof flags.question === 'string' && flags.question) || '(no question text provided)',
        urgency,
        blockedAt: nowIso(),
        resumeStatus: lane.status === 'blocked' ? (lane.blockedQuestion && lane.blockedQuestion.resumeStatus) || 'running' : lane.status,
      };
      writeJsonAtomic(hitlQuestionPath(rd, laneId), lane.blockedQuestion);
    }
    lane.status = flags.status;
  }

  if (typeof flags['declared-paths'] === 'string') {
    lane.declaredPaths = flags['declared-paths'].split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof flags.note === 'string') {
    lane.notes = Array.isArray(lane.notes) ? lane.notes : [];
    lane.notes.push({ at: nowIso(), text: flags.note });
  }
  if (flags.status === 'verified') lane.verifiedAt = nowIso();

  writeJsonAtomic(laneJsonPath(rd, laneId), lane);
  appendLog(rd, { laneId, event: 'report', detail: { status: flags.status || null, note: flags.note || null } });
  stdout(`specguard coordinate report: lane "${laneId}" -> ${lane.status}\n`);
  return 0;
}

// --------------------------------------------------------------------------------------------
// coordinate status — dashboard + aggregated, prioritized open blockers
// --------------------------------------------------------------------------------------------

const URGENCY_ORDER = { high: 0, normal: 1, low: 2 };

function refreshCollisions(rd, baseRepoRoot, lanes) {
  const trackedFiles = collectTrackedFiles(baseRepoRoot, detectTopology(baseRepoRoot));
  const collisions = detectCollisions(trackedFiles, lanes.map((l) => ({ id: l.id, declaredPaths: l.declaredPaths, specPath: l.specPath })));
  for (const c of collisions) {
    for (const [id, otherId] of [[c.a, c.b], [c.b, c.a]]) {
      const lane = lanes.find((l) => l.id === id);
      // A terminal lane (merged/failed/aborted) is done and must never be reopened by a refresh —
      // second line of defense behind cmdReport's own terminal-lane guard above.
      if (lane && lane.status !== 'blocked' && !TERMINAL_STATUS.has(lane.status)) {
        // Capture the REAL current status before overwriting it — a lane already 'verified' (in
        // the merge queue) must resume to 'verified', not silently fall back to 'running' and
        // drop out of the merge queue after `coordinate answer`.
        const priorStatus = lane.status;
        // Optimistic concurrency guard: `--refresh` reads the whole lane set once up front, but a
        // front's own `coordinate report` could write a newer status to this same lane's file in
        // the meantime (there is no lockfile — ownership is by convention, not enforcement; see
        // the plan's known limitation on concurrent writers). Re-read right before writing and
        // defer to whatever is on disk if it already moved on, instead of clobbering it.
        const onDisk = readJson(laneJsonPath(rd, id));
        if (onDisk && onDisk.status !== priorStatus) continue;
        lane.status = 'blocked';
        lane.blockedQuestion = {
          question: `scope drift detected against lane "${otherId}": ${formatCollision(c)}`,
          urgency: 'high',
          blockedAt: nowIso(),
          resumeStatus: priorStatus,
        };
        writeJsonAtomic(laneJsonPath(rd, id), lane);
        writeJsonAtomic(hitlQuestionPath(rd, id), lane.blockedQuestion);
      }
    }
  }
  return collisions;
}

function cmdStatus(flags) {
  const runId = flags.run;
  if (!runId) { stderr('specguard coordinate status: --run <id> is required\n'); return 1; }
  { const err = assertSafeId('--run', runId); if (err) { stderr(`specguard coordinate status: ${err}\n`); return 1; } }
  const { baseRepoRoot } = resolveContext(flags);
  const rd = runDir(baseRepoRoot, runId);
  const runDoc = readJson(runJsonPath(rd));
  if (!runDoc) { stderr(`specguard coordinate status: run "${runId}" not found\n`); return 1; }
  let lanes = runDoc.laneIds.map((id) => readJson(laneJsonPath(rd, id))).filter(Boolean);

  if (flags.refresh) refreshCollisions(rd, baseRepoRoot, lanes);

  const blocked = lanes
    .filter((l) => l.status === 'blocked' && l.blockedQuestion)
    .sort((a, b) => {
      const ua = URGENCY_ORDER[a.blockedQuestion.urgency] ?? 1;
      const ub = URGENCY_ORDER[b.blockedQuestion.urgency] ?? 1;
      if (ua !== ub) return ua - ub;
      return new Date(a.blockedQuestion.blockedAt) - new Date(b.blockedQuestion.blockedAt);
    });

  if (flags.json) {
    stdout(JSON.stringify({ run: runDoc, lanes, blocked }, null, 2) + '\n');
    return 0;
  }

  const out = [`specguard coordinate status — run "${runId}" (${runDoc.status})`, ''];
  for (const l of lanes) out.push(`  ${l.id.padEnd(28)} ${l.status}`);
  if (blocked.length) {
    out.push('', `blocked (${blocked.length}, most urgent first):`);
    for (const l of blocked) out.push(`  [${l.blockedQuestion.urgency}] ${l.id}: ${l.blockedQuestion.question}`);
  }
  stdout(out.join('\n') + '\n');
  return 0;
}

// --------------------------------------------------------------------------------------------
// coordinate watch — pure polling (works via `specguard coordinate status` too; no callback/push
// dependency, so this also works for a human just re-running status by hand)
// --------------------------------------------------------------------------------------------

function cmdWatch(flags) {
  const runId = flags.run;
  if (!runId) { stderr('specguard coordinate watch: --run <id> is required\n'); return Promise.resolve(1); }
  { const err = assertSafeId('--run', runId); if (err) { stderr(`specguard coordinate watch: ${err}\n`); return Promise.resolve(1); } }
  const { baseRepoRoot } = resolveContext(flags);
  const rd = runDir(baseRepoRoot, runId);
  const intervalSec = Number(flags.interval) > 0 ? Number(flags.interval) : 10;
  const maxTicks = Number(flags['max-ticks']) > 0 ? Number(flags['max-ticks']) : Infinity;

  return new Promise((resolve) => {
    const seen = {};
    let ticks = 0;
    const tick = () => {
      ticks++;
      const runDoc = readJson(runJsonPath(rd));
      if (!runDoc) { stderr(`specguard coordinate watch: run "${runId}" not found\n`); resolve(1); return; }
      const lanes = runDoc.laneIds.map((id) => readJson(laneJsonPath(rd, id))).filter(Boolean);
      for (const l of lanes) {
        if (seen[l.id] !== l.status) {
          stdout(`[${nowIso()}] ${l.id}: ${seen[l.id] || '(new)'} -> ${l.status}\n`);
          seen[l.id] = l.status;
        }
      }
      const allTerminal = lanes.length > 0 && lanes.every((l) => TERMINAL_STATUS.has(l.status));
      if (allTerminal) {
        stdout(`specguard coordinate watch: run "${runId}" reached a terminal state for every lane.\n`);
        resolve(0);
        return;
      }
      if (ticks >= maxTicks) {
        stdout(`specguard coordinate watch: stopped after --max-ticks=${maxTicks} (not every lane is terminal yet)\n`);
        resolve(0);
        return;
      }
      setTimeout(tick, intervalSec * 1000);
    };
    tick();
  });
}

// --------------------------------------------------------------------------------------------
// coordinate answer — resume a blocked lane
// --------------------------------------------------------------------------------------------

function cmdAnswer(flags) {
  const runId = flags.run, laneId = flags.lane;
  if (!runId || !laneId) { stderr('specguard coordinate answer: --run <id> and --lane <id> are required\n'); return 1; }
  { const err = assertSafeId('--run', runId) || assertSafeId('--lane', laneId); if (err) { stderr(`specguard coordinate answer: ${err}\n`); return 1; } }
  const text = (typeof flags.text === 'string' && flags.text) ||
    (typeof flags.file === 'string' && fs.existsSync(flags.file) ? fs.readFileSync(flags.file, 'utf8') : null);
  if (!text) { stderr('specguard coordinate answer: provide --text "<answer>" or --file <f>\n'); return 1; }

  const { baseRepoRoot } = resolveContext(flags);
  const rd = runDir(baseRepoRoot, runId);
  const lane = readJson(laneJsonPath(rd, laneId));
  if (!lane) { stderr(`specguard coordinate answer: lane "${laneId}" not found\n`); return 1; }
  if (lane.status !== 'blocked') { stderr(`specguard coordinate answer: lane "${laneId}" is not blocked (status=${lane.status})\n`); return 1; }

  const answer = { text, at: nowIso() };
  writeJsonAtomic(hitlAnswerPath(rd, laneId), answer);
  lane.answer = answer;
  lane.status = (lane.blockedQuestion && lane.blockedQuestion.resumeStatus) || 'running';
  lane.blockedQuestion = null;
  writeJsonAtomic(laneJsonPath(rd, laneId), lane);
  appendLog(rd, { laneId, event: 'answered', detail: { status: lane.status } });
  stdout(`specguard coordinate answer: lane "${laneId}" resumed -> ${lane.status}\n`);
  return 0;
}

// --------------------------------------------------------------------------------------------
// coordinate merge — sequential merge, one lane's worktrees at a time, behind a test gate.
// Every failure (dirty worktree, merge conflict, failing tests, no resolvable test command)
// becomes a `blocked` lane or an outright refusal — never a silent skip, retry, or partial state.
// --------------------------------------------------------------------------------------------

function topoSortLanes(lanes) {
  const byId = new Map(lanes.map((l) => [l.id, l]));
  const visited = new Set(), visiting = new Set(), order = [];
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`dependsOn cycle detected at "${id}"`);
    const lane = byId.get(id);
    if (!lane) return;
    visiting.add(id);
    for (const dep of lane.dependsOn || []) visit(dep);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }
  for (const l of lanes) visit(l.id);
  return order;
}

function resolveTestCommand(gitRoot, explicit, configured) {
  if (explicit) return explicit;
  if (configured) return configured;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(gitRoot, 'package.json'), 'utf8'));
    if (pkg.scripts && pkg.scripts.test) return 'npm test';
  } catch (e) { /* no package.json, or no test script — fall through to null (fail closed) */ }
  return null;
}

function blockLane(rd, laneId, lane, question, resumeStatus) {
  lane.status = 'blocked';
  lane.blockedQuestion = { question, urgency: 'high', blockedAt: nowIso(), resumeStatus };
  writeJsonAtomic(hitlQuestionPath(rd, laneId), lane.blockedQuestion);
  writeJsonAtomic(laneJsonPath(rd, laneId), lane);
  appendLog(rd, { laneId, event: 'merge-blocked', detail: { question } });
}

function cmdMerge(flags) {
  const runId = flags.run;
  if (!runId) { stderr('specguard coordinate merge: --run <id> is required\n'); return 1; }
  { const err = assertSafeId('--run', runId); if (err) { stderr(`specguard coordinate merge: ${err}\n`); return 1; } }
  const { baseRepoRoot, coordination } = resolveContext(flags);
  const rd = runDir(baseRepoRoot, runId);
  const runDoc = readJson(runJsonPath(rd));
  if (!runDoc) { stderr(`specguard coordinate merge: run "${runId}" not found\n`); return 1; }

  const allLanes = runDoc.laneIds.map((id) => readJson(laneJsonPath(rd, id))).filter(Boolean);
  let order;
  try { order = topoSortLanes(allLanes); }
  catch (e) { stderr(`specguard coordinate merge: ${e.message}\n`); return 1; }

  if (flags.lane) {
    for (const lid of String(flags.lane).split(',')) {
      const err = assertSafeId('--lane', lid);
      if (err) { stderr(`specguard coordinate merge: ${err}\n`); return 1; }
    }
  }
  const wantLaneIds = flags.lane ? new Set(String(flags.lane).split(',')) : null;
  const out = [];

  for (const laneId of order) {
    if (wantLaneIds && !wantLaneIds.has(laneId)) continue;
    let lane = readJson(laneJsonPath(rd, laneId));
    if (!lane || lane.status !== 'verified') continue; // pending/blocked/merged/etc: skip, never cascade

    const unmetDeps = (lane.dependsOn || []).filter((depId) => {
      const dep = readJson(laneJsonPath(rd, depId));
      return !dep || dep.status !== 'merged';
    });
    if (unmetDeps.length) { out.push(`  ${laneId}: SKIPPED (waiting on dependsOn: ${unmetDeps.join(', ')})`); continue; }

    let laneOk = true;
    for (const wt of lane.worktrees) {
      const gitRoot = wt.module ? path.join(baseRepoRoot, wt.module) : baseRepoRoot;

      // A retry after a lane partially merged (some worktrees succeeded before a later one
      // blocked) should not blindly re-process a module that already landed — that would push a
      // degenerate duplicate `mergeAttempts` entry and could confuse a later abort's accounting.
      // But the worktree that already merged is NOT removed while the lane is still blocked on a
      // sibling worktree (removal only happens once the whole lane succeeds), so a human can keep
      // committing into it in the meantime. Only skip when the front's branch tip is still exactly
      // what was already merged — if it moved on, the delta needs to land too, so fall through and
      // merge again (git merges the new commits in cleanly; it does not re-merge what's already
      // common history).
      // `mergeAttempts` is append-only in chronological order and a module can carry more than
      // one unreverted 'merged' entry (this very skip lets a re-merged worktree stack a second
      // one on top of the first) — take the LAST (most recent) match, never the first, or this
      // compares frontHead against a stale frontSha forever and never skips again even when
      // nothing has changed since the last merge.
      const priorAttempt = (lane.mergeAttempts || []).filter((a) => a.result === 'merged' && a.module === wt.module && !a.reverted).pop();
      const frontHead = git(wt.path, ['rev-parse', 'HEAD']).stdout.trim();
      if (priorAttempt && frontHead === priorAttempt.frontSha) {
        out.push(`  ${laneId}${wt.module ? '/' + wt.module : ''}: SKIPPED (already merged in a prior attempt)`);
        continue;
      }

      const dirty = git(wt.path, ['status', '--porcelain']).stdout.trim();
      if (dirty) {
        blockLane(rd, laneId, lane, `worktree ${wt.path} has uncommitted changes — commit inside the front before merging`, 'verified');
        laneOk = false; break;
      }

      // The base repo itself (gitRoot — where the merge and the test command actually run) must
      // have no uncommitted TRACKED changes: `git reset --hard` below would silently destroy
      // those if a merge/test attempt fails. Untracked files are deliberately not checked here —
      // git merge/reset never touch them, and blocking on every unrelated scratch file sitting in
      // gitRoot (the coordinator's own `--file` input included) would make this unusably strict.
      const preTracked = git(gitRoot, ['status', '--porcelain']).stdout.split('\n')
        .filter(Boolean).filter((l) => !l.startsWith('??'));
      if (preTracked.length) {
        blockLane(rd, laneId, lane, `base repo ${gitRoot} has uncommitted changes to tracked files — refusing to merge/test onto that (a failed attempt resets --hard and would destroy that work); commit or stash it first`, 'verified');
        laneOk = false; break;
      }

      const preSha = git(gitRoot, ['rev-parse', 'HEAD']).stdout.trim();
      // `-m` with an explicit, generic message — never `--no-edit` (git's default merge message
      // is `Merge branch '<branch>'`, and the front's working branch name embeds this tool's own
      // internal vocabulary: `spec-guard/coord/<runId>/<laneId>--<module>`). That branch name is
      // scratch state, deleted once the lane lands (or by `coordinate finish --purge-worktrees`);
      // the merge commit is what a delivered repo's history actually carries. A commit message
      // that names the tool or the run's internal id is exactly the kind of leak downstream IP
      // audits flag and block a first push over — found the hard way in a real coordinated run.
      const mergeMessage = `Merge: ${laneId}${wt.module ? '/' + wt.module : ''}`;
      const mergeRes = git(gitRoot, ['merge', '--no-ff', '-m', mergeMessage, wt.branch]);
      if (mergeRes.status !== 0) {
        git(gitRoot, ['merge', '--abort']);
        const detail = `${mergeRes.stdout || ''}${mergeRes.stderr || ''}`.trim().slice(0, 2000);
        blockLane(rd, laneId, lane, `merge conflict in ${wt.module || '(root)'} (branch ${wt.branch}): ${detail}`, 'verified');
        laneOk = false; break;
      }

      const testCmd = resolveTestCommand(gitRoot, flags['test-cmd'], coordination.testCommand);
      if (!testCmd) {
        git(gitRoot, ['reset', '--hard', preSha]);
        // Fail closed: abort the whole run, not just this lane — but still report and persist
        // whatever lanes already merged earlier in THIS same invocation; they're already written
        // to disk individually, only the run-level summary/timestamp was pending.
        runDoc.updatedAt = nowIso();
        writeJsonAtomic(runJsonPath(rd), runDoc);
        if (out.length) stdout(`specguard coordinate merge (run ${runId}):\n` + out.join('\n') + '\n');
        stderr(`specguard coordinate merge: no test command resolvable for ${gitRoot} — refusing to merge without a gate (configure coordination.testCommand or pass --test-cmd)\n`);
        return 1;
      }
      // Snapshot untracked files right before running the test command, so any NEW untracked
      // file that appears afterward can be attributed to this exact test run (a build artifact),
      // never to something the user already had sitting in gitRoot — that provenance is what
      // makes it safe to remove automatically instead of leaving it to silently contaminate the
      // next merge attempt (here, or from another lane sharing this module).
      const untrackedBefore = new Set(
        git(gitRoot, ['status', '--porcelain', '--untracked-files=all']).stdout.split('\n')
          .filter(Boolean).filter((l) => l.startsWith('??')).map((l) => l.slice(3))
      );
      const testRes = spawnSync(testCmd, { cwd: gitRoot, shell: true, encoding: 'utf8' });
      if (testRes.status !== 0) {
        git(gitRoot, ['reset', '--hard', preSha]);
        const untrackedAfter = git(gitRoot, ['status', '--porcelain', '--untracked-files=all']).stdout.split('\n')
          .filter(Boolean).filter((l) => l.startsWith('??')).map((l) => l.slice(3));
        for (const p of untrackedAfter) {
          if (untrackedBefore.has(p) || p.startsWith('.spec-guard/coordination')) continue;
          fs.rmSync(path.join(gitRoot, p), { recursive: true, force: true });
        }
        blockLane(rd, laneId, lane, `merge landed but the test gate failed in ${wt.module || '(root)'} (${testCmd}); the merge was reverted`, 'verified');
        laneOk = false; break;
      }

      // preSha/postSha are what a later `resolve-merge --action abort` needs to safely revert
      // THIS module if the lane goes on to block on a later worktree — see cmdResolveMerge.
      const postSha = git(gitRoot, ['rev-parse', 'HEAD']).stdout.trim();
      lane.mergeAttempts.push({ at: nowIso(), module: wt.module, gitRoot, result: 'merged', testCmd, preSha, postSha, frontSha: frontHead });
      out.push(`  ${laneId}${wt.module ? '/' + wt.module : ''}: merged + tests OK`);
    }

    if (!laneOk) { out.push(`  ${laneId}: BLOCKED — see \`coordinate status --run ${runId}\``); continue; }

    lane.status = 'merged';
    lane.mergedAt = nowIso();
    for (const wt of lane.worktrees) {
      const gitRoot = wt.module ? path.join(baseRepoRoot, wt.module) : baseRepoRoot;
      git(gitRoot, ['worktree', 'remove', wt.path, '--force']);
    }
    writeJsonAtomic(laneJsonPath(rd, laneId), lane);
    appendLog(rd, { laneId, event: 'merged', detail: {} });
  }

  runDoc.updatedAt = nowIso();
  writeJsonAtomic(runJsonPath(rd), runDoc);
  stdout(`specguard coordinate merge (run ${runId}):\n` + (out.length ? out.join('\n') : '  nothing to merge (no verified lanes)') + '\n');
  return 0;
}

// --------------------------------------------------------------------------------------------
// coordinate resolve-merge
// --------------------------------------------------------------------------------------------

function cmdResolveMerge(flags) {
  const runId = flags.run, laneId = flags.lane, action = flags.action;
  if (!runId || !laneId || !action) { stderr('specguard coordinate resolve-merge: --run, --lane and --action retry|abort are required\n'); return 1; }
  if (action !== 'retry' && action !== 'abort') { stderr('specguard coordinate resolve-merge: --action must be "retry" or "abort"\n'); return 1; }
  { const err = assertSafeId('--run', runId) || assertSafeId('--lane', laneId); if (err) { stderr(`specguard coordinate resolve-merge: ${err}\n`); return 1; } }

  const { baseRepoRoot } = resolveContext(flags);
  const rd = runDir(baseRepoRoot, runId);
  const lane = readJson(laneJsonPath(rd, laneId));
  if (!lane) { stderr(`specguard coordinate resolve-merge: lane "${laneId}" not found\n`); return 1; }
  if (lane.status !== 'blocked') { stderr(`specguard coordinate resolve-merge: lane "${laneId}" is not blocked (status=${lane.status})\n`); return 1; }

  const warnings = [];
  if (action === 'retry') {
    lane.status = 'verified';
    lane.blockedQuestion = null;
  } else {
    // A multi-worktree lane can have already landed SOME of its modules successfully before
    // blocking on a later one (cmdMerge merges/tests one worktree at a time, in order — see the
    // per-worktree loop there). "Abort" has to mean the whole lane's contribution is gone, not
    // "gone from whichever module happened to fail last" — so revert every module this lane
    // already merged, not just remove its worktrees. Only safe when nothing else has landed on
    // top of that merge since (HEAD still equals the recorded post-merge sha); if something else
    // merged there in the meantime, an automatic `reset --hard` would destroy that other work, so
    // this refuses to touch it and surfaces it as a warning instead of silently doing nothing.
    // A module can carry MORE than one unreverted 'merged' entry: `coordinate merge` re-merges a
    // worktree that gained new commits since it last landed (see the frontSha check there), which
    // stacks a second merge commit directly on top of the first. Reverting has to treat that whole
    // chain as one atomic unit — reverting only the newest layer would leave the older one's
    // content still actually merged while reporting the module as handled; there is no such thing
    // as "partially aborted" for a single module. Group by module, only touch a module whose
    // current HEAD still matches its LATEST attempt's postSha (nothing external landed after the
    // last merge for that module), and reset all the way back to the EARLIEST attempt's preSha
    // (the state before this lane touched the module at all) in one shot.
    const byModule = new Map();
    for (const attempt of lane.mergeAttempts || []) {
      if (attempt.result !== 'merged' || attempt.reverted) continue;
      const key = attempt.module || '(root)';
      if (!byModule.has(key)) byModule.set(key, []);
      byModule.get(key).push(attempt);
    }
    for (const chain of byModule.values()) {
      const earliest = chain[0], latest = chain[chain.length - 1];
      const currentHead = git(latest.gitRoot, ['rev-parse', 'HEAD']).stdout.trim();
      if (currentHead !== latest.postSha) {
        warnings.push(`module ${latest.module || '(root)'} (${latest.gitRoot}) already merged this lane's changes and something else has landed there since — NOT auto-reverted, revert it manually`);
        continue;
      }
      const resetRes = git(latest.gitRoot, ['reset', '--hard', earliest.preSha]);
      // Never trust this blind — a lane must not become `aborted` (terminal, immutable) with a
      // module still actually merged just because the revert command itself silently failed
      // (locked index, unreachable sha, disk/permission error). Only mark the chain reverted once
      // the revert is verified to have actually landed.
      const verifyHead = git(latest.gitRoot, ['rev-parse', 'HEAD']).stdout.trim();
      if (resetRes.status === 0 && verifyHead === earliest.preSha) {
        for (const attempt of chain) attempt.reverted = true;
      } else {
        const detail = `${resetRes.stderr || resetRes.stdout || ''}`.trim().slice(0, 500);
        warnings.push(`module ${latest.module || '(root)'} (${latest.gitRoot}) — reverting it failed (${detail || 'HEAD did not move to the pre-merge sha'}) — revert it manually`);
      }
    }
    // The lane only becomes terminal (`aborted`) once every landed module has actually been
    // reverted — never on the strength of "we tried". Marking it `aborted` while a warning above
    // means some module is STILL merged would misreport a partial abort as complete, and — because
    // a terminal lane is immutable (see cmdReport) — permanently freeze that lie with no way to
    // fix it through the CLI. Instead: persist whatever WAS safely reverted, leave the lane
    // `blocked` (mutable) and refuse to finish, unless a human explicitly overrides with --force
    // after handling the remaining module(s) themselves.
    if (warnings.length && !flags.force) {
      writeJsonAtomic(laneJsonPath(rd, laneId), lane);
      appendLog(rd, { laneId, event: 'resolve-merge', detail: { action, blocked: true, warnings } });
      stdout(`specguard coordinate resolve-merge: lane "${laneId}" NOT fully aborted — ${warnings.length} module(s) need manual attention:\n` +
        warnings.map((w) => `  ⚠ ${w}\n`).join('') +
        `Resolve those manually, then re-run \`resolve-merge --action abort --force\` to finalize this lane as aborted.\n`);
      return 1;
    }
    lane.status = 'aborted';
    lane.blockedQuestion = null;
    for (const wt of lane.worktrees || []) {
      const gitRoot = wt.module ? path.join(baseRepoRoot, wt.module) : baseRepoRoot;
      git(gitRoot, ['worktree', 'remove', wt.path, '--force']);
    }
  }
  writeJsonAtomic(laneJsonPath(rd, laneId), lane);
  appendLog(rd, { laneId, event: 'resolve-merge', detail: { action, warnings: warnings.length ? warnings : undefined } });
  stdout(`specguard coordinate resolve-merge: lane "${laneId}" -> ${lane.status}\n` + (warnings.length ? warnings.map((w) => `  ⚠ ${w} (forced)\n`).join('') : ''));
  return 0;
}

// --------------------------------------------------------------------------------------------
// coordinate finish
// --------------------------------------------------------------------------------------------

function cmdFinish(flags) {
  const runId = flags.run;
  if (!runId) { stderr('specguard coordinate finish: --run <id> is required\n'); return 1; }
  { const err = assertSafeId('--run', runId); if (err) { stderr(`specguard coordinate finish: ${err}\n`); return 1; } }
  const { baseRepoRoot } = resolveContext(flags);
  const rd = runDir(baseRepoRoot, runId);
  const runDoc = readJson(runJsonPath(rd));
  if (!runDoc) { stderr(`specguard coordinate finish: run "${runId}" not found\n`); return 1; }

  const lanes = runDoc.laneIds.map((id) => readJson(laneJsonPath(rd, id))).filter(Boolean);
  const notTerminal = lanes.filter((l) => !TERMINAL_STATUS.has(l.status));
  if (notTerminal.length && !flags.force) {
    stderr(`specguard coordinate finish: ${notTerminal.length} lane(s) not terminal (${notTerminal.map((l) => `${l.id}:${l.status}`).join(', ')}) — pass --force to finish anyway\n`);
    return 1;
  }

  if (flags['purge-worktrees']) {
    // Only ever destroy a worktree that belongs to a TERMINAL lane. A non-terminal lane
    // (pending/running/blocked/verified) can only reach this point via `--force`, which means
    // "finish anyway" was explicitly requested for an incomplete run — it does not mean "and
    // throw away whatever work is still sitting uncommitted in that lane's worktree". Purging
    // those unconditionally destroyed in-progress work; skip them and say so in the audit.
    for (const l of lanes) {
      if (!TERMINAL_STATUS.has(l.status)) continue;
      for (const wt of l.worktrees || []) {
        const gitRoot = wt.module ? path.join(baseRepoRoot, wt.module) : baseRepoRoot;
        git(gitRoot, ['worktree', 'remove', wt.path, '--force']);
        if (!flags['keep-branches']) git(gitRoot, ['branch', '-D', wt.branch]);
      }
    }
  }

  runDoc.status = 'completed';
  runDoc.updatedAt = nowIso();
  writeJsonAtomic(runJsonPath(rd), runDoc);

  // Closing audit — a real coordinator doesn't just guard against an incomplete finish, it
  // accounts for everything it was responsible for before declaring the run done.
  const merged = lanes.filter((l) => l.status === 'merged');
  const failed = lanes.filter((l) => l.status === 'failed');
  const aborted = lanes.filter((l) => l.status === 'aborted');
  const stillBlocked = lanes.filter((l) => l.status === 'blocked');
  const log = readLogEntries(rd);
  const blockersRaised = log.filter((e) => e.event === 'merge-blocked' || (e.event === 'report' && e.detail && e.detail.status === 'blocked')).length;
  const blockersResolved = log.filter((e) => e.event === 'answered' || e.event === 'resolve-merge').length;

  const audit = [];
  audit.push(`specguard coordinate finish: run "${runId}" marked completed.`);
  audit.push('');
  audit.push('Closing audit:');
  audit.push(`  Lanes requested:  ${lanes.length}`);
  audit.push(`  Merged cleanly:   ${merged.length}${merged.length ? ` (${merged.map((l) => l.id).join(', ')})` : ''}`);
  if (failed.length) audit.push(`  Failed:           ${failed.length} (${failed.map((l) => l.id).join(', ')})`);
  if (aborted.length) audit.push(`  Aborted:          ${aborted.length} (${aborted.map((l) => l.id).join(', ')})`);
  audit.push(`  Blockers raised:  ${blockersRaised}`);
  audit.push(`  Blockers resolved:${' '.repeat(1)}${blockersResolved}`);
  if (stillBlocked.length) {
    audit.push(`  ⚠ Still blocked:  ${stillBlocked.length} (${stillBlocked.map((l) => l.id).join(', ')}) — finished with --force, these were NOT resolved.`);
  } else {
    audit.push('  Open blockers:    0');
  }
  if (flags['purge-worktrees'] && notTerminal.some((l) => (l.worktrees || []).length)) {
    const kept = notTerminal.filter((l) => (l.worktrees || []).length);
    audit.push(`  ⚠ Worktrees kept (lane not terminal, NOT purged): ${kept.length} (${kept.map((l) => l.id).join(', ')})`);
  }
  // Any lane whose final status is NOT `merged` can still carry a `mergeAttempts` entry with
  // `result:'merged', reverted:false` — a module that genuinely landed in the base and was never
  // undone. The most obvious path is `resolve-merge --action abort --force` over a module that
  // couldn't be safely auto-reverted (see cmdResolveMerge), but it is NOT the only one: `report`
  // only blocks mutating an already-TERMINAL lane, so a `blocked` lane with a partial merge can be
  // pushed straight to `failed` via `coordinate report --status failed` without ever going through
  // `resolve-merge` — and a `blocked` lane finished via `finish --force` never goes through
  // `resolve-merge` either. In every one of those cases the module's content is permanently in the
  // base regardless of what this lane's status claims; `finish` must surface it here for ALL of
  // them, or the closing claim below would be a lie. (A lane that IS `merged` is exempt: every one
  // of its unreverted 'merged' attempts is the intended, successful outcome, not something stale.)
  const staleModules = [];
  for (const l of lanes) {
    if (l.status === 'merged') continue;
    for (const attempt of l.mergeAttempts || []) {
      if (attempt.result === 'merged' && !attempt.reverted) staleModules.push(`${l.id}/${attempt.module || '(root)'} (lane status: ${l.status})`);
    }
  }
  if (staleModules.length) {
    audit.push(`  ⚠ Content still merged and never reverted, despite the lane not being 'merged': ${staleModules.join(', ')}`);
  }
  audit.push('');
  if (staleModules.length) {
    audit.push('NOT everything above is accounted for: the module(s) listed above are still actually');
    audit.push('merged into the base even though their lane did not end up `merged` — review them');
    audit.push('before treating this run as fully undone or fully failed.');
  } else {
    audit.push('Nothing left unaccounted for above this line was silently dropped by the coordinator.');
  }
  audit.push('Reminder: this run does not itself verify cross-lane reconciliation — run the single');
  audit.push('final SYNC/Verifier pass (see references/multi-front-coordination.md) before');
  audit.push('`specguard commit --all` (or a plain commit) at the repo root.');
  stdout(audit.join('\n') + '\n');
  return 0;
}

// --------------------------------------------------------------------------------------------
// coordinate list
// --------------------------------------------------------------------------------------------

function cmdList(flags) {
  const { baseRepoRoot } = resolveContext(flags);
  const base = path.join(baseRepoRoot, '.spec-guard', 'coordination');
  let entries;
  try { entries = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()); }
  catch (e) { entries = []; }
  const runs = entries.map((e) => readJson(runJsonPath(path.join(base, e.name)))).filter(Boolean);
  const filtered = flags.active ? runs.filter((r) => r.status !== 'completed' && r.status !== 'aborted') : runs;

  if (!filtered.length) { stdout('specguard coordinate list: no runs found.\n'); return 0; }
  stdout('specguard coordinate list:\n' + filtered.map((r) => `  ${r.runId}  ${r.status}  (${r.laneIds.length} lane(s))`).join('\n') + '\n');
  return 0;
}

// --------------------------------------------------------------------------------------------

const HANDLERS = {
  plan: cmdPlan,
  start: cmdStart,
  report: cmdReport,
  status: cmdStatus,
  watch: cmdWatch,
  answer: cmdAnswer,
  merge: cmdMerge,
  'resolve-merge': cmdResolveMerge,
  finish: cmdFinish,
  list: cmdList,
};

function run(args) {
  const { flags, positionals } = parseArgs(args);
  const sub = positionals[0];
  const handler = HANDLERS[sub];
  if (!handler) {
    stderr(`usage: specguard coordinate <${Object.keys(HANDLERS).join('|')}> [options]\n`);
    return 1;
  }
  return handler(flags);
}

module.exports = {
  run,
  // exported for unit testing of the mechanical pieces
  globToRegExp,
  detectCollisions,
  topoSortLanes,
  resolveTestCommand,
  laneBranchName,
  laneWorktreePath,
  refreshCollisions,
};
