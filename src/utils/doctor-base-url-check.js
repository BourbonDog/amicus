/**
 * @module doctor-base-url-check
 * v4.6.2 PR1 (spec §4): the 'anthropic-base-url' doctor row.
 *
 * VERIFIABLE voice (BACKLOG ruling): states only what it string-inspected.
 * It always prints the value the process SEES — the var can live ONLY in a
 * parent process env (the field case: set in the Claude Code app process,
 * absent from every persisted scope on disk), so the seen value IS the
 * diagnostic; "where it is set" may be unfindable.
 */
'use strict';

const { classifyBaseUrl } = require('./base-url-classify');

/** @param {{env?:NodeJS.ProcessEnv}} [d] @returns {{id,name,status,message,hint}} */
function evaluateAnthropicBaseUrl(d = {}) {
  const id = 'anthropic-base-url'; const name = 'ANTHROPIC_BASE_URL';
  const env = d.env || process.env;
  const value = env.ANTHROPIC_BASE_URL;
  const { form, normalized } = classifyBaseUrl(value);
  if (form === 'absent') {
    return { id, name, status: 'ok', message: 'not set', hint: null };
  }
  if (form === 'v1') {
    return { id, name, status: 'ok', message: `${value} (full-prefix form)`, hint: null };
  }
  if (form === 'host') {
    const disabled = env.AMICUS_BASE_URL_NORMALIZE === '0';
    const treatment = disabled
      ? 'normalization is disabled (AMICUS_BASE_URL_NORMALIZE=0) — direct-anthropic legs will 404'
      : `amicus passes ${normalized} to the engine`;
    return {
      id, name, status: 'warn',
      message: `host-form: ${value} — Anthropic SDKs append /v1; OpenCode treats it as the full prefix; ${treatment}`,
      hint: disabled ? `set ANTHROPIC_BASE_URL=${normalized} (or unset AMICUS_BASE_URL_NORMALIZE)` : null,
    };
  }
  return { id, name, status: 'ok', message: `${value} (nonstandard path — passed through unchanged)`, hint: null };
}

module.exports = { evaluateAnthropicBaseUrl };
