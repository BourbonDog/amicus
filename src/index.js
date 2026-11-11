/**
 * Amicus - Main Module
 *
 * Spec Reference: §9 Implementation
 * Internal entry point for the CLI's session operations. Amicus is CLI-only:
 * there is no public library API (package.json `exports` blocks requiring the package by name).
 */

const { startSidecar } = require('./sidecar/start');
const { resumeSidecar } = require('./sidecar/resume');
const { continueSidecar } = require('./sidecar/continue');
const { readSidecar, listSidecars } = require('./sidecar/read');

module.exports = {
  startAmicus: startSidecar,
  listAmicus: listSidecars,
  resumeAmicus: resumeSidecar,
  continueAmicus: continueSidecar,
  readAmicus: readSidecar
};
