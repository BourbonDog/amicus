/**
 * @module utils/doctor-electron-mcp-check
 * The `electron-mcp` doctor check ("Electron (MCP launch path)"), split out of
 * src/cli-handlers-doctor.js to keep that file under the 300-line gate
 * (mirrors doctor-engine-check.js, which did the same for the engine — #76 is
 * the electron-flavored recurrence of that check's bug report #1).
 *
 * The existing `electron` check verifies Electron in the RUNNING install. This
 * one verifies the copies the MCP actually launches from — the npx-cache
 * installs `npx -y amicus@latest mcp` resolves to — so a green doctor can no
 * longer hide an npx copy whose `ui: true` will fail with electron-absent.
 *
 * Severity is WARN at worst (never error): a broken Electron only costs the
 * GUI; headless councils still work — same tier the running-copy check uses.
 */

'use strict';

const HINTS = require('./remediation-hints');

const plural = (n, one, many) => (n === 1 ? one : many);

/** One-line detail for a broken copy, distinguishing the two states (#76). */
const describeBroken = (i) => (i.state === 'binary-missing'
  ? `${i.pkgDir} (binary missing; electron dir: ${i.electronDir})`
  : `${i.pkgDir} (not installed)`);

/**
 * Enumerate the amicus installs that could serve the MCP and probe Electron in
 * each via the dual-root resolver (#69 lesson: npx HOISTS electron to a
 * sibling; a global install nests it).
 * @param {object} [deps] engine-install-scan seams plus {readAmicusMcpConfig}
 * @returns {{installs:Array<{kind,pkgDir,electronDir,state}>, mcpLaunch:string}}
 */
function scanElectronInstalls(deps = {}) {
  const fs = deps.fs || require('fs');
  const platform = deps.platform || process.platform;
  const readAmicusMcpConfig = deps.readAmicusMcpConfig
    || (() => require('./mcp-discovery').readAmicusMcpConfig());
  const { listAmicusInstalls, classifyLaunch } = require('./engine-install-scan');
  const { electronDirFor, probeElectronState } = require('../sidecar/electron-state');

  const installs = listAmicusInstalls(deps).map((i) => {
    const probe = probeElectronState({ electronDir: electronDirFor(i.pkgDir, { fs }), fs, platform });
    return { ...i, electronDir: probe.electronDir, state: probe.state };
  });
  let config = null;
  try { config = readAmicusMcpConfig(); } catch { /* unreadable config */ }
  return { installs, mcpLaunch: classifyLaunch(config) };
}

/**
 * @param {{scanElectronInstalls: () => {installs:Array, mcpLaunch:string}}} d
 * @returns {{id,name,status,message,hint}}
 */
function evaluateElectronInstalls(d) {
  const id = 'electron-mcp';
  const name = 'Electron (MCP launch path)';
  const { installs, mcpLaunch } = d.scanElectronInstalls();

  if (mcpLaunch === 'none') {
    return { id, name, status: 'ok', message: 'no amicus MCP registered — not checked', hint: null };
  }
  if (mcpLaunch === 'path') {
    return {
      id, name, status: 'ok',
      message: 'MCP launches from a fixed path — covered by the Electron (interactive GUI) check', hint: null,
    };
  }

  // 'npx' (and the 'unknown' fallback): verify the npx-cache copies, the ones
  // whose optional-dependency electron install can silently half-complete.
  const npxCopies = installs.filter((i) => i.kind === 'npx');
  if (npxCopies.length === 0) {
    return {
      id, name, status: 'warn',
      message: 'MCP launches via npx; no cached copy to inspect yet — run one council, then re-run doctor',
      hint: null,
    };
  }

  const broken = npxCopies.filter((i) => i.state !== 'ok');
  if (broken.length === 0) {
    return {
      id, name, status: 'ok',
      message: `electron present in ${npxCopies.length} npx-cache ${plural(npxCopies.length, 'copy', 'copies')}`,
      hint: null,
    };
  }

  // `doctor --fix` can heal binary-missing (repairElectron); a never-installed
  // package it cannot — keep the hint honest about which state is fixable.
  const anyRepairable = broken.some((i) => i.state === 'binary-missing');
  if (npxCopies.length === 1) {
    const [only] = broken;
    const message = only.state === 'binary-missing'
      ? `electron binary missing in the npx-cache copy the MCP launches: ${only.pkgDir} (electron dir: ${only.electronDir})`
      : `electron not installed in the npx-cache copy the MCP launches: ${only.pkgDir} — GUI auto-open unavailable; headless still works`;
    return { id, name, status: 'warn', message, hint: anyRepairable ? HINTS.doctorFix : null };
  }
  const detail = broken.map(describeBroken).join('; ');
  return {
    id, name, status: 'warn',
    message: `electron unavailable in ${broken.length}/${npxCopies.length} npx-cache copies: ${detail}`,
    hint: anyRepairable ? HINTS.doctorFix : null,
  };
}

/**
 * Fix-aware wrapper. When d.fix and the scan shows binary-missing npx copies,
 * heal each in place via d.repairElectron({electronDir}) — the package dir is
 * already on disk, so repairElectron can read its version and provision the
 * exe — then re-report from a fresh scan. package-missing copies are never
 * repaired (no package to repair into). Mirrors evaluateEngineMcp.
 * @param {object} d doctor deps (scanElectronInstalls, fix?, repairElectron?, fixTimeoutMs?)
 * @returns {Promise<{id,name,status,message,hint}>}
 */
async function evaluateElectronMcp(d) {
  const verdict = evaluateElectronInstalls(d);
  if (!d.fix || verdict.status === 'ok') { return verdict; }

  const { installs } = d.scanElectronInstalls();
  const repairable = installs.filter((i) => i.kind === 'npx' && i.state === 'binary-missing');
  if (repairable.length === 0) { return verdict; }

  const results = [];
  for (const b of repairable) {
    let r;
    try {
      r = await d.repairElectron({
        electronDir: b.electronDir,
        ...(d.fixTimeoutMs ? { timeoutMs: d.fixTimeoutMs } : {}),
      });
    } catch (e) { r = { repaired: false, reason: e && e.message }; }
    results.push({ electronDir: b.electronDir, ...r });
  }

  const after = evaluateElectronInstalls(d); // fresh scan reflects the repairs
  if (after.status === 'ok') {
    const n = results.length;
    return { ...after, message: `${after.message} (self-healed ${n} npx-cache ${plural(n, 'copy', 'copies')})` };
  }
  const failed = results.filter((r) => !r.repaired)
    .map((r) => `${r.electronDir}${r.reason ? ` — ${r.reason}` : ''}`).join('; ');
  return failed
    ? { ...after, message: `${after.message}; self-heal incomplete: ${failed}` }
    : after;
}

module.exports = { scanElectronInstalls, evaluateElectronInstalls, evaluateElectronMcp };
