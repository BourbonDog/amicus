/**
 * Council Workspace — adjudication matrix view model (v4.4 §5.2).
 *
 * Pure: tally.json + labelMap (+ verdict.json) → renderable rows/cells.
 * Symbols come from council/report.js SYMBOL, and the seat-space decision from
 * its isSeatSpace (single source — the report and the workspace can never
 * disagree about what the symbols mean, nor about which space a document is
 * in; the latter added by council review A3/B1). Every name-bearing field
 * carries BOTH spellings ({model, label}) so the renderer's blind toggle is a
 * pure display flip with no re-fetch. Missing
 * votes (partial waves) are blank cells, never invented neutrals — tier math
 * already excluded them (v4.0).
 *
 * ⚠️ DE-ROT (F07): `tally()` writes `tierOverride: null` on EVERY finding,
 * unconditionally (src/council/tally.js :: tally) — it is never a real source for
 * either the override badge or the post-override tier. Only `buildVerdict`
 * materializes `{from,to,reason}` and rewrites `tier` to `tierOverride.to`
 * (src/council/verdict.js:122-126). So both fields are joined in from
 * verdict.findings[] by `id`; when verdict is absent/unparseable (caller
 * passes null/undefined, or a finding has no verdict-side counterpart) the
 * row falls back to tally's own (pre-override) tier and renders no badge.
 */
'use strict';

const { SYMBOL, isSeatSpace } = require('../council/report');
const { labelFor, pairFor } = require('./blind-mode');

// v4.8 T-C2 (SI-22.5, ruling R18): the ONE column every vote whose key names no
// column folds into. A SECOND implementation on purpose — ruling R17 took the
// narrow option, so this is NOT imported from src/council/report.js and nothing
// is extracted for it. Two implementations can DRIFT — T-C2 shipped one document
// rendering two ways for a single commit — so the rule below is pinned as an
// AGREEMENT with report.js, not merely as this file's own behaviour:
// tests/council/seat-matrix.test.js drives BOTH consumers over that document.
const UNATTRIBUTED = 'UNATTRIBUTED';

/**
 * A finding's adjudications AS AN ARRAY, whatever the document actually carries.
 *
 * ⚠️ ONE expression, TWO readers, and that is the whole reason it is a function.
 * The `folded` pre-pass and the per-finding loop both walk this list, and in
 * report.js the identical pair drifted apart on type for one commit — `.some`
 * is Array-only while `for...of` takes any iterable, so `adjudications: "abc"`
 * rendered on one side and threw on the other. A non-array contributes no
 * votes: the same answer isSeatSpace gives a malformed seats table, and the
 * same answer this expression already gave inline before T-C2 hoisted it.
 */
function adjOf(f) { return Array.isArray(f.adjudications) ? f.adjudications : []; }

/** Index verdict.findings[] by id, tolerating an absent/malformed verdict doc. */
function indexVerdictFindings(verdict) {
  const byId = new Map();
  if (verdict && Array.isArray(verdict.findings)) {
    for (const vf of verdict.findings) {
      if (vf && typeof vf.id === 'string') { byId.set(vf.id, vf); }
    }
  }
  return byId;
}

/**
 * @param {object} tally parsed tally.json
 * @param {object} labelMap run.json labelMap
 * @param {object|null} [verdict] parsed verdict.json — source of truth for
 *   tierOverride and the post-override tier (⚠️ DE-ROT F07). Omitted, null,
 *   or a finding missing from it falls back to tally's tier with no badge.
 * @returns {object} MatrixModel (see plan Shared contracts)
 */
