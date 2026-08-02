/**
 * @module utils/doctor-engine-check
 * The `engine-mcp` doctor check ("OpenCode engine (MCP launch path)"), split out
 * of src/cli-handlers-doctor.js to keep that file under the 300-line gate
 * (mirrors doctor-mcp-checks.js).
 *
 * The existing `opencode-bin` check verifies the engine in the RUNNING install.
 * This one verifies the copies the MCP actually launches from — the npx-cache
 * installs `npx -y amicus@latest mcp` resolves to — so a green doctor can no
 * longer hide a broken npx copy (bug report #1). Reporting only; no self-heal.
 */

'use strict';

const HINTS = require('./remediation-hints');

const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * @param {{scanEngineInstalls: () => {installs:Array, mcpLaunch:string}}} d
 * @returns {{id,name,status,message,hint}}
 */
function evaluateEngineInstalls(d) {
  const id = 'engine-mcp';
  const name = 'OpenCode engine (MCP launch path)';
  const { installs, mcpLaunch } = d.scanEngineInstalls();

  if (mcpLaunch === 'none') {
    return { id, name, status: 'ok', message: 'no amicus MCP registered — not checked', hint: null };
  }
  if (mcpLaunch === 'path') {
    return {
      id, name, status: 'ok',
      message: 'MCP launches from a fixed path — covered by the OpenCode binary check', hint: null,
    };
  }

  // 'npx' (and the 'unknown' fallback): verify the npx-cache copies, the ones
  // subject to optional-dependency skips and AV quarantine on every re-resolve.
  const npxCopies = installs.filter((i) => i.kind === 'npx');
  if (npxCopies.length === 0) {
    return {
      id, name, status: 'warn',
      message: 'MCP launches via npx; no cached copy to inspect yet — run one fanout, then re-run doctor',
      hint: null,
    };
  }

  const broken = npxCopies.filter((i) => !i.engineOk);
  if (broken.length === 0) {
    return {
      id, name, status: 'ok',
      message: `engine present in ${npxCopies.length} npx-cache ${plural(npxCopies.length, 'copy', 'copies')}`,
      hint: null,
    };
  }

  const detail = broken
    .map((i) => `${i.pkgDir} (searched: ${(i.roots || []).join(', ')})`)
    .join('; ');
  // Exactly one npx copy and it is broken → unambiguous: that IS the copy the
  // MCP will launch, and every call will fail. Elsewhere the hash npx selects is
  // ambiguous, so warn (still naming the exact broken path) rather than error.
  const status = npxCopies.length === 1 ? 'error' : 'warn';
  const lead = status === 'error'
    ? 'engine missing from the npx-cache copy the MCP launches'
    : `engine missing from ${broken.length}/${npxCopies.length} npx-cache copies`;
  return { id, name, status, message: `${lead}: ${detail}`, hint: HINTS.reinstallEngineAv };
}

/**
 * Fix-aware wrapper. When d.fix and the scan shows broken npx-cache copies, copy
 * the engine into each via d.repairEngine, then re-report from a fresh scan.
 * Without d.fix — or when nothing is copy-fixable — returns the plain verdict.
 * @param {object} d doctor deps (scanEngineInstalls, fix?, repairEngine?)
 * @returns {Promise<{id,name,status,message,hint,fixed?,fixDetail?}>}
 */
async function evaluateEngineMcp(d) {
  const verdict = evaluateEngineInstalls(d);
  if (!d.fix || verdict.status === 'ok') { return verdict; }

  const { installs } = d.scanEngineInstalls();
  const broken = installs.filter((i) => i.kind === 'npx' && !i.engineOk);
  if (broken.length === 0) { return verdict; }

  const results = [];
  for (const b of broken) {
    let r;
    try { r = await d.repairEngine({ destPkgDir: b.pkgDir }); }
    catch (e) { r = { repaired: false, reason: e && e.message }; }
    results.push({ pkgDir: b.pkgDir, ...r });
  }

  const after = evaluateEngineInstalls(d); // fresh scan reflects the copies
  if (after.status === 'ok') {
    const n = results.length;
    return {
      ...after,
      message: `${after.message} (self-healed ${n} npx-cache ${plural(n, 'copy', 'copies')})`,
      fixed: true,
      fixDetail: `copied the engine into ${n} npx-cache ${plural(n, 'copy', 'copies')}`,
    };
  }
  const failed = results.filter((r) => !r.repaired)
    .map((r) => `${r.pkgDir}${r.reason ? ` — ${r.reason}` : ''}`).join('; ');
  // Partial credit: some copies healed even though the check overall is still
  // not 'ok' — flag it ONLY when >=1 repair actually succeeded (#84-style rule).
  const healed = results.filter((r) => r.repaired).length;
  const fixFields = healed > 0
    ? { fixed: true, fixDetail: `copied the engine into ${healed} npx-cache ${plural(healed, 'copy', 'copies')}` }
    : {};
  return { ...after, message: `${after.message}; self-heal incomplete: ${failed}`, ...fixFields };
}

module.exports = { evaluateEngineInstalls, evaluateEngineMcp };
