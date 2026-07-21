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

const TIER_ORDER = ['Disputed', 'Contested', 'Confirmed', 'Singleton'];
const SYMBOL = { agree: '✓', dispute: '✗', neutral: '–' };

/** Build a neutral, render-agnostic model from a verdict (+ optional wave). */
function toModel(verdict, wave) {
  if (!verdict || !Array.isArray(verdict.findings)) {
    throw new Error('verdict.json must have a findings[] array');
  }
  const judges = verdict.council || [];
  const findings = verdict.findings.map((f) => {
    const byJudge = {};
    for (const j of judges) { byJudge[j] = null; }
    for (const adj of (f.adjudications || [])) { byJudge[adj.judge] = adj.verdict; }
    return {
      id: f.id, severity: f.severity, raiser: f.raiser, tier: f.tier,
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
  const debate = {
    present: findings.some(f => f.debate) === true,
    withdrawn: verdict.findings.filter(f => f.debate && f.debate.action === 'withdrawn')
      .map(f => ({ id: f.id, previousTier: f.debate.previousTier, tier: f.tier })),
    movements: verdict.findings.filter(f => f.debate && f.debate.action !== 'withdrawn' && f.debate.action !== 'no-response'
        && f.debate.previousTier && f.debate.previousTier !== f.tier)
      .map(f => ({ id: f.id, action: f.debate.action, previousTier: f.debate.previousTier, tier: f.tier })),
  };
  const runStats = verdict.runStats || [];
  const costRows = runStats.map(r => ({
    model: r.model, status: r.status, durationMs: r.durationMs,
    cost: r.usage && r.usage.cost ? r.usage.cost : null,
  }));
  const total = (wave && wave.usage && wave.usage.cost) ? wave.usage.cost : sumWaveUsage(runStats).cost;
  return {
    header: {
      runType: verdict.runType || 'review', runId: verdict.runId, date: verdict.date,
      chair: verdict.chair, council: judges, claudeInCouncil: verdict.claudeInCouncil === true,
    },
    tierCounts: verdict.tierCounts || { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 },
    judges, findings, debate,
    streetCred: verdict.streetCred || [],
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

  if (m.debate.present) {
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