function buildMatrixModel(tally, labelMap, verdict) {
  const map = labelMap || {};
  const meta = (tally && tally.meta) || {};
  const aliasJudges = Array.isArray(meta.models) ? meta.models : [];
  // v4.8 PR4c §3.6 (R4c-8): the IDENTICAL decision report.js applies to
  // verdict.seats, here over tally.meta.seats — and since council A3/B1, the
  // identical FUNCTION rather than a second copy of the expression.
  // run-detail.js already hands this function the parsed tally.json, so the
  // 3-arg signature is unchanged. One flag for all three readers (roster, vote
  // key, raiser); see isSeatSpace for why every element must carry a string id
  // and why `??` is wrong.
  const seatSpace = isSeatSpace(meta.seats);
  // report.js filters the reserved claude seat out of ITS roster; this one
  // never has — tally.meta.models carries `claude` (run-assemble.js appends it)
  // and HEAD renders a blank column for it. seats[] is bench-only, so a seat
  // roster would silently DELETE that column; re-append it so the only thing a
  // claude run's matrix changes is the twin split.
  const claudeTail = meta.claudeInCouncil === true && aliasJudges.includes('claude') ? ['claude'] : [];
  // A column is {key, pair}: `key` is what votes and the raiser are matched
  // against, `pair` is what the renderer shows.
  // ⚠️ BLIND MODE: resolve the label from the seat's ALIAS and carry the seat's
  // ID only as identity. `pairFor(seat.id, map)` returns label:null (labelMap's
  // values are aliases), and workspace-render.js's display() then falls back to
  // pair.model and prints `deepseek#1` with blind mode ON. A seat id contains
  // its alias, so rendering one in blind mode defeats blind mode. Both twins
  // therefore collapse to `Review A` when blind — exactly as at HEAD.
  const bench = seatSpace
    ? meta.seats.map(s => ({ key: s.id, pair: { model: s.id, label: labelFor(s.alias, map) } }))
      .concat(claudeTail.map(j => ({ key: j, pair: pairFor(j, map) })))
    : aliasJudges.map(j => ({ key: j, pair: pairFor(j, map) }));
  const findings = tally && Array.isArray(tally.findings) ? tally.findings : [];
  const verdictById = indexVerdictFindings(verdict);
  // v4.8 T-C2 (SI-22.5): CLASSIFY the key instead of trusting it. At 32a63e92 the
  // domain split in two and BOTH halves lost the vote: `typeof adj.judge !==
  // 'string'` refused an absent or non-string judge outright — in seat space
  // testing a field that is not even the key, so a valid seat with a numeric
  // judge rendered nowhere — while an orphaned seat id and `''` were written to
  // a `votes` key no column reads. The roster is what makes a key mean a column,
  // so `keys.has` is the orphan test, and the three conjuncts refuse, in order, a
  // non-string, the empty string, and a string naming no column.
  // ⚠️ `key !== ''` IS NOT REDUNDANT WITH `keys.has`, and T-C2 shipped it wrong
  // for one commit, which is why the reason is written down. `isSeatSpace`
  // accepts `{id: ''}`, so a roster CAN hold `''` — and matching a `''` roster
  // key against a `''` judge matches TWO NON-IDENTITIES. That is structurally
  // the defect v4.8 T-B4 removed from src/council/peer-split.js :: peersOf, where
  // a falsy raiser matched a falsy judge and corroborated its own finding.
  // Rulings R18 and R2 both say `''` is not an identity, and a malformed roster
  // carrying `''` does not make it into a name. Without the conjunct the two
  // consumers rendered ONE document differently — the desync class PR B exists to
  // remove — so this is now the SAME classification rule report.js applies, over
  // this file's own roster. Written again, never shared (R17); a pin drives BOTH
  // consumers over that document so the agreement is enforced, not re-derived.
  // Named mutants, with their measured red sets:
  // tests/council/seat-matrix.test.js :: WSJUNKKEY and
  // tests/council/seat-matrix.test.js :: WSEMPTYOK.
  const keys = new Set(bench.map(c => c.key));
  const columnFor = (adj) => {
    const key = (seatSpace && adj.seat) || adj.judge;
    return (typeof key === 'string' && key !== '' && keys.has(key)) ? key : UNATTRIBUTED;
  };
  // ⚠️ TWO-PHASE, and here it could not be anything else: `cells` is built by
  // MAPPING this roster, so a roster decided inside the per-finding map would
  // give two rows DIFFERENT CELL COUNTS — a body that no longer matches its own
  // header. The pre-pass therefore walks every finding before the map starts.
  // ⚠️ CONDITIONAL: added unconditionally it grows a column on every matrix that
  // has no such vote. Named mutant: tests/council/seat-matrix.test.js :: WSALWAYSCOL.
  // ⚠️ `!keys.has(UNATTRIBUTED)`: a bench model literally aliased UNATTRIBUTED
  // already owns that column and R18 says ONE column. It then SHARES its cell
  // with the folded votes — disclosed, not fixed, because the column key is also
  // what the fold writes and separating them needs a renderer change.
  // ⚠️ LAST, after `claudeTail`: the fold column is not a bench member, and
  // appending keeps every existing column at the index it had at 32a63e92.
  // `concat` for uniformity with the `claudeTail` append above, NOT for safety:
  // report.js needs it because its alias roster IS `verdict.council` by
  // reference, and measured, this file has no such trap — every branch of
  // `bench` ends in a `.map`, which always allocates.
  // ⚠️ BLIND MODE — both name slots carry the same literal rather than
  // `pairFor(UNATTRIBUTED, map)`. UNATTRIBUTED has no alias to protect and no
  // identity to reveal, so the flip must be a no-op on it BY CONSTRUCTION, not
  // by `labelFor` happening to return null — which it stops doing the moment a
  // labelMap value IS `UNATTRIBUTED`, when the blind header would print a review
  // label over a column of nobody's votes.
  // Named mutant: tests/council/seat-matrix.test.js :: WSPAIRFOR.
  const folded = findings.some(f => adjOf(f).some(a => a && columnFor(a) === UNATTRIBUTED));
  const columns = folded && !keys.has(UNATTRIBUTED)
    ? bench.concat([{ key: UNATTRIBUTED, pair: { model: UNATTRIBUTED, label: UNATTRIBUTED } }])
    : bench;

  const rows = findings.map((f) => {
    const votes = {};
    for (const adj of adjOf(f)) {
      // ⚠️ HALF of 32a63e92's guard survives, and that half is doing work: `!adj`
      // skips a falsy element, which carries no verdict to fold and which
      // `columnFor` would dereference.
      // ⚠️ THE STRICTNESS DIFFERENCE THIS COMMENT USED TO RECORD IS GONE. It read
      // "report.js has no such guard and THROWS on that document"; v4.8 T-C4 gave
      // `report.js :: adjOf` a `.filter(Boolean)`, which is this predicate spelled
      // a second time — R17, two implementations, never shared. That file no longer
      // throws on a falsy element and no longer grows a phantom column for one.
      // The `typeof adj.judge` half is GONE, subsumed by the classification
      // above: it refused votes where R18 requires them folded.
      if (!adj) { continue; }
      votes[columnFor(adj)] = adj.verdict;
    }
    // The raiser's column key. In alias space this is `f.raiser` and every
    // expression below is byte-identical to HEAD.
    const raiserKey = seatSpace ? (f.raiserSeat || f.raiser) : f.raiser;
    const vf = verdictById.get(f.id);
    return {
      id: f.id,
      severity: f.severity || null,
      tier: (vf ? vf.tier : null) || f.tier || null,
      thin: f.confidence === 'thin',
      tierOverride: (vf && vf.tierOverride) || null,
      // ⚠️ DE-ROT (F29): v4.1 decorates tally.json findings in place with
      // `debate: {action, previousTier}` (src/council/debate.js :: decorateRecord; action ∈
      // defended|amended|withdrawn|no-response) and verdict.json carries it through
      // (src/council/verdict.js:43). Consumed by electron/workspace-ui/workspace-matrix.js's
      // renderMatrix, which renders a `.debate-badge` in the tier cell (alongside the
      // thin/tierOverride badges) so a withdrawn/amended/defended/no-response finding never
      // renders as an ordinary live row. Absent on non-debate runs, hence `|| null`.
      debate: f.debate || null,
      // The THIRD reader. Its label still resolves from the ALIAS (blind mode
      // must not leak a seat id here either), while its identity is the seat —
      // otherwise the starred column and the Raiser cell name different things.
      raiser: { model: raiserKey, label: labelFor(f.raiser, map) },
      basis: f.basis || { a: 0, d: 0, n: 0 },
      cells: columns.map((c) => {
        const vote = Object.prototype.hasOwnProperty.call(votes, c.key) ? votes[c.key] : null;
        return {
          judge: c.pair,
          verdict: vote,
          sym: vote ? (SYMBOL[vote] || '?') : ' ',
          isRaiser: c.key === raiserKey,
        };
      }),
    };
  });

  return {
    judges: columns.map((c) => c.pair),
    rows,
    tierCounts: (tally && tally.tierCounts) || null,
    judged: !(tally && tally.judged === false),
  };
}

module.exports = { buildMatrixModel };
