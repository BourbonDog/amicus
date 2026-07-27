/**
 * Council Workspace — fold payload builder (v4.4 §7).
 *
 * MIRRORS the shipped fold-header builder `formatFoldOutput`
 * (src/headless.js `formatFoldOutput`, exported from src/headless.js and
 * re-exported from src/index.js) — byte-for-byte the same **7-line** head:
 * marker, Model, Session, Client, CWD, Mode, `---`. ⚠️ v4.4.1 DOC-5: this said
 * "8-line" for two releases. Line 8 (`VERDICT:`) is council's OWN addition and
 * has no counterpart in formatFoldOutput, whose 8th element is the summary
 * body. Only the first 7 lines are the shared contract; anyone changing the
 * shared format must sync those and leave `VERDICT:` alone.
 * src/headless.js is the SOURCE OF TRUTH; keep the head in sync with it.
 * (Line numbers deliberately omitted — the previous `:775-789`/`:797` citation
 * had drifted by ~500 lines.) The duplication is deliberate:
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
  // Review follow-up #2: verdict.json is NOT re-validated here (the
  // amicus_verdict MCP path types overallVerdict as a bare z.string().nullable()
  // — mcp-tools.js:428), so a multi-line or marker-bearing value must never
  // reach the head verbatim: an embedded '\n' would shift every line below
  // VERDICT: (a raw string containing '\n' becomes several elements once the
  // head array is '\n'-joined), and an embedded marker could spoof the fold.
  // Safe on the shipped engine path (parseChairVerdict returns a canonical
  // CHAIR_VERDICTS phrase) — this is defense-in-depth, not a fix for a real
  // producer.
  const overall = verdict && verdict.overallVerdict
    ? stripFoldMarkers(String(verdict.overallVerdict)).replace(/[\r\n]+/g, ' ').trim()
    : null;
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
  // ⚠️ v4.4.1 DOC-5: this used to append ` (${cost.source})` for EVERY source,
  // on top of a glyph formatCost had already spent on the same fact —
  // `~$0.3720 (mixed)`, `~$0.0100 (estimated)`, `? (unknown)`. formatCost
  // (src/utils/pricing.js) prefixes `~` for both 'estimated' and 'mixed', and
  // returns a bare `?` when the source is 'unknown'. `reported` is the one
  // source the glyph vocabulary cannot express — a plain `$0.4321` is also what
  // an unrecognised/absent source renders as — so it is the only one still
  // spelled out. This is the *fold* line, the thing that lands in the user's
  // terminal, so it says each thing once.
  const costSourceLabel = cost && cost.source === 'reported' ? ' (reported)' : '';
  head.push(`Cost: ${formatCost(cost)}${costSourceLabel}`);

  // Review follow-up #1: strip FIRST, then test emptiness on the STRIPPED
  // result — not the raw one. A chair body consisting solely of a marker
  // line (plus whitespace) is non-empty raw but strips to '', and must fall
  // back to the tally-summary label rather than embedding a blank body.
  const stripped = o.chairText ? stripFoldMarkers(String(o.chairText)).trim() : '';
  const body = stripped
    || (tierCounts ? '(no chair output — tally summary above)' : '(pre-tally: stage summary above)');

  return `${head.join('\n')}\n${body}`;
}

module.exports = { buildFoldText };
