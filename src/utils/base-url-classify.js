/**
 * @module base-url-classify
 * v4.6.2 PR1 (spec §4, D1/D2): ANTHROPIC_BASE_URL classification, the
 * normalization decision, and the once-per-process notice.
 *
 * The convention split (field-proven by a control pair on run 0084d48c):
 * Anthropic SDKs — including Claude Code itself — treat the var as a HOST and
 * append /v1 themselves; OpenCode's provider layer treats it as the FULL
 * prefix and appends /messages. A host-form value is therefore correct for
 * Claude Code and fatal for every OpenCode direct-anthropic leg
 * (host/messages -> 404 "Not Found").
 *
 * Forms: absent (unset/blank) · host (path '' or '/') · v1 (path ends /v1)
 * · other (any other path, or unparseable — passed through untouched; an
 * exotic proxy serving /messages at a custom root stays possible, D1).
 */
'use strict';

/** @param {string|undefined|null} value @returns {{form:string, normalized:string|null}} */
function classifyBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { form: 'absent', normalized: null };
  }
  const trimmed = value.trim();
  let url;
  try { url = new URL(trimmed); } catch { return { form: 'other', normalized: null }; }
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '') {
    return { form: 'host', normalized: trimmed.replace(/\/+$/, '') + '/v1' };
  }
  if (path.endsWith('/v1')) { return { form: 'v1', normalized: null }; }
  return { form: 'other', normalized: null };
}

/**
 * The baseURL override the OpenCode server config should carry, or null.
 * Null when: var absent, already /v1, nonstandard path, or normalization
 * disabled via AMICUS_BASE_URL_NORMALIZE=0 (D1's escape hatch).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
function resolveBaseUrlOverride(env = process.env) {
  if (env.AMICUS_BASE_URL_NORMALIZE === '0') { return null; }
  const { form, normalized } = classifyBaseUrl(env.ANTHROPIC_BASE_URL);
  return form === 'host' ? normalized : null;
}

let noticeShown = false;

/**
 * One notice per process (D2): the server may start many times (shared-server
 * retries, fanout waves) and the treatment is identical every time.
 * @param {string} value - the raw env value seen
 * @param {string} normalized - the value handed to the engine config
 * @param {{write?:Function, logger?:object}} [deps] - test seams
 */
function announceBaseUrlNormalizationOnce(value, normalized, deps = {}) {
  if (noticeShown) { return; }
  noticeShown = true;
  const write = deps.write || (s => process.stderr.write(s));
  const log = deps.logger || require('./logger').logger;
  write(`Notice: ANTHROPIC_BASE_URL is host-form (${value}); passing ${normalized} to the engine `
    + '(Anthropic SDKs append /v1 themselves; OpenCode treats the value as a full prefix; '
    + 'set AMICUS_BASE_URL_NORMALIZE=0 to disable).\n');
  log.info('ANTHROPIC_BASE_URL normalized for engine config', { value, normalized });
}

/** Test seam: reset the once-guard. */
function _resetBaseUrlNotice() { noticeShown = false; }

module.exports = {
  classifyBaseUrl, resolveBaseUrlOverride,
  announceBaseUrlNormalizationOnce, _resetBaseUrlNotice,
};
