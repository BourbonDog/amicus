// src/utils/env-num.js
'use strict';

/**
 * @module utils/env-num
 * Numeric environment override that HONORS an explicit `0`.
 *
 * WHY THIS EXISTS. The idiom `Number(process.env.X) || DEFAULT` is wrong for any
 * knob whose "off" value is `0`, because `0` is falsy and is therefore rewritten
 * back into `DEFAULT`. v4.4 shipped four such knobs — `AMICUS_USAGE_SETTLE_POLLS`,
 * `AMICUS_USAGE_SETTLE_INTERVAL_MS`, `AMICUS_USAGE_SETTLE_CALL_TIMEOUT_MS` and
 * `AMICUS_TOOL_SETTLE_GRACE_MS` — each documenting `0` as the disable switch in
 * its docblock and (for the last one) in the CHANGELOG, while making that switch
 * unreachable from the environment. The operator could read the escape hatch and
 * not use it.
 *
 * SEMANTICS. An explicit, finite numeric value always wins, `0` included. Unset,
 * blank/whitespace-only, and non-finite values fall back to the default:
 *   - blank matters because `Number('') === 0`, so a bare `export AMICUS_X=` would
 *     otherwise read as an intentional disable rather than the accident it is;
 *   - non-finite matters because `Number('Infinity')` would otherwise be fed
 *     straight into `setTimeout`/comparison arithmetic.
 *
 * NOT A BLANKET REPLACEMENT. Several older knobs (`AMICUS_POLL_INTERVAL_MS`,
 * `AMICUS_STABLE_*_POLLS`, `AMICUS_TOOL_CALL_STALL_MS`, `AMICUS_MAX_SESSIONS`, …)
 * deliberately keep `||`: `0` is not a documented escape hatch for any of them and
 * honoring it would busy-loop a poller or silently disable a stall guard. Migrate a
 * knob to this helper only when `0` is a value its call site actually understands.
 *
 * @param {string} name environment variable name
 * @param {number} dflt value used when unset / blank / non-finite
 * @param {object} [env] environment object (test seam; defaults to process.env)
 * @returns {number}
 */
function envNumber(name, dflt, env) {
  const raw = (env || process.env)[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') { return dflt; }
  const n = Number(raw);
  return Number.isFinite(n) ? n : dflt;
}

module.exports = { envNumber };
