// src/council/report-md.js
'use strict';

/**
 * @module council/report-md
 * The markdown renderer for the neutral report model. Extracted verbatim from
 * ./report (v4.8 Phase 1 T1.2) to give that file headroom under the 300-line
 * gate — it was at 298/300, two lines from blocking its own next edit.
 * Mirrors ./report-html exactly: one renderer, one exported function, taking
 * the model ./report's toModel builds, and requiring TIER_ORDER/SYMBOL back
 * from ./report — safe because buildReport requires this module lazily.
 */

const { formatCost } = require('../utils/pricing');
const { formatDuration } = require('../utils/format-duration');
const { TIER_ORDER, SYMBOL } = require('./report');
const { formatDegrade } = require('../utils/degrade');

function fmtNum(v) { return (v === null || v === undefined) ? '—' : v.toFixed(2); }
function fmtDur(ms) { return formatDuration(ms, '—'); }

function renderMd(m) {
  const h = m.header;
  const out = [];
  out.push(`# Council Report — ${h.runType} (${h.runId})`);
  const meta = [h.date, h.chair ? `chair: ${h.chair}` : null, `council: ${h.council.join(', ')}`,
    h.claudeInCouncil ? 'Claude in council' : null].filter(Boolean).join(' · ');
  out.push(`\n_${meta}_\n`);

  // v4.9 PR #200 round-4 B1: the section carrying the run's PRIMARY summary is
  // named for what the run PRODUCED. A task run has no verdict — its chair closes
  // with `ANSWER:` (`parse-stage2.js :: parseChairTerminal` picks that parser off
  // the same intent, `verdict.js :: CHAIR_ANSWERS` is its scale) — so 'Verdict
  // summary' named the wrong artifact on the one heading a skimmer reads. Forked
  // in BOTH renderers, pinned SEPARATELY per renderer (the R8/street-cred rule:
  // a shared pin would let either regress silently). Review runs keep the exact
  // old string, which is what holds both .snap documents byte-identical.
  // Named mutant: SUMMARYLABEL (tests/council/report-intent.test.js).
  out.push(m.intent === 'task' ? '## Answer summary\n' : '## Verdict summary\n');
  out.push('| Tier | Count |\n|---|---|');
  for (const t of TIER_ORDER) { out.push(`| ${t} | ${m.tierCounts[t]} |`); }
  // v4.9 W8 T-A (spec §5.4): the concurrence qualifier, on a TASK run only, and
  // directly under the counts it qualifies — a reader who reads only the tier
  // table must not be able to miss it. Gated exactly as the `†` legend below is:
  // written unconditionally it would shift every later line of every review
  // report and redden both .snap documents. Named mutant: QUALIFIERDROP
  // (tests/council/report-intent.test.js).
  if (m.intent === 'task') { out.push('\n_Tiers report peer concurrence, never verification._'); }

  // Heading-over-nothing: emitted ONLY when the run actually degraded, so a
  // clean verdict's report stays byte-identical to before this section
  // existed. Losses are headline news, so they sit directly under the
  // summary, before the reader reaches the adjudication detail.
  if (m.degrades.length) {
    out.push('\n## What was lost\n');
    // ONE voice (Plan 1's formatDegrade) — the report must not grow a dialect.
    for (const d of m.degrades) { out.push(`- ${formatDegrade(d).trimEnd()}`); }
  }
  // v4.9 W8 T-A: kind:'info' records are announcements, not losses (`report.js ::
  // toModel` splits them), so they get their own list and NOT the '## What was
  // lost' heading. A bold lead-in rather than an `##` heading — the same weight
  // the debate sub-lists below carry, because a note is not headline news.
  // `m.notes &&` matches the `m.degrades || []` tolerance report-html.js already
  // has: hand-built models in the report suites carry neither key.
  if (m.notes && m.notes.length) {
    out.push('\n**Notes:**\n');
    for (const d of m.notes) { out.push(`- ${formatDegrade(d).trimEnd()}`); }
  }

  out.push('\n## Adjudication matrix\n');
  out.push(`| Finding | Sev | Raiser | ${m.judges.join(' | ')} | Tier | Decision |`);
  out.push(`|---|---|---|${m.judges.map(() => '---').join('|')}|---|---|`);
  for (const f of m.findings) {
    const cells = m.judges.map((j) => {
      const v = f.byJudge[j];
      return (v ? SYMBOL[v] : ' ') + (j === f.raiser ? '*' : '');
    });
    // v4.8 PR5a T6 (R5-10): the R8 marker rides the TIER cell. It qualifies the tier's
    // implicit claim of independent corroboration, which is exactly what R8 exists to stop
    // overstating — and the other two candidate placements (the finding row, the raiser
    // cell) are both pinned by seat-matrix.test.js on the one fixture that carries the flag.
    const tier = f.sameModelCorroboration ? `${f.tier}†` : f.tier;
    out.push(`| ${f.id} | ${f.severity} | ${f.raiser} | ${cells.join(' | ')} | ${tier} | ${f.decision || ''} |`);
  }
  out.push('\n_Legend: ✓ agree · ✗ dispute · – neutral · `*` raiser\'s own vote_\n');
  // ⚠️ GATED. Written unconditionally this line shifts every subsequent line of a
  // unique-alias report, breaking byte-identity on EVERY run and reddening the existing
  // pins and all four snapshots. Only a twin bench can raise the flag, so only a twin
  // bench gets the line.
  if (m.findings.some(f => f.sameModelCorroboration)) {
    out.push('_`†` corroborated only by another seat running the SAME model — concurrence, not independent support._\n');
  }

  out.push('## Street-cred (peers-only; lower = better)\n');
  out.push('| Model | peers-only | with-self |\n|---|---|---|');
  // v4.8 SI-22.4 rider (R22.4-6): key the row by its SEAT, falling back to the
  // alias — the same `s.seat || s.model` fallback SI-25 used at the chair
  // packet's rendering sites. A twin bench emits one street-cred row PER SEAT
  // (street-cred.js :: computeStreetCred), each with its own numbers, so keying
  // on `s.model` printed two DIFFERENT numbers under one identical label with
  // nothing to say which seat was which. `seat` is emit-when-DIFFERENT, so a
  // unique-alias bench has no `seat` KEY AT ALL and this line is byte-identical
  // to what it wrote before — which is what keeps the report snapshots green.
  // ⚠️ The key's absence comes from `street-cred.js :: computeStreetCred`'s
  // row literal (`...(seat ? { seat } : {})`), NOT from `credSeats`. This
  // comment used to cite `credSeats: seat: id === m ? null : id`, which is a
  // real expression but the wrong mechanism: credSeats emits `seat: null` —
  // the property PRESENT and null — and computeStreetCred is what drops it.
  // The pin asserts absence (`'seat' in r === false`), so cite the producer
  // that actually makes it absent.
  // Named mutant: tests/council/preset-trim-mutants.js :: ROWSEATDROP.
  for (const s of m.streetCred) { out.push(`| ${s.seat || s.model} | ${fmtNum(s.peersOnly)} | ${fmtNum(s.withSelf)} |`); }

  out.push('\n## Findings by tier\n');
  // LC-10 fast-follow (review minor M3): m.findings can legitimately be EMPTY
  // (every seat honestly reported nothing) — TIER_ORDER's four groups are then
  // all empty too, and the loop below emits nothing, leaving this heading with
  // no content beneath it before '## Cost'. Same heading-over-nothing class
  // Task 3 closed in the Stage-2 prompts (buildJudgeBundle/buildChairPacket),
  // human-facing here rather than model-facing. State the clean bench instead
  // of leaving the heading to dangle.
  if (!m.findings.length) {
    out.push(m.intent === 'task'
      ? '_No adjudicable claims were declared on this bench — an answer whose reasoning is fully inline is a valid answer._\n'
      : '_No findings were raised on this bench — a clean review is a valid review._\n');
  } else {
    for (const t of TIER_ORDER) {
      const group = m.findings.filter(f => f.tier === t);
      if (!group.length) { continue; }
      out.push(`### ${t}`);
      for (const f of group) {
        const dec = f.decision ? ` — ${f.decision}${f.applied ? ' (applied)' : ''}` : '';
        out.push(`- **${f.id}** (${f.severity}, raiser ${f.raiser}) — a${f.basis.a}/d${f.basis.d}/n${f.basis.n}${dec}`);
      }
      out.push('');
    }
  }

  // Defensive: never emit the heading unless at least one grouping has
  // content — a heading over nothing is worse than no heading.
  if (m.debate.present && (m.debate.withdrawn.length || m.debate.movements.length || m.debate.noResponse.length)) {
    out.push('\n## Debate round\n');
    if (m.debate.withdrawn.length) {
      out.push('**Withdrawn by raiser:**');
      for (const w of m.debate.withdrawn) {
        const arrow = w.previousTier && w.previousTier !== w.tier ? `${w.previousTier} → ${w.tier}` : (w.previousTier || w.tier);
        out.push(`- ${w.id}: ${arrow} (withdrawn — no longer live)`);
      }
      out.push('');
    }
    if (m.debate.movements.length) {
      out.push('**Tier movements after re-vote:**');
      for (const mv of m.debate.movements) { out.push(`- ${mv.id}: ${mv.previousTier} → ${mv.tier} (${mv.action})`); }
      out.push('');
    }
    if (m.debate.noResponse.length) {
      out.push('**No response (raiser did not defend):**');
      for (const nr of m.debate.noResponse) {
        const arrow = nr.previousTier && nr.previousTier !== nr.tier ? `${nr.previousTier} → ${nr.tier}` : (nr.previousTier || nr.tier);
        out.push(`- ${nr.id}: ${arrow} (no response — original stands)`);
      }
      out.push('');
    }
  }

  out.push('## Cost\n');
  out.push('| Model | Status | Duration | Cost |\n|---|---|---|---|');
  for (const r of m.cost.rows) { out.push(`| ${r.model} | ${r.status} | ${fmtDur(r.durationMs)} | ${formatCost(r.cost)} |`); }
  out.push(`| **Wave total** | | | ${formatCost(m.cost.total)} |`);

  return out.join('\n') + '\n';
}

module.exports = { renderMd };
