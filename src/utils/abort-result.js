'use strict';

/**
 * @module abort-result
 * The abort-result document builder for `abort <taskId|--all> --json` (B21-rest).
 * Split out of result-schema.js purely to stay under the size gate — same
 * versioning contract (fields only ADDED within a SCHEMA_VERSION) applies here.
 */

const { SCHEMA_VERSION } = require('./result-schema-version');

/**
 * Build an abort-result document.
 * `ok` is true iff at least one session/leg was actually marked aborted by this
 * call — a no-op (nothing running) is a successful call with an empty list, but
 * a specific taskId that exists yet was not running (already terminal) reports
 * ok:false so a scripted caller can tell "nothing happened" from "you aborted N".
 * @param {object} opts
 * @param {'session'|'wave'|'all'} opts.scope
 * @param {string|null} opts.taskId - null for scope:'all'
 * @param {string[]} opts.aborted - ids actually marked aborted (session/wave id + any legs)
 * @returns {object} abort document
 */
function buildAbortResult({ scope, taskId = null, aborted = [] }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'abort',
    ok: aborted.length > 0 || scope === 'all',
    scope,
    taskId,
    aborted,
    count: aborted.length,
  };
}

module.exports = { buildAbortResult };
