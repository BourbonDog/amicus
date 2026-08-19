// src/council/run-debate.js
'use strict';

/**
 * @module council/run-debate
 * Impure Stage-2.5 orchestration for headless debate mode (spec §5.1). Launches the
 * defense mini-wave (one solo per raiser) and the re-vote mini-wave (one fanout to
 * disputing judges), parses each with one bounded repair, then hands off to the pure
 * reassembly in ./debate.js. Launchers are injected via ctx (repo DI pattern).
 */

const fs = require('fs');
const path = require('path');
const dbrief = require('./briefings-debate');
const { parseDebateDefense } = require('./parse-stage2');
const { applyDebate, debateRunStatsRows, PAST_TENSE,
  allNoResponse, nothingToDebate, disputingJudges, debateTargets, bundleFor } = require('./debate');
const { materializeDebate } = require('./run-launch');
const { buildSeats } = require('./seats');
const { tally } = require('./tally');
const { isAbortExit } = require('./run-stages');
const runState = require('./run-state');
const { legOpts, legRow, runRevoteWave } = require('./run-debate-revote');

/**
 * One raiser's defense solo.
 *
 * v4.8 PR3 Task 6 — the raiser boundary. `raiserKey` is a SEAT key (debateTargets
 * keys byRaiser on `f.raiserSeat || f.raiser`), so it is projected ONCE, here, to
 * the routable bench alias. ⚠️ `aliasOf` is a `const` local to `runDebate`; this
 * is a module-scope function, so under 'use strict' a bare `aliasOf(...)` would
 * be a ReferenceError on the first defense solo of every debate run — it is
 * threaded explicitly instead.
 *
 * `raiserKey` survives in exactly two places here: the returned `{raiser}` (which
 * becomes defenseByRaiser's key — §3.3: that MUST stay seat-keyed, because
 * re-keying it to the alias is last-wins and silently drops one twin's entire
 * debate row plus its amended claim) and the `seat` runDebate derives from it.
 * Everything else — both launch sites, both legRow calls, the stub and the
 * returned leg's `model` — is `raiserAlias`.
 *
 * @param {object} ctx
 * @param {string} raiserKey seat key of the raiser
 * @param {Array<object>} findings that raiser's contested/disputed findings
 * @param {number} idx defense-wave position (names the waveId)
 * @param {function(string): string} aliasOf seat key → bench alias
 */
async function runDefenseSolo(ctx, raiserKey, findings, idx, aliasOf) {
  const raiserAlias = aliasOf(raiserKey);
  const brief = dbrief.buildDefenseBrief({ findings, date: ctx.o.date });
  const waveId = `${ctx.o.runId}-d${idx + 1}`;
  const expectedIds = findings.map(f => f.id);
  // Record the sub-wave BEFORE launching: `amicus abort` cascades over stages[].waveIds
  // (run-stages.js's record(), run-chair.js's chair chain), so an id written after the
  // launch leaves an in-flight leg reachable only by the pid kill. The v4.0.1
  // abort-cascade fix must hold for debate stages too.
  runState.appendStageWave(ctx.o.runDir, 'debate-defense', waveId);
  const res = await ctx.launchers.launchSolo({ ...legOpts(ctx, waveId), model: raiserAlias, prompt: brief });
  ctx.addWave(res.wave);
  if (isAbortExit(res.exitCode)) { return { raiser: raiserKey, aborted: res.exitCode }; }
  let leg = res.leg && res.leg.status === 'complete' ? res.leg : null;
  // A dead leg gets the SAME spec §5.7 fallback the parser applies to a block-level
  // failure — every expected id 'no-response', never an empty map, so the
  // originals-stand outcome still reaches debate.json and the record decoration.
  let parsed = leg ? parseDebateDefense(leg.summary, expectedIds)
    : { ok: false, byId: allNoResponse(expectedIds), errors: [{ code: 'DEAD_LEG', detail: 'no summary' }] };
  let conformance = leg ? 'clean' : 'unstructured';
  // v4.7 D2/E4: the repair's loser leg — the ORIGINAL when the repair produced a
  // usable (complete) leg (today's leg-swap below is unchanged), or the failed
  // repair attempt itself when it did not — retained so runDebate can turn it
  // into an extra debate-defense runStats row. Both stay null when no repair is
  // attempted at all (today's single-row shape, byte-identical).
  let supersededLeg = null, repairLeg = null;
  if (leg && !parsed.ok) {
    const repairId = `${waveId}r`;
    runState.appendStageWave(ctx.o.runDir, 'debate-defense', repairId);
    const res2 = await ctx.launchers.launchSolo({
      ...legOpts(ctx, repairId), model: raiserAlias,
      // ⚠️ LC-12: a repair solo is a fresh session — the defense that failed rides along.
      prompt: dbrief.buildDefenseRepairPrompt({ errors: parsed.errors, defense: leg.summary }),
    });
    ctx.addWave(res2.wave);
    if (isAbortExit(res2.exitCode)) { return { raiser: raiserKey, aborted: res2.exitCode }; }
    const leg2 = res2.leg && res2.leg.status === 'complete' ? res2.leg : null;
    parsed = leg2 ? parseDebateDefense(leg2.summary, expectedIds) : parsed;
    conformance = parsed.ok ? 'repaired' : 'unstructured';
    if (leg2) { supersededLeg = legRow(raiserAlias, leg, 'unstructured'); leg = leg2; }
    else { repairLeg = legRow(raiserAlias, res2.leg, 'unstructured'); }
  }
  // A dead leg (no complete summary) OR an 'unstructured' conformance after the one
  // repair is a debate degradation (spec §5.7) — surfaced via the returned leg.
  const stub = { model: raiserAlias, status: 'error', durationMs: null, usage: null, conformance: 'unstructured', summary: '' };
  return { raiser: raiserKey, byId: parsed.byId,
    leg: leg ? { model: raiserAlias, status: leg.status, durationMs: leg.durationMs, usage: leg.usage,
      conformance, summary: leg.summary, waveId: leg.waveId,
      ...(leg.model ? { resolvedModel: leg.model } : {}) } : stub,
    supersededLeg, repairLeg };
}

