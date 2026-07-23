/**
 * @module doctor-local-providers-check
 * The `local-providers` doctor check (v4.2 §4.7 C8), split out of
 * src/cli-handlers-doctor.js to keep that file under the 300-line size gate
 * (mirrors doctor-mcp-checks.js / doctor-engine-check.js).
 *
 * Reachability is WARN-never-ERROR (parity with the electron and
 * openrouter-credit checks): a configured-but-unreachable local server (e.g.
 * `ollama serve` simply not running) is informational, not a doctor failure
 * that flips `amicus doctor`'s exit code. No configured local providers at
 * all is a plain 'ok' ("none configured"), never a warning.
 *
 * Each configured provider is probed once, bounded by probeLocalProvider's
 * own timeout (2s here) -- doctor never introduces an unbounded wait, no
 * matter how many local providers are configured.
 */

'use strict';

/**
 * @param {{getLocalProviders: () => Object<string, {id:string, baseURL:string, flavor?:string, apiKeyEnv?:string}>, probeLocalProvider: (entry:object, opts:{timeoutMs:number, bearer?:string}) => Promise<{status:'ok'|'unreachable', models:string[]}>}} d
 * @returns {Promise<{id:string, name:string, status:string, message:string, hint:?string}>}
 */
async function evaluateLocalProviders(d) {
  const id = 'local-providers';
  const name = 'Local providers';
  const map = d.getLocalProviders();
  // Object.keys (never `for..in` / `map.hasOwnProperty`) -- local-providers.js
  // stamps entries on via a plain `out[id] = ...` assignment, so a provider id
  // like 'constructor' is a real OWN property that shadows the inherited one;
  // Object.keys + bracket access below resolves it correctly either way.
  const ids = Object.keys(map);
  if (ids.length === 0) {
    return { id, name, status: 'ok', message: 'none configured', hint: null };
  }

  const parts = [];
  let anyDown = false;
  for (const providerId of ids) {
    const entry = map[providerId];
    const bearer = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : undefined;
    const probe = await d.probeLocalProvider(entry, { timeoutMs: 2000, bearer });
    if (probe.status === 'ok') {
      parts.push(`${providerId}: ${probe.models.length} models @ ${entry.baseURL}`);
    } else {
      anyDown = true;
      parts.push(`${providerId}: unreachable @ ${entry.baseURL}`);
    }
  }

  // WARN, never ERROR (parity with electron/openrouter-credit -- a napping
  // local server must not fail CI).
  const flavorHint = ids.map((i) => map[i].flavor).find((f) => f === 'lmstudio')
    ? 'Start the LM Studio server (Developer → Start Server), or `ollama serve`.'
    : 'Start the local server, e.g. `ollama serve`.';

  return anyDown
    ? { id, name, status: 'warn', message: parts.join('; '), hint: flavorHint }
    : { id, name, status: 'ok', message: parts.join('; '), hint: null };
}

module.exports = { evaluateLocalProviders };
