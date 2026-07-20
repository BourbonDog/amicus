// src/utils/error-doc.js
'use strict';

/**
 * @module error-doc
 * Structured error envelope for the `--json` contract (WS-2 #6). Every
 * pre-flight failure under --json writes one of these to STDOUT (with a stable
 * code) so an automation caller doing JSON.parse(stdout) gets a typed result
 * instead of an empty string. Non-JSON callers keep human text on stderr.
 */

const { SCHEMA_VERSION } = require('./result-schema');

/** Frozen — adding a code later is additive; renaming/removing is breaking. */
const ERROR_CODES = Object.freeze({
  BAD_ARGS: 'BAD_ARGS',             // bad/empty flag, mutually-exclusive flags, bad numeric/enum value
  MISSING_PROMPT: 'MISSING_PROMPT', // no/empty --prompt or --prompt-file
  BAD_MODEL: 'BAD_MODEL',           // bad model format, not on provider, not in catalog
  MISSING_KEY: 'MISSING_KEY',       // provider API key absent
  BAD_SESSION: 'BAD_SESSION',       // task id missing / invalid / not found
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED', // the WS-2 #10 spend gate
  INTERNAL: 'INTERNAL',             // unexpected pre-flight throw
  COUNCIL_QUORUM: 'COUNCIL_QUORUM', // council run: <2 surviving Stage-1 reviews (v4.0 §4)
  COST_EXCEEDED: 'COST_EXCEEDED',   // council run: whole-run --max-cost ceiling hit pre-tally (v4.0 §4)
});

/**
 * @param {{code: string, message: string, hint?: string, command?: string}} opts
 * @returns {object} error document
 */
function buildErrorDoc({ code, message, hint = null, command = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'error',
    ok: false,
    error: { code, message, hint: hint || null, command: command || null },
  };
}

/**
 * Emit a pre-flight failure: JSON envelope to stdout when useJson, else the
 * human message to stderr. Returns the exit code (always 1) so callers can
 * `process.exit(failJson(...))`.
 * @param {boolean} useJson
 * @param {{code: string, message: string, hint?: string, command?: string}} opts
 * @returns {number}
 */
function failJson(useJson, { code, message, hint = null, command = null }) {
  if (useJson) {
    process.stdout.write(JSON.stringify(buildErrorDoc({ code, message, hint, command }), null, 2) + '\n');
  } else {
    process.stderr.write(message + '\n');
    // Parity with --json (whose envelope carries error.hint): surface the
    // actionable hint to humans too, in doctor's arrow style.
    if (hint) { process.stderr.write(`  → ${hint}\n`); }
  }
  return 1;
}

module.exports = { ERROR_CODES, buildErrorDoc, failJson };
