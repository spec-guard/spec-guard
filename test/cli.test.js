'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const cli = require('../src/cli/index.js');
const pkg = require('../package.json');

function captureStdout(fn) {
  const orig = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => {
    out += chunk;
    return true;
  };
  return Promise.resolve(fn())
    .then((code) => {
      process.stdout.write = orig;
      return { out, code };
    })
    .catch((err) => {
      process.stdout.write = orig;
      throw err;
    });
}

test('--version prints the package version', async () => {
  const { out, code } = await captureStdout(() => cli.main(['--version']));
  assert.strictEqual(out.trim(), pkg.version);
  assert.strictEqual(code, 0);
});

test('--help lists the commands', async () => {
  const { out, code } = await captureStdout(() => cli.main(['--help']));
  assert.match(out, /Usage: spec-guard/);
  for (const name of Object.keys(cli.COMMANDS)) {
    assert.match(out, new RegExp(`\\b${name}\\b`));
  }
  assert.strictEqual(code, 0);
});

test('unknown command exits non-zero', async () => {
  const code = await cli.main(['definitely-not-a-command']);
  assert.notStrictEqual(code, 0);
});
