#!/usr/bin/env node
'use strict';

// Thin entrypoint. All logic lives in src/cli so it stays testable.
require('../src/cli/index.js')
  .main(process.argv.slice(2))
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    process.stderr.write(`specguard: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  });
