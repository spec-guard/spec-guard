'use strict';

// Surgical, idempotent merge of spec-guard hook entries into an agent's hooks config
// (Claude `settings.json` and Codex `hooks.json` share the nested schema:
//   hooks: { <Event>: [ { hooks: [ { type:'command', command, ... } ] } ] }
// ).
//
// Match by logical identity, not exact string:
//   primary  -> entry carries `specGuardManaged: true`
//   fallback -> entry.command contains a spec-guard marker substring (for legacy/unmarked
//               entries written before this version — this is what makes a migration that
//               re-points an old path collapse to one entry instead of double-injecting).
//
// Four cases per event:
//   1. matching entry already at target command -> no-op
//   2. matching entry at a DIFFERENT command    -> update in place
//   3. no match but the event key exists        -> append a new group
//   4. event key missing entirely               -> create it
//
// Co-tenant entries (e.g. caveman) never match the predicate and are never touched.

const DEFAULT_MARKERS = ['spec-guard', 'statusline-combined'];

function defaultPredicate(entry) {
  if (entry && entry.specGuardManaged === true) return true;
  const cmd = entry && typeof entry.command === 'string' ? entry.command : '';
  return DEFAULT_MARKERS.some((m) => cmd.includes(m));
}

// Returns { config, action } where action ∈ noop|updated|appended|created.
function upsertHookCommand(config, eventName, targetEntry, predicate) {
  const match = predicate || defaultPredicate;
  const cfg = config && typeof config === 'object' ? config : {};
  if (!cfg.hooks || typeof cfg.hooks !== 'object') cfg.hooks = {};

  const entry = Object.assign({ type: 'command', specGuardManaged: true }, targetEntry);

  const groups = cfg.hooks[eventName];

  // Case 4: event key missing entirely.
  if (!Array.isArray(groups)) {
    cfg.hooks[eventName] = [{ hooks: [entry] }];
    return { config: cfg, action: 'created' };
  }

  // Search every group's hooks[] for a spec-guard-owned entry.
  for (const group of groups) {
    if (!group || !Array.isArray(group.hooks)) continue;
    for (let i = 0; i < group.hooks.length; i++) {
      const e = group.hooks[i];
      if (!match(e)) continue;
      // Case 1: already at target command.
      if (e.command === entry.command) {
        // Still ensure the managed marker is present for future matches.
        if (e.specGuardManaged !== true) e.specGuardManaged = true;
        return { config: cfg, action: 'noop' };
      }
      // Case 2: matching entry at a different command -> update in place.
      group.hooks[i] = Object.assign({}, e, entry);
      return { config: cfg, action: 'updated' };
    }
  }

  // Case 3: no match, event key exists -> append a new group.
  groups.push({ hooks: [entry] });
  return { config: cfg, action: 'appended' };
}

// Remove every spec-guard-owned entry for an event (used by uninstall). Returns count removed.
function removeHookCommand(config, eventName, predicate) {
  const match = predicate || defaultPredicate;
  if (!config || !config.hooks || !Array.isArray(config.hooks[eventName])) return 0;
  let removed = 0;
  for (const group of config.hooks[eventName]) {
    if (!group || !Array.isArray(group.hooks)) continue;
    const before = group.hooks.length;
    group.hooks = group.hooks.filter((e) => !match(e));
    removed += before - group.hooks.length;
  }
  // Drop now-empty groups.
  config.hooks[eventName] = config.hooks[eventName].filter((g) => g && Array.isArray(g.hooks) && g.hooks.length);
  if (!config.hooks[eventName].length) delete config.hooks[eventName];
  return removed;
}

// Count spec-guard-owned entries for an event (used by doctor's double-injection check).
function countOwned(config, eventName, predicate) {
  const match = predicate || defaultPredicate;
  if (!config || !config.hooks || !Array.isArray(config.hooks[eventName])) return 0;
  let n = 0;
  for (const group of config.hooks[eventName]) {
    if (group && Array.isArray(group.hooks)) n += group.hooks.filter(match).length;
  }
  return n;
}

module.exports = { defaultPredicate, upsertHookCommand, removeHookCommand, countOwned };