/**
 * Full Stage-2.5 sequence (spec §5.1). Returns everything run.js needs. Cost gate: run.js
 * checks overBudget before invoking; this checks again before the re-vote wave (spec §5.7).
 * @param {object} ctx run.js's {o, launchers, addWave, overBudget, scratchDir}
 * @param {{provisionalRecord: object, tallyInput: object}} args
 */
async function runDebate(ctx, { provisionalRecord, tallyInput }) {
  const { byRaiser, previousTier } = debateTargets(provisionalRecord, tallyInput);
  const contested = provisionalRecord.findings.filter(f => f.tier === 'Contested').length;
  const disputed = provisionalRecord.findings.filter(f => f.tier === 'Disputed').length;
  // v4.8 PR3 Task 6 (spec §4.5): ONE seat→alias projection for the whole round —
  // both debate waves, both repair solos, applyDebate's fail-open push and every
  // artifact literal read it, so there is exactly one shape and one name.
  // ⚠️ The table is RE-DERIVED when `o.seats` is absent, mirroring
  // run-stage1-launch.js:20-22 verbatim. Falling back to an EMPTY map instead
  // was the PR2b failure shape, not a safe default: that same Stage-1 fallback
  // means a direct-require caller's findings/adjudications carry composed seat
  // ids (`deepseek#1`) while `o.seats` is falsy, so `aliasOf` would be the
  // identity over them and send a NON-ROUTABLE model name to three launchers
  // (measured: r-d1 model="deepseek#1", r-d2 "deepseek#2", r-rv models
  // ["gpt","deepseek#2","deepseek#1"]). buildSeats is pure and total, so the
  // reconstruction is the same table Stage 1 bound against (spec §4.3).
  // `aliasOf` is the identity only for a key that is no seat id at all: the
  // reserved 'claude' key, and — because `s.alias === s.id` there — every bench
  // without a repeated alias, i.e. every bench that has ever run.
  const seatTable = Array.isArray(ctx.o.seats) && ctx.o.seats.length > 0
    ? ctx.o.seats
    : buildSeats(ctx.o.models, ctx.o.critic, ctx.o.lenses);
  const seatById = new Map(seatTable.map(s => [s.id, s]));
  const aliasOf = (key) => { const s = seatById.get(key); return s ? s.alias : key; };

  // ---- Defense mini-wave: ONE CONCURRENT solo per raiser (spec §5.1) ----
  // Concurrent, not sequential: every raiser gets its OWN briefing, so this is N independent
  // solos rather than one fanout wave. No per-leg budget check interleaves between them — the
  // cost ceiling is a WHOLE-ROUND gate run.js applies BEFORE calling runDebate
  // ('skipped-cost-ceiling' is a round-level outcome in spec §5.1's enum, not a per-leg one).
  // `appendStageWave` is sync fs and each solo registers its waveId before its first await,
  // so concurrency cannot interleave a read-modify-write of run.json.
  // v4.1 §4.4: the reserved seat 'claude' is a FILE-sourced review with no leg to
  // launch, so it is never asked to defend — its contested findings simply stand
  // (the same "originals stand" outcome as a no-response).
  const raisers = Object.keys(byRaiser).filter(m => m !== 'claude');
  const defenseResults = await Promise.all(
    raisers.map((raiserKey, i) => runDefenseSolo(ctx, raiserKey, byRaiser[raiserKey], i, aliasOf)));
  // A signal during the defense wave aborts the whole finalization (spec §5.7):
  // return the abort code so run.js finalizes 'aborted' with NO tally-final / NO ledger.
  const abortedDefense = defenseResults.find(d => d.aborted);
  if (abortedDefense) { return { aborted: abortedDefense.aborted, contested, disputed }; }
  // ⚠️ This literal lives in runDebate, where `raiserAlias` does not exist — the
  // projection is `aliasOf(d.raiser)`. `model` must stay ALIAS-valued (R3-1);
  // `seat` is what gives two twins two files instead of one clobbered one (R3-3).
  materializeDebate(ctx.o.runDir, defenseResults.map(d => ({ model: aliasOf(d.raiser),
    summary: d.leg.summary, seat: seatById.get(d.raiser) || null })), 'rebuttal');

  const defenseByRaiser = {};
  for (const dr of defenseResults) { defenseByRaiser[dr.raiser] = { ...dr.byId }; }
  // v4.1 §4.4: claude never gets a defense leg (raisers filter above), but its
  // contested/disputed findings still need an audit trail — the SAME spec §5.7
  // "originals stand" fallback a dead/unrepaired defense leg gets. Seeded into
  // defenseByRaiser ONLY (never defenseResults, which feeds the `bad(l)`
  // degraded check below — a claude entry there would wrongly flip a clean run
  // to degraded/exit 2).
  if (byRaiser.claude) { defenseByRaiser.claude = allNoResponse(byRaiser.claude.map(f => f.id)); }
  // Stamp previousTier onto the tally input: applyDebate reads it off tallyInput.findings[]
  // (it ignores the provisional record), so without this every row's previousTier is null.
  const stampedInput = { ...tallyInput, findings: tallyInput.findings.map(f => ({ ...f, previousTier: previousTier[f.id] })) };

  // ---- Re-vote mini-wave (disputing judges only) ----
  let revoteByJudge = {}, revoteLegs = [], revoteSuperseded = [], revoteRepairs = [];
  const defendedOrAmended = bundleFor(defenseResults, tallyInput);
  // Seat ids (D6: one entry per disputing SEAT, so a twin bench launches two legs
  // where one launched before). runRevoteWave needs the seat OBJECTS too — for the
  // -rv bind roster and each leg's artifact name — so they are resolved here off
  // the same table `aliasOf` reads, padded inside runRevoteWave per §3.4.
  const judgeKeys = disputingJudges(provisionalRecord, defendedOrAmended.map(f => f.id));
  const judgeSeats = judgeKeys.map(k => seatById.get(k) || null);
  // A re-vote is warranted only when something was defended/amended AND ≥1 judge disputed it.
  // Skipping THAT case because the whole-run budget is spent is the 'skipped-cost-ceiling'
  // degradation branch (spec §5.7); skipping because there is simply nothing to re-vote is NOT.
  const wouldRevote = defendedOrAmended.length > 0 && judgeKeys.length > 0;
  const costCeiling = ctx.overBudget() && wouldRevote;
  // run.js needs to know whether the wave actually launched so it can
  // checkpoint debate-revote 'skipped' (not a false 'complete') when nothing
  // was defended/amended, or the cost ceiling skipped it (spec §5.7).
  const revoteLaunched = wouldRevote && !costCeiling;
  if (revoteLaunched) {
    const rv = await runRevoteWave(ctx, judgeKeys, defendedOrAmended, judgeSeats, aliasOf);
    if (rv.aborted) { return { aborted: rv.aborted, contested, disputed }; }
    revoteByJudge = rv.byJudge;
    revoteLegs = rv.legs;
    revoteSuperseded = rv.supersededLegs;
    revoteRepairs = rv.repairLegs;
    // revote-<model>.md per surviving judge leg, mirroring rebuttal-<model>.md
    // (spec §5.1 'raw outputs revote-<model>.md').
    materializeDebate(ctx.o.runDir, revoteLegs, 'revote');
  }

  // ---- Pure reassembly ----
  // ⚠️ `aliasOf` MUST ride along: without it applyDebate's fail-open push writes a
  // SEAT ID into the alias-space `judge` field, which reaches peer-split.js ::
  // peersOf's `v.judge !== f.raiser` (measured: basis {a:1,d:0} → tier Confirmed
  // where the alias spelling gives Singleton) and report.js's `byJudge[adj.judge]`.
  const { input: debatedInput, debateFindings } = applyDebate({
    tallyInput: stampedInput, provisionalRecord, defenseByRaiser, revoteByJudge, aliasOf });
  debatedInput.runStats = [...(debatedInput.runStats || []),
    ...debateRunStatsRows({ defenseLegs: defenseResults.map(d => d.leg), revoteLegs,
      // v4.7 D2/E4: the retained loser legs from every raiser's defense repair
      // plus every judge's re-vote repair — same append, no new channel into
      // buildTallyInput.
      supersededLegs: [...defenseResults.map(d => d.supersededLeg).filter(Boolean), ...revoteSuperseded],
      repairLegs: [...defenseResults.map(d => d.repairLeg).filter(Boolean), ...revoteRepairs] })];

  // verdictChanges: findings whose tier moved from provisional to debated.
  const provTierById = new Map(provisionalRecord.findings.map(f => [f.id, f.tier]));
  const debatedRec = tally(debatedInput);
  let verdictChanges = 0;
  for (const f of debatedRec.findings) { if (provTierById.get(f.id) !== f.tier) { verdictChanges += 1; } }

  // ---- Artifacts + summary ----
  // `revoteByJudge` is SEAT-keyed, but debate.json's `revotes[]` has a real
  // consumer that joins on the ALIAS — electron/workspace-ui/workspace-panels.js's
  // drillIntoJudge matches `r.judge === judgePair.model`, and its comment states
  // that contract explicitly. So `judge` stays the alias and the seat rides
  // beside it, emitted only when it differs (a unique bench writes today's
  // byte-identical debate.json).
  const revotesJson = [];
  for (const [key, perId] of Object.entries(revoteByJudge)) {
    const alias = aliasOf(key);
    for (const [id, rv] of Object.entries(perId)) {
      revotesJson.push({ judge: alias, ...(alias !== key ? { seat: key } : {}),
        id, verdict: rv.verdict, reason: rv.reason || null, applied: true });
    }
  }
  fs.writeFileSync(path.join(ctx.o.runDir, 'debate.json'),
    JSON.stringify({ findings: debateFindings, revotes: revotesJson }, null, 2), { mode: 0o600 });

  const counts = { defended: 0, amended: 0, withdrawn: 0, noResponse: 0 };
  const COUNT_KEY = { defend: 'defended', amend: 'amended', withdraw: 'withdrawn' };
  for (const df of debateFindings) { counts[COUNT_KEY[df.action] || 'noResponse'] += 1; }
  const debateSummary = {
    enabled: true, outcome: costCeiling ? 'skipped-cost-ceiling' : 'ran',
    contested, disputed, ...counts,
    revoteJudges: revoteLegs.length, revoteApplied: revotesJson.length, verdictChanges,
  };

  // ---- Degradation (spec §5.7) → run.js maps this to exit code 2 ----
  // A dead/unstructured-after-repair defense solo, a partial or fully-dead re-vote wave, or a
  // cost-ceiling skip of a warranted re-vote each degrade the run. (Abort short-circuits above;
  // nothing-to-debate and a clean run are NOT degradations.)
  const bad = (l) => l.status !== 'complete' || l.conformance === 'unstructured';
  const degraded = defenseResults.some(d => bad(d.leg)) || revoteLegs.some(bad) || costCeiling;

  // Chair-addendum outcomes (spec §5.3c). `action` is the PAST_TENSE form
  // buildDebateAddendum renders verbatim — only the four valid values ever reach it.
  // ⚠️ priorVerdicts and revotes MUST share ONE key space: briefings-debate.js's
  // renderer iterates Object.keys(revotes) and looks up prior[j], so a skew prints
  // `no prior verdict` on EVERY line. Both are keyed seat-side here.
  const priorById = new Map(provisionalRecord.findings.map(
    f => [f.id, Object.fromEntries((f.adjudications || []).map(a => [a.seat || a.judge, a.verdict]))]));
  const addendumOutcomes = debateFindings.map(df => ({
    id: df.id, originalClaim: (tallyInput.findings.find(f => f.id === df.id) || {}).claim,
    action: PAST_TENSE[df.action] || PAST_TENSE['no-response'],
    amendedClaim: df.action === 'amend' ? df.claim : null,
    priorVerdicts: priorById.get(df.id) || {},
    revotes: Object.fromEntries(revotesJson.filter(r => r.id === df.id).map(r => [r.seat || r.judge, r.verdict])),
  }));

  return { debatedInput, debateFindings, debateSummary, addendumOutcomes,
    defenseLegs: defenseResults.map(d => d.leg), revoteLegs, verdictChanges,
    degraded, aborted: null, revoteLaunched };
}

module.exports = { runDebate, nothingToDebate, disputingJudges, debateTargets };
