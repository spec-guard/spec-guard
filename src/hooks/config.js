'use strict';

// In-repo shim so src/hooks/activate.js can `require('./config')` both here and after
// `install` copies it (with the real config.js) into an agent's hooks/spec-guard/ dir.
module.exports = require('../core/config');
