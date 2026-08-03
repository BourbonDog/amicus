/**
 * @module utils/update-notice — "a newer amicus exists" for the MCP channel
 *
 * The MCP server is the one entry point that skips bin/amicus.js's update
 * banner (deliberately — stdout is protocol). This module is the MCP-shaped
 * replacement (spec docs/superpowers/specs/2026-08-03-mcp-update-notice-design.md):
 * updater.js's cached check rendered as ONE appended text content block on the
 * first successful tool result of the process (latched, D1), plus an always-on
 * line in amicus_guide.
 *
 * Voice contract (v4.6 hint ruling): the version pair is verified fact; the
 * upgrade instruction is stated as fact only when derived from a readable MCP
 * registration config — fallbacks keep the "likely" hedge. Everything here is
 * advisory: every export swallows its own failures rather than throwing into
 * a tool result.
 */

'use strict';

const path = require('path');

/** Upgrade wordings (spec §4). Config-derived rows are verified-voiced;
 *  NPX_CACHED_LINE keeps the hedge — the config read is best-effort. */
const GLOBAL_LINE = 'Run `npm install -g amicus`, then restart your MCP client.';
const NPX_LATEST_LINE = 'Restart your MCP client — it launches `amicus@latest` and will pick up the new version.';
const NPX_CACHED_LINE = 'Your MCP config likely launches a cached/pinned npx copy; '
  + 'point it at `npx -y amicus@latest mcp` (or clear the npx cache), then restart your MCP client.';
const GENERIC_LINE = 'Upgrade your amicus install, then restart your MCP client.';

const CHANGELOG_URL = 'https://github.com/BourbonDog/amicus/blob/main/CHANGELOG.md';

/**
 * Flavor of THIS install — the copy serving the current process. Pure path
 * heuristic on the realpath of our own package.json (no `npm root -g` shellout
 * on the tool-result path): a `_npx` segment is the npx cache; any other
 * `node_modules` home is a global-style install; no `node_modules` at all is a
 * dev clone or similar.
 * @param {{fs?: object, pkgPath?: string}} [deps]
 * @returns {'global'|'npx'|'other'}
 */
function classifySelfInstall(deps = {}) {
  const fs = deps.fs || require('fs');
  const pkgPath = deps.pkgPath || require('./version-info').PKG_PATH;
  try {
    const real = fs.realpathSync(pkgPath);
    const parts = path.dirname(real).split(/[\\/]/);
    if (parts.includes('_npx')) { return 'npx'; }
    if (parts.includes('node_modules')) { return 'global'; }
    return 'other';
  } catch {
    return 'other';
  }
}

/**
 * True when some RAW config arg is the amicus package token pinned `@latest`.
 * Raw on purpose: mcp-self-identity's normalizeToken strips `@version`
 * suffixes, which is exactly the information this check needs.
 * @param {{args?: unknown[]}|null|undefined} config
 */
function pinsAmicusLatest(config) {
  const args = Array.isArray(config && config.args) ? config.args : [];
  return args.some((a) => {
    const t = String(a).toLowerCase().replace(/\\/g, '/');
    const base = t.includes('/') ? t.slice(t.lastIndexOf('/') + 1) : t;
    return base === 'amicus@latest';
  });
}

/**
 * The one correct upgrade move for this install (spec §4), chosen
 * config-first (what a RESTART will launch), self-path fallback.
 * Never throws; worst case is the generic line.
 * @param {{readConfig?: Function, classifyLaunch?: Function, selfFlavor?: Function}} [deps]
 * @returns {string}
 */
function upgradeInstruction(deps = {}) {
  try {
    const readConfig = deps.readConfig
      || (() => require('./mcp-discovery').readAmicusMcpConfig());
    const classifyLaunchFn = deps.classifyLaunch
      || require('./engine-install-scan').classifyLaunch;
    const selfFlavor = deps.selfFlavor || (() => classifySelfInstall(deps));

    let config = null;
    try { config = readConfig(); } catch { config = null; }

    const launch = classifyLaunchFn(config);
    if (launch === 'npx') {
      return pinsAmicusLatest(config) ? NPX_LATEST_LINE : NPX_CACHED_LINE;
    }
    if (launch === 'path') {
      // A path registration launches (approximately) the running copy — let
      // its flavor pick between the npm-global move and the generic one.
      return selfFlavor() === 'global' ? GLOBAL_LINE : GENERIC_LINE;
    }
    // 'none' / 'unknown' — config unreadable or unrecognized: self-path fallback.
    const flavor = selfFlavor();
    if (flavor === 'global') { return GLOBAL_LINE; }
    if (flavor === 'npx') { return NPX_CACHED_LINE; }
    return GENERIC_LINE;
  } catch {
    return GENERIC_LINE;
  }
}

/**
 * The full notice text: verified version pair + instruction + changelog.
 * @param {{current: string, latest: string}} info
 * @param {string} [instruction] - resolved lazily when omitted
 */
function buildUpdateNotice(info, instruction) {
  return `Update available: amicus v${info.current} → v${info.latest}. `
    + `${instruction || upgradeInstruction()} Changelog: ${CHANGELOG_URL}`;
}

/** Once-per-process latch (spec D1). Flips ONLY on an actual append. */
let _noticeShown = false;

/** Test seam: re-arm the latch. */
function _resetLatchForTests() { _noticeShown = false; }

/**
 * The seam the MCP registration wrapper routes EVERY result through: append
 * the notice block to the first successful tool result of this process, then
 * stay quiet. No-op on isError results, unknown update state, malformed
 * results, or any internal failure — the original result always comes back.
 * @param {{content?: Array, isError?: boolean}|null} result
 * @param {{getUpdateInfo?: Function}} [deps]
 */
function maybeAppendUpdateNotice(result, deps = {}) {
  try {
    if (_noticeShown) { return result; }
    if (!result || result.isError || !Array.isArray(result.content)) { return result; }
    const getUpdateInfo = deps.getUpdateInfo || require('./updater').getUpdateInfo;
    const info = getUpdateInfo();
    if (!info || !info.hasUpdate) { return result; }
    result.content.push({ type: 'text', text: buildUpdateNotice(info) });
    _noticeShown = true;
    return result;
  } catch {
    return result;
  }
}

/**
 * The amicus_guide version-line suffix (NOT latched — the guide is the
 * on-demand surface), or null when there is nothing to say.
 * @param {{getUpdateInfo?: Function}} [deps] - plus upgradeInstruction seams
 * @returns {string|null}
 */
function guideUpdateLine(deps = {}) {
  try {
    const getUpdateInfo = deps.getUpdateInfo || require('./updater').getUpdateInfo;
    const info = getUpdateInfo();
    if (!info || !info.hasUpdate) { return null; }
    return `**Update available: v${info.latest}** — ${upgradeInstruction(deps)}`;
  } catch {
    return null;
  }
}

module.exports = {
  classifySelfInstall,
  upgradeInstruction,
  buildUpdateNotice,
  maybeAppendUpdateNotice,
  guideUpdateLine,
  _resetLatchForTests,
};
