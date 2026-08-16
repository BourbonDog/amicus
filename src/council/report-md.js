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

  out.push('## Verdict summary\n');
  out.push('| Tier | Count |\n|---|---|');
  for (const t of TIER_ORDER) { out.push(`| ${t} | ${m.tierCounts[t]} |`); }

  // Heading-over-nothing: emitted ONLY when the run actually degraded, so a
  // clean verdict's report stays byte-identical to before this section
  // existed. Losses are headline news, so they sit directly under the
  // summary, before the reader reaches the adjudication detail.
  if (m.degrades.length) {
    out.push('\n## What was lost\n');
    // ONE voice (Plan 1's formatDegrade) — the report must not grow a dialect.
    for (const d of m.degrades) { out.push(`- ${formatDegrade(d).trimEnd()}`); }
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
  for (const s of m.streetCred) { out.push(`| ${s.model} | ${fmtNum(s.peersOnly)} | ${fmtNum(s.withSelf)} |`); }

  out.push('\n## Findings by tier\n');
  // LC-10 fast-follow (review minor M3): m.findings can legitimately be EMPTY
  // (every seat honestly reported nothing) — TIER_ORDER's four groups are then
  // all empty too, and the loop below emits nothing, leaving this heading with
  // no content beneath it before '## Cost'. Same heading-over-nothing class
  // Task 3 closed in the Stage-2 prompts (buildJudgeBundle/buildChairPacket),
  // human-facing here rather than model-facing. State the clean bench instead
  // of leaving the heading to dangle.
  if (!m.findings.length) {
    out.push('_No findings were raised on this bench — a clean review is a valid review._\n');
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
