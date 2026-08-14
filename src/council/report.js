// src/council/report.js
'use strict';

/**
 * @module council/report
 * Pure verdict/disagreement report renderer (the differentiator). Reads a
 * verdict.json (+ optional wave.json for the cost total) and produces a single
 * self-contained Markdown or HTML string. Renders deterministic data only — no
 * scoring, anonymization, or synthesis (that stays in Claude).
 */

const { formatCost, sumWaveUsage } = require('../utils/pricing');
const { formatDuration } = require('../utils/format-duration');
const { formatDegrade } = require('../utils/degrade');

const TIER_ORDER = ['Disputed', 'Contested', 'Confirmed', 'Singleton'];
const SYMBOL = { agree: '✓', dispute: '✗', neutral: '–' };

/** Build a neutral, render-agnostic model from a verdict (+ optional wave). */
function toModel(verdict, wave) {
  if (!verdict || !Array.isArray(verdict.findings)) {
    throw new Error('verdict.json must have a findings[] array');
  }
  const council = verdict.council || [];
  // 'council' (verdict.council / meta.models) is the street-cred universe and
  // legitimately includes 'claude' on a --claude-review run (buildTallyInput's
  // run-assemble.js:226, docs/council.md:326). 'judges' is the matrix column
  // set: SKILL.md:448 / run-stage2.js:61-62 guarantee Claude is judged but
  // never judges, so its reserved seat must never grow a matrix column — filter
  // it out ONLY when claudeInCouncil is true. This is name+flag gated, not
  // vote-derived: a bench judge that cast zero adjudications (dead/unstructured
  // leg, run-stages.js:204-207) is still in council/judges and must still get
  // its (blank) column — deriving the roster from "who actually voted" would
  // silently delete that column too and break the byte-unchanged-artifact
  // contract for degraded v4.0.1-shaped runs.
  const aliasJudges = verdict.claudeInCouncil === true ? council.filter(j => j !== 'claude') : council;
  // v4.8 PR4c §3.6 (R4c-8): ONE flag decides THREE readers of the seat space —
  // the roster, the vote key, and the RAISER. Gating any two of them ships a
  // self-contradicting artifact: gate the roster and the vote key only and the
  // star vanishes (`'deepseek' === 'deepseek#1'` is false for both columns);
  // gate the raiser only and the Raiser cell renders a seat id while every
  // column header renders the alias. `verdict.seats` is NEW here while
  // `adjudications[].seat` shipped in PR3, so independent fallbacks would leave
  // EVERY vote cell blank on the twin verdicts already on disk.
  // Array.isArray, not `?.`/`??`: `[]` is not nullish, so `??` would delete
  // every judge column, and a non-array `seats` throws where HEAD renders.
  // The per-element check exists because every path that reaches this function
  // with an on-disk document is schema-free — `council report <verdict.json>`
  // and `council verdict <tally.json> --render` are raw JSON.parse, and
  // `amicus_verdict` takes `record: z.record(z.any())` — while R4c-5 widened
  // the MCP tally schema to `z.array(z.any())` on purpose. So `seats: [null,…]`
  // and `seats: ["deepseek#1",…]` both arrive here: the first makes `s.id`
  // THROW where HEAD renders, the second yields `undefined` columns. A
  // malformed table falls back to alias space WHOLE instead.
  const seatSpace = Array.isArray(verdict.seats) && verdict.seats.length > 0
    && verdict.seats.every(s => s && typeof s.id === 'string');
  // No claude filter needed in seat space: seats[] is bench-only (seats.js
  // excludes the reserved claude seat), so it can never grow a claude column.
  const judges = seatSpace ? verdict.seats.map(s => s.id) : aliasJudges;
  const findings = verdict.findings.map((f) => {
    const byJudge = {};
    for (const j of judges) { byJudge[j] = null; }
    // Alias-keyed and LAST-WINS at HEAD: on a twin bench the second seat's vote
    // overwrote the first's, so a finding whose basis was a0/d1 rendered as two
    // agreements. A vote whose Stage-2 seat orphaned still keys to its bare
    // alias here, which no seat column reads — counted in basis, rendered
    // nowhere (a disclosed shape, plan §4.6, pinned in seat-matrix.test.js).
    for (const adj of (f.adjudications || [])) { byJudge[(seatSpace && adj.seat) || adj.judge] = adj.verdict; }
    return {
      // The raiser re-key IS the star fix, and it is why report-html.js needs
      // zero edits: renderMd's cell map and report-html.js's both test
      // `j === f.raiser` against THIS field, so both become seat-correct at
      // once — and the Raiser column follows instead of contradicting them.
      id: f.id, severity: f.severity, raiser: seatSpace ? (f.raiserSeat || f.raiser) : f.raiser, tier: f.tier,
      basis: f.basis || { a: 0, d: 0, n: 0 }, decision: f.decision || null,
      applied: f.applied === true, byJudge, debate: f.debate || null,
    };
  });
  // 'movements' is deliberately re-vote-only (defended/amended): a withdrawn or
  // no-response finding is never bundled into the re-vote (run-debate.js's
  // bundleFor()), so its tier — even if it happens to differ from previousTier —
  // was never "moved after re-vote". Listing it there would read as "still live,
  // just downgraded" when it was actually retracted; withdrawn findings get their
  // own list below so a reader can tell the two apart.
  // no-response findings (spec §5.7: a dead defense leg, or one still
  // unstructured after its single repair, makes that raiser's bundled
  // findings all 'no-response') get their own list, same idiom as withdrawn —
  // silently dropping them would leave a "## Debate round" heading with
  // nothing beneath it whenever a run's only debating raiser never responded.
  const debate = {
    present: findings.some(f => f.debate) === true,
    withdrawn: verdict.findings.filter(f => f.debate && f.debate.action === 'withdrawn')
      .map(f => ({ id: f.id, previousTier: f.debate.previousTier, tier: f.tier })),
    movements: verdict.findings.filter(f => f.debate && f.debate.action !== 'withdrawn' && f.debate.action !== 'no-response'
        && f.debate.previousTier && f.debate.previousTier !== f.tier)
      .map(f => ({ id: f.id, action: f.debate.action, previousTier: f.debate.previousTier, tier: f.tier })),
    noResponse: verdict.findings.filter(f => f.debate && f.debate.action === 'no-response')
      .map(f => ({ id: f.id, previousTier: f.debate.previousTier, tier: f.tier })),
  };
  const runStats = verdict.runStats || [];
  // Cost-row role tag (Plan 2 final review F1, extended v4.7 D6): #83 gave
  // judges their own runStats row, so a bench model can now appear twice
  // (seat + judge), indistinguishable by `model` alone. v4.7's row-per-launch
  // producers (chair-attempt/repair/superseded) create the exact same
  // collision for their model. Tag ONLY these four roles — old verdicts have
  // none of them, so chair/critic/lens/seat rows stay byte-identical to their
  // historical rendering (report.test.js:189-199 pins the judge case exactly).
  // Object.create(null): a plain `{...}` literal inherits Object.prototype, so a role
  // literally named 'constructor'/'toString'/etc would resolve to an inherited (truthy)
  // function via bracket lookup instead of `undefined` — silently corrupting that row's
  // rendered model label. A null-prototype object has no inherited keys to collide with.
  const ROLE_SUFFIX = Object.create(null);
  ROLE_SUFFIX.judge = 'judge';
  ROLE_SUFFIX['chair-attempt'] = 'chair-attempt';
  ROLE_SUFFIX.repair = 'repair';
  ROLE_SUFFIX.superseded = 'superseded';
  const costRows = runStats.map(r => ({
    model: ROLE_SUFFIX[r.role] ? `${r.model} (${ROLE_SUFFIX[r.role]})` : r.model,
    status: r.status, durationMs: r.durationMs,
    cost: r.usage && r.usage.cost ? r.usage.cost : null,
  }));
  const total = (wave && wave.usage && wave.usage.cost) ? wave.usage.cost : sumWaveUsage(runStats).cost;
  return {
    header: {
      runType: verdict.runType || 'review', runId: verdict.runId, date: verdict.date,
      chair: verdict.chair, council, claudeInCouncil: verdict.claudeInCouncil === true,
    },
    tierCounts: verdict.tierCounts || { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
    judges, findings, debate,
    streetCred: verdict.streetCred || [],
    // v4.6 Plan 2: additive and OPTIONAL on the verdict (verdict.js only sets
    // it when the run actually degraded), so a clean verdict's model — and
    // therefore its rendered report — is byte-for-byte unchanged.
    // Plan 2 final review F2: LOSSES ONLY — a heal is announced on stderr/run.json but
    // is not a loss (spec D4, §8), so it must never render under "What was
    // lost". deriveSeatLoss (verdict.js) applies the same kind !== 'heal' filter.
    degrades: (verdict.degrades || []).filter(d => d.kind !== 'heal'),
    cost: { rows: costRows, total },
  };
}

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
    out.push(`| ${f.id} | ${f.severity} | ${f.raiser} | ${cells.join(' | ')} | ${f.tier} | ${f.decision || ''} |`);
  }
  out.push('\n_Legend: ✓ agree · ✗ dispute · – neutral · `*` raiser\'s own vote_\n');

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

/**
 * @param {{verdict:object, wave?:object, tallyRecord?:object}} sources
 * @param {{format:'md'|'html'}} opts
 * @returns {string}
 */
function buildReport(sources, opts = {}) {
  const model = toModel(sources.verdict, sources.wave);
  if (opts.format === 'html') { return require('./report-html').renderHtml(model); }
  return renderMd(model);
}

module.exports = { buildReport, toModel, TIER_ORDER, SYMBOL };
