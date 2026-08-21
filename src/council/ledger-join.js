// src/council/ledger-join.js
'use strict';

/**
 * @module council/ledger-join
 * How ONE pair group resolves into ONE ledger row's fields: which of its
 * runStats rows may decide `role`/`conformance` (SI-17's normalise), and which
 * street-cred rows are its own (the seat-aware join). Split out of ./ledger at
 * v4.8 T3.3, on the same seam T3.0 used for ./ledger-stats: that split took the
 * READ half out, this one takes the JOIN SEMANTICS out, and `buildLedgerRows`
 * keeps only the row assembly. Both dependencies run one way
 * (ledger.js -> ledger-join.js / ledger-stats.js) and neither can cycle.
 *
 * ⚠️ REQUIRE-FREE by design — the ./seats · ./run-stats-entry · ./peer-split
 * precedent. Nothing here reads the filesystem or the config dir.
 * ⚠️ NOT re-exported from ./ledger: none of the three is used outside the row
 * build, so adding them to that module's export list would only risk the
 * AUTO:modules truncation its own comment warns about. Tests import them here.
 */

/**
 * v4.8 T3.3 — SI-17's NORMALISE, per owner ruling R4 ("normalise before the
 * ledger join, inside Phase 3 — works on all paths including the two
 * hand-assembled `appendRun` ones a preflight guard cannot reach"). It lives on
 * the WRITE path — here, called from ledger.js :: buildLedgerRows — for exactly
 * that reason: `cli-handlers-council.js` and `mcp-server.js` copy `meta`
 * verbatim out of user JSON, and the documented `amicus council tally` shape
 * PUTS THE CHAIR ON THE BENCH. Both re-read 2026-08-20: docs/council.md's
 * `## Worked example` meta block is `models ["deepseek","gpt"]` with
 * `chair "deepseek"`, and tests/council/fixtures/av-receiver-input.js is
 * `models ["deepseek","gpt","mistral"]` with the same chair. There it is the
 * normal case rather than an edge — though neither of those two carries a
 * `role: 'chair'` runStats row, so neither is what this function changes.
 *
 * A `role: 'chair'` row is the CHAIR SYNTHESIS leg. That is a different
 * contract from a bench review — prose plus a VERDICT line, not findings JSON —
 * so its `conformance` and `role` describe a different job from the seat row it
 * shares an alias and a resolution with. MEASURED at BASE `b341b273` on
 * `--models ds,gpt --chair ds`, both legs resolving to `v/ds`:
 *
 *   bench UNSTRUCTURED + chair clean  ->  role 'chair', conformance 'unstructured'
 *   bench clean + chair UNSTRUCTURED  ->  role 'chair', conformance 'unstructured'
 *   the same bench with the chair OFF it -> role 'council', conformance 'clean'
 *
 * The two directions are INDISTINGUISHABLE in the persisted row, and neither
 * agrees with the off-bench control for the same bench leg — in an append-only
 * file that is never migrated. Normalising means the bench leg decides both
 * fields whenever the group holds one, so a seat's ledger identity no longer
 * depends on whether that model also chaired.
 *
 * `wasChair` is NOT normalised away: it is a fact about the run rather than
 * about a contract, it stays any-wins over the WHOLE group (T15), and it is the
 * one thing the chair row legitimately contributes to a bench seat's row.
 * A group holding ONLY chair rows — the split-resolution chair leg of T16, a
 * give-up row — is unchanged: there is no bench leg to prefer, so the chair row
 * still decides both fields and nothing is lost.
 * @param {Array<object>} group one pair group's runStats rows
 * @returns {Array<object>} the rows that may decide `role` and `conformance`
 */
function benchLegs(group) {
  const bench = group.filter(r => r.role !== 'chair');
  return bench.length ? bench : group;
}

/** Mean of the numeric values of `field` across `rows`; null when none is numeric. */
function meanCred(rows, field) {
  const nums = rows.map(r => r[field]).filter(v => typeof v === 'number');
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/**
 * v4.8 T3.3 — the street-cred join, seat-aware. THE HAZARD THIS EXISTS FOR:
 * `new Map(streetCred.map(s => [s.model, s]))` is last-wins by alias. At BASE
 * `b341b273` that was a genuine no-op — measured on bench `['a','a','b']`, the
 * two twin rows were BYTE-IDENTICAL (3 rows in, `Map` size 2: one dropped, but
 * LOSSLESSLY). The moment `street-cred.js :: rankPositions` is seat-keyed those
 * rows DIVERGE, and the same silent drop starts losing a real seat's numbers
 * into an append-only file. That is why the two halves shipped in ONE commit
 * (controller ruling ledger C-1) and why no intermediate tree may hold one
 * without the other.
 *
 * The key is `s.seat || s.model`: `seat` is emit-when-DIFFERENT, so on every
 * bench with no repeated alias every key is the alias and this is byte-for-byte
 * the old map. A pair group names its seats through `runStats[].seat`, under
 * the SAME emit rule — so a group with no seated row falls back to the alias
 * lookup, which is today's behaviour and covers `claude`, legacy input and both
 * hand-assembled `appendRun` paths.
 *
 * ⚠️ A group can cover MORE THAN ONE SEAT — two twins that resolved to the same
 * executable are one (alias, resolvedModel) pair — and a ledger row has ONE
 * street-cred slot. The row SET is not this task's to change (`meta.models`
 * stays the driver, and PR4b's emission order is one row per pair group), so
 * with one slot the choice is between dropping seats and combining them. The
 * mean is the only combination that reads every seat and still returns a lone
 * seat's own number unchanged.
 * ⚠️ It is NOT weight-preserving, and saying otherwise would be the easy wrong
 * claim: ledger-stats.js :: deriveReliability averages ROWS, so N seats folded
 * into one row count once where N separate rows would count N times. That
 * matters only when the aggregate mixes this group with other rows or other
 * runs — and it is still strictly better than today, which reads exactly one of
 * the N and discards the others without saying so.
 * @param {Map<string, object>} sc street-cred rows keyed by seat id, else alias
 * @param {Array<object>} group one pair group's runStats rows
 * @param {string} model the block's alias
 */
function credFor(sc, group, model) {
  const hits = [...new Set(group.map(r => r.seat).filter(Boolean))]
    .map(id => sc.get(id)).filter(Boolean);
  if (!hits.length) { return sc.get(model) || {}; }
  return { withSelf: meanCred(hits, 'withSelf'), peersOnly: meanCred(hits, 'peersOnly') };
}

module.exports = { benchLegs, credFor, meanCred };
