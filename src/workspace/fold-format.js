/**
 * Council Workspace — fold payload builder (v4.4 §7).
 *
 * MIRRORS the shipped fold-header builder `formatFoldOutput`
 * (src/headless.js:775-789, exported at :797, re-exported from src/index.js:20)
 * — byte-for-byte the same 8-line head. src/headless.js is the SOURCE OF
 * TRUTH; keep the head in sync with it. The duplication is deliberate:
 * requiring headless.js transitively pulls opencode-client / progress /
 * conversation-mirror at require time (src/headless.js:8-17), which
 * src/workspace/ must stay free of.
 * ⚠️ DE-ROT (F58): the header used to claim it "reuses the v4.0 marker/nonce
 * contract exactly" while silently dropping formatFoldOutput's nonce-required
 * throw (src/headless.js:776-778). The guard is restored in buildFoldText below.
 * No model call — the chair result already exists on disk, so a workspace fold
 * is a local read+format.
 * The chair body is UNTRUSTED model text: it passes through stripFoldMarkers
 * before embedding, so chair prose containing a marker can never truncate or
 * spoof the fold (the exact hazard the nonce closure exists for).
 * Degradation mirrors the engine's ladder: no chair → VERDICT: none + tally
 * summary; pre-tally → stage/status summary. Never blocked, always labeled.
 */
'use strict';

const { buildFoldMarker, stripFoldMarkers } = require('../utils/fold-marker');
const { formatCost } = require('../utils/pricing');

function ok(doc) { return doc && !doc.parseError ? doc : null; }

function tierLine(tierCounts) {
  const t = tierCounts || {};
  const n = (k) => (typeof t[k] === 'number' ? t[k] : 0);
  return `Tiers: Confirmed ${n('Confirmed')} · Disputed ${n('Disputed')} · Contested ${n('Contested')} · Singleton ${n('Singleton')}`;
}

function stageSummary(run) {
  const stages = Array.isArray(run.stages) ? run.stages : [];
  return stages.length ? stages.map((s) => `${s.name}: ${s.status}`).join(' · ') : 'no stages recorded';
}

/**
 * @param {object} o {nonce, project, run, tally?, verdict?, chairText?}
 * @returns {string} the fold block (marker first line; no trailing newline)
 */
function buildFoldText(o) {
  // ⚠️ DE-ROT (F58): mirror formatFoldOutput's v4.0 §9 guard (src/headless.js:776).
  // Without it a missing nonce emits `[SIDECAR_FOLD:]`, which the hex-only marker
  // regex (src/utils/fold-marker.js:68) never parses — a silently unfoldable block.
  if (!o || !o.nonce) { throw new TypeError('buildFoldText requires a per-run nonce (v4.0 §9)'); }
  const run = o.run || {};
  const verdict = ok(o.verdict);
  const tally = ok(o.tally);
  const overall = verdict && verdict.overallVerdict ? verdict.overallVerdict : null;
  const tierCounts = (verdict && verdict.tierCounts) || (tally && tally.tierCounts) || null;
  const cost = run.usage && run.usage.cost ? run.usage.cost : null;

  const head = [
    buildFoldMarker(o.nonce),
    `Model: ${run.chair || 'unknown'}`,
    `Session: ${run.runId || 'unknown'}`,
    'Client: council-workspace',
    `CWD: ${o.project}`,
    'Mode: council',
    '---',
    `VERDICT: ${overall || 'none'}`,
  ];
  if (tierCounts) {
    head.push(tierLine(tierCounts));
  } else {
    head.push(`Run: ${run.status || 'unknown'} — ${stageSummary(run)}`);
  }
  head.push(`Cost: ${formatCost(cost)}${cost && cost.source ? ` (${cost.source})` : ''}`);

  const body = o.chairText && String(o.chairText).trim()
    ? stripFoldMarkers(String(o.chairText)).trim()
    : (tierCounts ? '(no chair output — tally summary above)' : '(pre-tally: stage summary above)');

  return `${head.join('\n')}\n${body}`;
}

module.exports = { buildFoldText };
