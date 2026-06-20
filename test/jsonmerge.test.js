'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { upsertHookCommand, removeHookCommand, countOwned } = require('../src/core/jsonmerge.js');

const NEW = '/home/.claude/hooks/spec-guard/activate.js';

test('case 4: missing event key -> created', () => {
  const cfg = {};
  const { action } = upsertHookCommand(cfg, 'SessionStart', { command: NEW });
  assert.strictEqual(action, 'created');
  assert.strictEqual(countOwned(cfg, 'SessionStart'), 1);
});

test('case 3 + co-tenant safety: caveman present -> appended, caveman untouched', () => {
  const cfg = {
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "/home/.claude/hooks/caveman-activate.js"' }] }] },
  };
  const { action } = upsertHookCommand(cfg, 'SessionStart', { command: NEW });
  assert.strictEqual(action, 'appended');
  const cmds = cfg.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(cmds.some((c) => c.includes('caveman'))); // caveman still there
  assert.strictEqual(countOwned(cfg, 'SessionStart'), 1); // exactly one spec-guard
});

test('case 1: idempotent re-run -> noop, still one entry', () => {
  const cfg = {};
  upsertHookCommand(cfg, 'SessionStart', { command: NEW });
  const { action } = upsertHookCommand(cfg, 'SessionStart', { command: NEW });
  assert.strictEqual(action, 'noop');
  assert.strictEqual(countOwned(cfg, 'SessionStart'), 1);
});

test('case 2 (migration): OLD unmarked spec-guard path -> updated in place, no double-injection', () => {
  const cfg = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            { type: 'command', command: 'node "/home/.claude/hooks/caveman-activate.js"' },
            { type: 'command', command: 'node "/home/.claude/hooks/spec-guard-activate.js"' }, // legacy, unmarked
          ],
        },
      ],
    },
  };
  const { action } = upsertHookCommand(cfg, 'SessionStart', { command: NEW });
  assert.strictEqual(action, 'updated');
  assert.strictEqual(countOwned(cfg, 'SessionStart'), 1); // collapsed to one, not two
  const cmds = cfg.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(cmds.includes(NEW));
  assert.ok(cmds.some((c) => c.includes('caveman'))); // caveman preserved
  assert.ok(!cmds.some((c) => c.includes('spec-guard-activate.js'))); // old path gone
});

test('codex shape: SessionStart exists, Stop missing -> Stop created', () => {
  const cfg = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node caveman' }] }] } };
  const { action } = upsertHookCommand(cfg, 'Stop', { command: '/home/.codex/hooks/spec-guard/sync-check.sh' });
  assert.strictEqual(action, 'created');
  assert.strictEqual(countOwned(cfg, 'Stop'), 1);
});

test('removeHookCommand strips spec-guard entries and prunes empty groups', () => {
  const cfg = {};
  upsertHookCommand(cfg, 'Stop', { command: NEW });
  const removed = removeHookCommand(cfg, 'Stop');
  assert.strictEqual(removed, 1);
  assert.strictEqual(cfg.hooks.Stop, undefined);
});
