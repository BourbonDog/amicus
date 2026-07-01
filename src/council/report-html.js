// src/council/report-html.js
'use strict';

/**
 * @module council/report-html
 * Self-contained HTML renderer for the council report (inline CSS, no server,
 * tier-colored rows). Consumes the neutral model from council/report.js.
 */

const { formatCost } = require('../utils/pricing');
const { formatDuration } = require('../utils/format-duration');
const { TIER_ORDER, SYMBOL } = require('./report');
const { tokenCss } = require('../design/tokens');

const TIER_VAR = {
  Disputed: 'var(--tier-disputed)',
  Contested: 'var(--tier-contested)',
  Confirmed: 'var(--tier-confirmed)',
  Singleton: 'var(--tier-singleton)',
};
const TIER_INK = {
  Disputed: 'var(--tier-disputed-ink)',
  Contested: 'var(--tier-contested-ink)',
  Confirmed: 'var(--tier-confirmed-ink)',
  Singleton: 'var(--tier-singleton-ink)',
};

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function num(v) { return (v === null || v === undefined) ? '—' : v.toFixed(2); }
function dur(ms) { return formatDuration(ms, '—'); }

function renderHtml(m) {
  const h = m.header;
  const judgeHead = m.judges.map(j => `<th>${esc(j)}</th>`).join('');
  const matrixRows = m.findings.map((f) => {
    const cells = m.judges.map((j) => {
      const v = f.byJudge[j];
      return `<td class="c">${v ? SYMBOL[v] : ''}${j === f.raiser ? '<sup>*</sup>' : ''}</td>`;
    }).join('');
    return `<tr style="background:${TIER_VAR[f.tier] || '#fff'}">` +
      `<td>${esc(f.id)}</td><td>${esc(f.severity)}</td><td>${esc(f.raiser)}</td>${cells}` +
      `<td style="color:${TIER_INK[f.tier] || 'inherit'};font-weight:600">${esc(f.tier)}</td>` +
      `<td>${esc(f.decision || '')}</td></tr>`;
  }).join('');
  const credRows = m.streetCred.map(s =>
    `<tr><td>${esc(s.model)}</td><td>${num(s.peersOnly)}</td><td>${num(s.withSelf)}</td></tr>`).join('');
  const tierRows = TIER_ORDER.map(t =>
    `<tr><td>${t}</td><td>${m.tierCounts[t]}</td></tr>`).join('');
  const costRows = m.cost.rows.map(r =>
    `<tr><td>${esc(r.model)}</td><td>${esc(r.status)}</td><td>${dur(r.durationMs)}</td>` +
    `<td>${esc(formatCost(r.cost))}</td></tr>`).join('');
  const meta = [h.date, h.chair ? `chair: ${h.chair}` : null, `council: ${h.council.join(', ')}`,
    h.claudeInCouncil ? 'Claude in council' : null].filter(Boolean).map(esc).join(' · ');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Council Report — ${esc(h.runId)}</title>
<style>
${tokenCss()}
:root {
  /* Council tiers — light-ground palette + ink. Intentionally re-declared
     here with the SAME values tokenCss() emits (self-documenting + robust to
     a loader refactor; the cascade resolves identically). */
  --tier-confirmed: #d7ead0;
  --tier-contested: #efe4c4;
  --tier-disputed: #ecd4ec;
  --tier-singleton: #e2e0ea;
  --tier-confirmed-ink: #15803d;
  --tier-contested-ink: #b45309;
  --tier-disputed-ink: #a21caf;
  --tier-singleton-ink: #4b5563;
}
body { font: 14px/1.6 'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; background: #fff; }
h1 { font-family: 'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 1.5rem; font-weight: 700; letter-spacing: -.02em; }
h2 { font-family: 'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif; margin-top: 2rem; font-weight: 600; border-bottom: 1px solid #e5e7eb; padding-bottom: .25rem; }
table { border-collapse: collapse; width: 100%; margin: .5rem 0; }
th, td { border: 1px solid #e5e7eb; padding: .35rem .5rem; text-align: left; }
th { background: #f9fafb; font-family: 'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif; font-weight: 600; }
td.c { text-align: center; }
.meta, .legend { color: #6b7280; font-family: 'IBM Plex Mono', ui-monospace, monospace; }
.legend { font-size: .85rem; }
</style></head><body>
<h1>Council Report — ${esc(h.runType)} (${esc(h.runId)})</h1>
<p class="meta">${meta}</p>
<h2>Verdict summary</h2>
<table><tr><th>Tier</th><th>Count</th></tr>${tierRows}</table>
<h2>Adjudication matrix</h2>
<table><tr><th>Finding</th><th>Sev</th><th>Raiser</th>${judgeHead}<th>Tier</th><th>Decision</th></tr>${matrixRows}</table>
<p class="legend">✓ agree · ✗ dispute · – neutral · <sup>*</sup> raiser's own vote</p>
<h2>Street-cred <span class="meta">(peers-only; lower = better)</span></h2>
<table><tr><th>Model</th><th>peers-only</th><th>with-self</th></tr>${credRows}</table>
<h2>Cost</h2>
<table><tr><th>Model</th><th>Status</th><th>Duration</th><th>Cost</th></tr>${costRows}
<tr><td><strong>Wave total</strong></td><td></td><td></td><td>${esc(formatCost(m.cost.total))}</td></tr></table>
</body></html>
`;
}

module.exports = { renderHtml };
