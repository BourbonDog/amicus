#!/usr/bin/env node

/**
 * Canonicalises an engine-rendered permission rule list for comparison (#202).
 *
 * Split out of scripts/probe-council-agents.js for that script's 300-line
 * budget. One concern: the engine does not order one segment of its own
 * rendering deterministically, so a rule list has to be reduced to a
 * comparable form before two queries can be diffed. Required by that script's
 * PROBE_TREE_ROUTING_JSON case and by nothing else.
 */

'use strict';

/** @param {any} r @returns {boolean} an engine-global `external_directory` ALLOW rule */
const isExtAllow = (r) => Boolean(r) && r.permission === 'external_directory' && r.action === 'allow';

/**
 * The [start, length] of every maximal CONTIGUOUS run of `external_directory`
 * allow rules — the shape canonicaliseRules is allowed to reorder inside.
 * @param {any[]} rules @returns {Array<[number, number]>}
 */
function extAllowRunShape(rules) {
  if (!Array.isArray(rules)) { return []; }
  const runs = [];
  for (let i = 0; i < rules.length;) {
    if (!isExtAllow(rules[i])) { i += 1; } else {
      let j = i;
      while (j < rules.length && isExtAllow(rules[j])) { j += 1; }
      runs.push([i, j - i]);
      i = j;
    }
  }
  return runs;
}

/**
 * MEASURED 2026-09-17 on opencode-ai 1.18.15, and calibrated by the CONTROL
 * arm in main(): this engine does not order one segment of its own rendering
 * deterministically. The engine-global `external_directory` ALLOW rules — one
 * per skill directory it scans — come back in a DIFFERENT order on every
 * `client.app.agents()` call, with no opencode.json anywhere: two empty temp
 * directories queried back to back already differ. A raw order-including
 * deep-equal over the rule list therefore measures the engine's directory
 * enumeration, not what a tree file did.
 *
 * So each maximal CONTIGUOUS run of those rules is sorted by pattern and
 * NOTHING else is touched: every rule amicus registers, and the
 * `external_directory *` ask/deny rules that bracket the runs, keep their
 * exact positions — which is the P2-R44 / findLast fact the comparison is
 * about. `extAllowRunShape` is compared alongside, so a rule added to a run,
 * or a run that moved, is still caught. If the engine's nondeterminism ever
 * widens past this one shape the CONTROL goes false and the script exits 1,
 * rather than quietly normalising a real move away.
 * @param {any[]} rules @returns {any[]}
 */
function canonicaliseRules(rules) {
  if (!Array.isArray(rules)) { return rules; }
  const byPattern = (a, b) => {
    const x = String(a.pattern); const y = String(b.pattern);
    if (x < y) { return -1; }
    return x > y ? 1 : 0;
  };
  const runStarts = new Map(extAllowRunShape(rules));
  const result = [];
  for (let i = 0; i < rules.length;) {
    const length = runStarts.get(i);
    if (length === undefined) { result.push(rules[i]); i += 1; } else {
      result.push(...rules.slice(i, i + length).slice().sort(byPattern));
      i += length;
    }
  }
  return result;
}

module.exports = { canonicaliseRules, extAllowRunShape, isExtAllow };
