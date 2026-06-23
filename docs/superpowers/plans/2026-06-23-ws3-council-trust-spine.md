# WS-3 Council Trust Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the LLM Council's hand-math trust machinery into deterministic, regression-guarded code (findings contract, tier tally, reliability ledger, machine-readable verdict) while the council stays a Claude-driven skill.

**Architecture:** Four pure modules in a new `src/council/` directory — `findings.js` (validate Stage-1 JSON), `tally.js` (peers-only tier cascade + both street-cred numbers + run-stats validation → a `record`), `verdict.js` (`buildVerdict` + atomic write of `verdict.json`), `ledger.js` (append model-level rows + derive reliability) — exposed through a new `amicus council` CLI group (`tally`, `stats`). Claude assembles the de-anonymized tally input, may override margin tiers, and writes prose artifacts; the engine only does arithmetic and schemas.

**Tech Stack:** Node.js (CommonJS, `'use strict'`), Jest. No new runtime dependencies. Reuses WS-2 `src/utils/error-doc.js` (`failJson`, `ERROR_CODES`), `src/utils/config.js` (`getConfigDir`), and the WS-2 v2 `result-schema` `usage` block.

## Global Constraints

- **Module system:** CommonJS, each file starts `'use strict';`. Match existing `src/` style.
- **Size gate:** every `src/**/*.js` file must stay **≤ 300 lines** (`scripts/check-file-sizes.js`). This is why tally/verdict are separate files; split further if a file approaches the limit. `tests/**` is not size-gated.
- **Schema versions:** every new council schema (`findings` output, tally `record`, `verdict`, ledger row) carries its own `schemaVersion: 1`, **independent** of the embedded WS-2 `result-schema` `SCHEMA_VERSION` (currently `2`). Never renumber the embedded `usage`/`runStats` sub-objects.
- **Peers-only rule:** a finding's tier and a model's canonical street-cred **exclude the raiser's / model's own vote**. Report both `withSelf` and `peersOnly`; the ledger and bench-recs consume `peersOnly`.
- **No invented numbers:** `tally` validates and echoes caller-supplied `runStats`; missing `durationMs`/`usage` → `null`, never a guess.
- **`--json` failures:** call `failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message, hint })` (writes the WS-2 envelope to stdout, returns exit 1). Never hand-roll the envelope.
- **Atomic writes:** `verdict.json` and any rewritten file use tmp-write + `rename` (match the repo's `wave.json` convention).
- **Git policy:** build in worktree `C:/Users/sendt/dev/amicus-ws3` on branch `ws3/council-trust-spine`, created off the post-plan `main` HEAD (see "Worktree setup" below), node_modules junctioned so husky hooks fire. **Local-only** — no push/PR/publish until the user OKs the milestone. Commit after every green step.
- **Boundary:** code does deterministic arithmetic/formatting/schema only. Anonymization, de-anonymization, synthesis, and tier overrides are Claude's inline skill work.

---

## Worktree setup (run once before Task 1)

The spec and this plan are committed to local `main`. Create the isolated worktree off the
**post-plan HEAD** (not the stale `3a83af7` the spec names), pinning the branch name the Task 9
merge expects:

```bash
git -C C:/Users/sendt/dev/amicus worktree add C:/Users/sendt/dev/amicus-ws3 -b ws3/council-trust-spine HEAD
# then junction node_modules so husky hooks fire (PowerShell, run once):
#   New-Item -ItemType Junction -Path C:\Users\sendt\dev\amicus-ws3\node_modules -Target C:\Users\sendt\dev\amicus\node_modules
```

All task commits land on branch `ws3/council-trust-spine` inside `C:/Users/sendt/dev/amicus-ws3`. Run
every command below from that worktree directory.

---

### Task 1: Findings contract validator (`findings.js`)

**Files:**
- Create: `src/council/findings.js`
- Test: `tests/council/findings.test.js`

**Interfaces:**
- Produces: `validateFindings(jsonText: string) → { ok: boolean, findings: Array<{id:number, severity:string, claim:string, location:string, rationale:string}>, errors: Array<{code:string, detail:string}> }`. Error `code ∈ {NO_FENCED_BLOCK, NOT_PARSEABLE, EMPTY_FINDINGS, DUPLICATE_ID, NON_SEQUENTIAL_ID, BAD_SEVERITY, MISSING_FIELD}`. `findings` is the parsed array when `ok`, else `[]`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/council/findings.test.js
'use strict';
const { validateFindings } = require('../../src/council/findings');

const valid = '```json\n' + JSON.stringify({
  overall: 'ok',
  findings: [
    { id: 1, severity: 'blocker', claim: 'c1', location: 'l1', rationale: 'r1' },
    { id: 2, severity: 'minor', claim: 'c2', location: 'l2', rationale: 'r2' },
  ],
}) + '\n```';

describe('validateFindings', () => {
  test('accepts a well-formed fenced block', () => {
    const res = validateFindings('prose...\n' + valid);
    expect(res.ok).toBe(true);
    expect(res.findings).toHaveLength(2);
    expect(res.errors).toEqual([]);
  });

  test('uses the LAST fenced json block when prose quotes json', () => {
    const decoy = '```json\n{"findings":[]}\n```';
    const res = validateFindings(decoy + '\nmore prose\n' + valid);
    expect(res.ok).toBe(true);
    expect(res.findings).toHaveLength(2);
  });

  test('NO_FENCED_BLOCK when absent', () => {
    const res = validateFindings('just prose, no block');
    expect(res.ok).toBe(false);
    expect(res.errors[0].code).toBe('NO_FENCED_BLOCK');
  });

  test('NOT_PARSEABLE on broken json', () => {
    const res = validateFindings('```json\n{not json}\n```');
    expect(res.ok).toBe(false);
    expect(res.errors[0].code).toBe('NOT_PARSEABLE');
  });

  test('EMPTY_FINDINGS when list empty', () => {
    const res = validateFindings('```json\n{"findings":[]}\n```');
    expect(res.errors.map(e => e.code)).toContain('EMPTY_FINDINGS');
  });

  test('DUPLICATE_ID and NON_SEQUENTIAL_ID', () => {
    const dup = '```json\n' + JSON.stringify({ findings: [
      { id: 1, severity: 'minor', claim: 'a', location: 'a', rationale: 'a' },
      { id: 1, severity: 'minor', claim: 'b', location: 'b', rationale: 'b' },
    ] }) + '\n```';
    expect(validateFindings(dup).errors.map(e => e.code)).toContain('DUPLICATE_ID');
    const gap = '```json\n' + JSON.stringify({ findings: [
      { id: 1, severity: 'minor', claim: 'a', location: 'a', rationale: 'a' },
      { id: 3, severity: 'minor', claim: 'b', location: 'b', rationale: 'b' },
    ] }) + '\n```';
    expect(validateFindings(gap).errors.map(e => e.code)).toContain('NON_SEQUENTIAL_ID');
  });

  test('BAD_SEVERITY and MISSING_FIELD', () => {
    const bad = '```json\n' + JSON.stringify({ findings: [
      { id: 1, severity: 'critical', claim: 'a', location: 'a', rationale: 'a' },
    ] }) + '\n```';
    expect(validateFindings(bad).errors.map(e => e.code)).toContain('BAD_SEVERITY');
    const miss = '```json\n' + JSON.stringify({ findings: [
      { id: 1, severity: 'minor', claim: 'a' },
    ] }) + '\n```';
    expect(validateFindings(miss).errors.map(e => e.code)).toContain('MISSING_FIELD');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/council/findings.test.js`
Expected: FAIL — `Cannot find module '../../src/council/findings'`.

- [ ] **Step 3: Implement `findings.js`**

```javascript
// src/council/findings.js
'use strict';

const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];
const REQUIRED = ['claim', 'location', 'rationale'];

/** Extract the LAST ```json fenced block's body, or null. */
function lastJsonBlock(text) {
  const re = /```json\s*\n([\s\S]*?)```/g;
  let m, last = null;
  while ((m = re.exec(text)) !== null) { last = m[1]; }
  return last;
}

/**
 * Validate a Stage-1 reviewer's fenced findings JSON.
 * @param {string} jsonText full review text (prose + fenced block)
 * @returns {{ok:boolean, findings:Array, errors:Array<{code:string,detail:string}>}}
 */
function validateFindings(jsonText) {
  const errors = [];
  const body = lastJsonBlock(jsonText || '');
  if (body === null) {
    return { ok: false, findings: [], errors: [{ code: 'NO_FENCED_BLOCK', detail: 'no ```json block found' }] };
  }
  let parsed;
  try { parsed = JSON.parse(body); }
  catch (e) { return { ok: false, findings: [], errors: [{ code: 'NOT_PARSEABLE', detail: e.message }] }; }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  if (findings.length === 0) {
    errors.push({ code: 'EMPTY_FINDINGS', detail: 'findings is missing or empty' });
  }
  const seen = new Set();
  findings.forEach((f, i) => {
    if (seen.has(f.id)) { errors.push({ code: 'DUPLICATE_ID', detail: `id ${f.id} repeats` }); }
    seen.add(f.id);
    if (f.id !== i + 1) { errors.push({ code: 'NON_SEQUENTIAL_ID', detail: `expected id ${i + 1}, got ${f.id}` }); }
    if (!SEVERITIES.includes(f.severity)) { errors.push({ code: 'BAD_SEVERITY', detail: `bad severity '${f.severity}' on id ${f.id}` }); }
    for (const k of REQUIRED) {
      if (typeof f[k] !== 'string' || f[k].trim() === '') { errors.push({ code: 'MISSING_FIELD', detail: `missing ${k} on id ${f.id}` }); }
    }
  });

  return { ok: errors.length === 0, findings: errors.length === 0 ? findings : [], errors };
}

module.exports = { validateFindings, SEVERITIES };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/council/findings.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/council/findings.js tests/council/findings.test.js
git commit -m "feat(ws3): Stage-1 findings contract validator (#5)"
```

---

### Task 2: Tier cascade (`tally.js` — `assignTier`)

**Files:**
- Create: `src/council/tally.js`
- Test: `tests/council/tally.test.js`

**Interfaces:**
- Produces: `assignTier(a:number, d:number) → { tier: 'Disputed'|'Confirmed'|'Contested'|'Singleton', confidence: 'thin'|'solid' }`. `a`/`d` are **peer** agree/dispute counts (raiser excluded). `confidence='thin'` iff `a+d ≤ 1`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/council/tally.test.js
'use strict';
const { assignTier } = require('../../src/council/tally');

describe('assignTier (peers-only cascade)', () => {
  const cases = [
    [2, 0, 'Confirmed', 'solid'],
    [3, 1, 'Confirmed', 'solid'],
    [0, 2, 'Disputed', 'solid'],
    [1, 2, 'Disputed', 'solid'],
    [1, 1, 'Contested', 'solid'],
    [0, 1, 'Contested', 'thin'],
    [1, 0, 'Singleton', 'thin'],
    [0, 0, 'Singleton', 'thin'],
    [2, 2, 'Contested', 'solid'], // large-bench tie → Contested
  ];
  test.each(cases)('a=%i d=%i → %s/%s', (a, d, tier, confidence) => {
    expect(assignTier(a, d)).toEqual({ tier, confidence });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/council/tally.test.js -t 'cascade'`
Expected: FAIL — `Cannot find module '../../src/council/tally'` (the file doesn't exist until Step 3).

- [ ] **Step 3: Implement `assignTier` (start `tally.js`)**

```javascript
// src/council/tally.js
'use strict';

/**
 * Peers-only tier cascade. a/d are agree/dispute counts among PEER judges
 * (the raiser's own adjudication is excluded by the caller).
 * Exhaustive and mutually exclusive over all (a,d).
 * @returns {{tier:string, confidence:'thin'|'solid'}}
 */
function assignTier(a, d) {
  let tier;
  if (d >= 2 && d > a) { tier = 'Disputed'; }
  else if (a >= 2 && a > d) { tier = 'Confirmed'; }
  else if (d >= 1) { tier = 'Contested'; }
  else { tier = 'Singleton'; }
  const confidence = (a + d <= 1) ? 'thin' : 'solid';
  return { tier, confidence };
}

module.exports = { assignTier };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/council/tally.test.js -t 'cascade'`
Expected: PASS (9 cases).

- [ ] **Step 5: Commit**

```bash
git add src/council/tally.js tests/council/tally.test.js
git commit -m "feat(ws3): peers-only tier cascade (#1)"
```

---

### Task 3: Street-cred (`tally.js` — `computeStreetCred`)

**Files:**
- Modify: `src/council/tally.js`
- Test: `tests/council/tally.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `computeStreetCred(rankings, models) → Array<{model, withSelf:number|null, peersOnly:number|null, perJudgeRank: Object}>`.
  - `rankings`: `Array<{judge:string, order:Array<string|string[]>}>` — `order` is best-first; a nested array is a tie group (fractional ranking).
  - A judge a model is **absent** from is skipped for that model. `peersOnly=null` when there are 0 non-self judges. A model that casts no ranking has `withSelf===peersOnly`.

- [ ] **Step 1: Write the failing tests (non-degenerate by design)**

```javascript
// add to tests/council/tally.test.js
const { computeStreetCred } = require('../../src/council/tally');

describe('computeStreetCred', () => {
  test('withSelf differs from peersOnly when self-rank differs', () => {
    // X ranks itself #1 but peers rank it #3; Y and Z rank X last.
    const rankings = [
      { judge: 'X', order: ['X', 'Y', 'Z'] },
      { judge: 'Y', order: ['Y', 'Z', 'X'] },
      { judge: 'Z', order: ['Z', 'Y', 'X'] },
    ];
    const sc = computeStreetCred(rankings, ['X', 'Y', 'Z']);
    const x = sc.find(s => s.model === 'X');
    expect(x.withSelf).toBeCloseTo((1 + 3 + 3) / 3); // 2.333
    expect(x.peersOnly).toBeCloseTo((3 + 3) / 2);    // 3.0
    expect(x.withSelf).not.toBeCloseTo(x.peersOnly);
  });

  test('fractional ranking for a tie group', () => {
    const rankings = [{ judge: 'X', order: [['A', 'B'], 'C'] }];
    const sc = computeStreetCred(rankings, ['A', 'B', 'C']);
    expect(sc.find(s => s.model === 'A').withSelf).toBeCloseTo(1.5);
    expect(sc.find(s => s.model === 'B').withSelf).toBeCloseTo(1.5);
    expect(sc.find(s => s.model === 'C').withSelf).toBeCloseTo(3);
  });

  test('peersOnly is null when there are no peers (single judge ranks only self)', () => {
    const rankings = [{ judge: 'A', order: ['A'] }];
    const sc = computeStreetCred(rankings, ['A']);
    expect(sc[0].withSelf).toBe(1);
    expect(sc[0].peersOnly).toBeNull();
  });

  test('a model that casts no ranking has withSelf === peersOnly', () => {
    // Claude is reviewed (in models + others rank it) but never judges.
    const rankings = [
      { judge: 'X', order: ['X', 'claude'] },
      { judge: 'Y', order: ['claude', 'Y'] },
    ];
    const sc = computeStreetCred(rankings, ['X', 'Y', 'claude']);
    const c = sc.find(s => s.model === 'claude');
    expect(c.withSelf).toBeCloseTo((2 + 1) / 2);
    expect(c.peersOnly).toBeCloseTo(c.withSelf);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/council/tally.test.js -t 'computeStreetCred'`
Expected: FAIL — `computeStreetCred is not a function`.

- [ ] **Step 3: Implement `computeStreetCred`**

```javascript
// add to src/council/tally.js (above module.exports)
function mean(arr) { return arr.reduce((s, x) => s + x, 0) / arr.length; }

/** Map each model to its (possibly fractional) rank position in one judge's order. */
function rankPositions(order) {
  const pos = new Map();
  let p = 1;
  for (const slot of order) {
    const group = Array.isArray(slot) ? slot : [slot];
    const meanPos = p + (group.length - 1) / 2;
    for (const m of group) { pos.set(m, meanPos); }
    p += group.length;
  }
  return pos;
}

/**
 * Both-numbers street-cred. Lower mean rank = better.
 * @param {Array<{judge:string, order:Array<string|string[]>}>} rankings
 * @param {string[]} models all reviewed models (incl. claude when in-council)
 */
function computeStreetCred(rankings, models) {
  const judgePos = rankings.map(r => ({ judge: r.judge, pos: rankPositions(r.order) }));
  return models.map(m => {
    const all = [], peers = [], perJudgeRank = {};
    for (const { judge, pos } of judgePos) {
      if (!pos.has(m)) { continue; }       // absent from this judge's ranking → skip
      const rank = pos.get(m);
      perJudgeRank[judge] = rank;
      all.push(rank);
      if (judge !== m) { peers.push(rank); }
    }
    return {
      model: m,
      withSelf: all.length ? mean(all) : null,
      peersOnly: peers.length ? mean(peers) : null,
      perJudgeRank,
    };
  });
}

module.exports = { assignTier, computeStreetCred };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/council/tally.test.js -t 'computeStreetCred'`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/council/tally.js tests/council/tally.test.js
git commit -m "feat(ws3): both-numbers street-cred with fractional ties (#1)"
```

---

### Task 4: `tally()` integration + av-receiver golden fixture

**Files:**
- Modify: `src/council/tally.js`
- Create: `tests/council/fixtures/av-receiver-input.js`
- Test: `tests/council/tally.test.js`

**Interfaces:**
- Consumes: `assignTier`, `computeStreetCred`.
- Produces: `tally(input) → record`.
  - `input` = `{ meta:{runId,runType,date,models:string[],chair,claudeInCouncil}, findings:[{id,raiser,severity,claim}], rankings:[{judge,order}], adjudications:[{judge,findingId,verdict:'agree'|'dispute'|'neutral'}], runStats:[{model,role:'council'|'redteam'|'claude',wasChair:boolean,conformance,status,durationMs,usage}] }`.
  - `record` = `{ schemaVersion:1, meta, judged:boolean, streetCred, findings:[{id,raiser,severity,tier,basis:{a,d,n},confidence,tierOverride:null,adjudications}], runStats, tierCounts:{Confirmed,Contested,Singleton,Disputed} }`. `basis` counts **peers only**; echoed `adjudications` keep **all** votes (incl. the raiser's self, for matrix annotation). `judged = rankings.length >= 2`.

- [ ] **Step 1: Build the golden fixture from the real matrix**

```javascript
// tests/council/fixtures/av-receiver-input.js
'use strict';
// De-anonymized from output/av-receiver-council/crossreview-matrix.md.
// Judges: deepseek, gpt, mistral. Reviews: A=deepseek, B=gpt, C=mistral.
// Each row: [findingId, raiser, severity, {deepseek,gpt,mistral verdict}]
const V = { '✓': 'agree', '✗': 'dispute', '–': 'neutral' };
const ROWS = [
  ['A1','deepseek','blocker','✓✓✓'], ['A2','deepseek','blocker','✓✓✓'],
  ['A3','deepseek','minor','✓–✓'],   ['A4','deepseek','major','✓✓✓'],
  ['A5','deepseek','major','✓✓✓'],   ['A6','deepseek','minor','✓✓–'],
  ['A7','deepseek','minor','✓––'],   ['A8','deepseek','minor','✓✓✓'],
  ['B1','gpt','blocker','✓✓✓'], ['B2','gpt','major','✓✓✓'], ['B3','gpt','major','✓✓✓'],
  ['B4','gpt','major','✓✓✓'], ['B5','gpt','major','✓✓✓'], ['B6','gpt','major','✓✓✓'],
  ['B7','gpt','minor','✓✓–'], ['B8','gpt','minor','✓✓–'], ['B9','gpt','minor','✓✓✓'],
  ['B10','gpt','minor','✓✓–'], ['B11','gpt','minor','✓✓–'], ['B12','gpt','nit','✓✓–'],
  ['C1','mistral','major','✓✓✓'], ['C2','mistral','minor','–✗–'], ['C3','mistral','minor','✓✗✓'],
  ['C4','mistral','major','✓✓✓'], ['C5','mistral','minor','✓––'], ['C6','mistral','blocker','✗✗✗'],
  ['C7','mistral','major','✗✗✓'], ['C8','mistral','major','✓✓✓'], ['C9','mistral','major','✓–✓'],
  ['C10','mistral','major','✓––'], ['C11','mistral','minor','✓✓–'], ['C12','mistral','major','✗✗✓'],
  ['C13','mistral','minor','✓✓–'], ['C14','mistral','major','✓✓✓'], ['C15','mistral','blocker','✓✓✓'],
];
const JUDGES = ['deepseek', 'gpt', 'mistral'];
const findings = ROWS.map(([id, raiser, severity]) => ({ id, raiser, severity, claim: id }));
const adjudications = [];
for (const [id, , , marks] of ROWS) {
  [...marks].forEach((mark, i) => adjudications.push({ judge: JUDGES[i], findingId: id, verdict: V[mark] }));
}
const rankings = JUDGES.map(j => ({ judge: j, order: ['gpt', 'deepseek', 'mistral'] }));
const runStats = JUDGES.map(m => ({
  model: m, role: 'council', wasChair: m === 'deepseek', conformance: 'clean',
  status: 'complete', durationMs: null, usage: null,
}));
module.exports = {
  meta: { runId: 'av-receiver-council', runType: 'product-recommendation',
          date: '2026-06-23T15:00:00Z', models: JUDGES, chair: 'deepseek', claudeInCouncil: false },
  findings, rankings, adjudications, runStats,
};
```

- [ ] **Step 2: Write the failing golden + null-leg tests**

```javascript
// add to tests/council/tally.test.js
const { tally } = require('../../src/council/tally');
const avInput = require('./fixtures/av-receiver-input');

describe('tally() — av-receiver golden fixture', () => {
  const record = tally(avInput);
  const tierOf = id => record.findings.find(f => f.id === id).tier;

  test('tierCounts match the verified peers-only result', () => {
    expect(record.tierCounts).toEqual({ Confirmed: 19, Contested: 2, Singleton: 11, Disputed: 3 });
  });

  test('the eight self-agree downgrades land as Singleton', () => {
    for (const id of ['A3','A6','B7','B8','B10','B11','B12','C9']) { expect(tierOf(id)).toBe('Singleton'); }
  });

  test('C2 stays Contested (engine removes the grid/summary contradiction)', () => {
    expect(tierOf('C2')).toBe('Contested');
    expect(record.findings.find(f => f.id === 'C2').basis).toEqual({ a: 0, d: 1, n: 1 });
  });

  test('disputed findings are the three C-series factual errors', () => {
    expect(['C6','C7','C12'].map(tierOf)).toEqual(['Disputed','Disputed','Disputed']);
  });

  test('basis excludes the raiser; adjudications keep all votes; tierOverride is null', () => {
    const a1 = record.findings.find(f => f.id === 'A1');
    expect(a1.basis).toEqual({ a: 2, d: 0, n: 0 });          // peers gpt+mistral
    expect(a1.adjudications).toHaveLength(3);                 // incl. deepseek self
    expect(a1.tierOverride).toBeNull();                       // tally never records overrides (that's buildVerdict)
  });

  test('judged is true and runStats echo through with null durations', () => {
    expect(record.judged).toBe(true);
    expect(record.runStats.every(r => r.durationMs === null)).toBe(true);
  });

  test('schemaVersion is the council version, independent of WS-2', () => {
    expect(record.schemaVersion).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest tests/council/tally.test.js -t 'golden'`
Expected: FAIL — `tally is not a function`.

- [ ] **Step 4: Implement `tally()`**

```javascript
// add to src/council/tally.js (above module.exports; update exports)
const COUNCIL_SCHEMA_VERSION = 1;
const VERDICTS = { agree: 'a', dispute: 'd', neutral: 'n' };

function countTiers(findings) {
  const counts = { Confirmed: 0, Contested: 0, Singleton: 0, Disputed: 0 };
  for (const f of findings) { counts[f.tier] += 1; }
  return counts;
}

/**
 * Deterministic council tally. Pure: no IO. Claude assembles `input`
 * (de-anonymized) and may override margin tiers afterward.
 * @returns {object} record
 */
function tally(input) {
  const { meta, findings, rankings, adjudications, runStats } = input;
  const byFinding = new Map();
  for (const adj of adjudications) {
    if (!byFinding.has(adj.findingId)) { byFinding.set(adj.findingId, []); }
    byFinding.get(adj.findingId).push({ judge: adj.judge, verdict: adj.verdict });
  }
  const outFindings = findings.map(f => {
    const votes = byFinding.get(f.id) || [];
    const peers = votes.filter(v => v.judge !== f.raiser);
    const basis = { a: 0, d: 0, n: 0 };
    for (const v of peers) { basis[VERDICTS[v.verdict]] += 1; }
    const { tier, confidence } = assignTier(basis.a, basis.d);
    return { id: f.id, raiser: f.raiser, severity: f.severity, tier, basis, confidence,
             tierOverride: null, adjudications: votes };
  });
  return {
    schemaVersion: COUNCIL_SCHEMA_VERSION,
    meta,
    judged: Array.isArray(rankings) && rankings.length >= 2,
    streetCred: computeStreetCred(rankings || [], meta.models),
    findings: outFindings,
    runStats: (runStats || []).map(r => ({
      model: r.model, role: r.role, wasChair: !!r.wasChair, conformance: r.conformance || 'clean',
      status: r.status || 'unknown',
      durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
      usage: r.usage || null,
    })),
    tierCounts: countTiers(outFindings),
  };
}

module.exports = { assignTier, computeStreetCred, tally, COUNCIL_SCHEMA_VERSION };
```

- [ ] **Step 5: Run to verify pass; check the size gate**

Run: `npx jest tests/council/tally.test.js && npm run check:sizes`
Expected: PASS; `tally.js` under 300 lines (it lands ~110). Use the `npm run check:sizes` alias (it passes `--all`); a bare `node scripts/check-file-sizes.js` only scans git-staged files and would vacuously pass here, before `git add`. (If `tally.js` ever nears the limit, move `assignTier`+`computeStreetCred` to `src/council/scoring.js` and re-export.)

- [ ] **Step 6: Commit**

```bash
git add src/council/tally.js tests/council/tally.test.js tests/council/fixtures/av-receiver-input.js
git commit -m "feat(ws3): tally() record + av-receiver golden fixture (#1)"
```

---

### Task 5: Verdict builder (`verdict.js`)

**Files:**
- Create: `src/council/verdict.js`
- Test: `tests/council/verdict.test.js`

**Interfaces:**
- Consumes: a tally `record` (Task 4).
- Produces:
  - `buildVerdict(record, decisions) → verdict`. `decisions`: `Array<{id, decision:'accepted'|'denied'|'modified'|'deferred', applied:boolean, duplicateOf:string|null, tierOverride:{from,to,reason}|null}>`. Top-level fields come from `record.meta`. When a decision carries `tierOverride`, the finding's `tier` becomes `tierOverride.to`.
  - `writeVerdictAtomic(filePath, verdict) → void` — tmp-write + `fs.renameSync`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/council/verdict.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildVerdict, writeVerdictAtomic } = require('../../src/council/verdict');
const { tally } = require('../../src/council/tally');
const avInput = require('./fixtures/av-receiver-input');

const record = tally(avInput);

test('buildVerdict lifts meta to top-level and stamps schemaVersion', () => {
  const v = buildVerdict(record, []);
  expect(v.schemaVersion).toBe(1);
  expect(v.runId).toBe('av-receiver-council');
  expect(v.chair).toBe('deepseek');
  expect(v.council).toEqual(['deepseek', 'gpt', 'mistral']);
  expect(v.tierCounts).toEqual(record.tierCounts);
});

test('decisions merge per finding; tierOverride rewrites the tier', () => {
  const decisions = [
    { id: 'A3', decision: 'accepted', applied: true, duplicateOf: null,
      tierOverride: { from: 'Singleton', to: 'Confirmed', reason: 'clearly valid' } },
    { id: 'C15', decision: 'accepted', applied: true, duplicateOf: 'A1', tierOverride: null },
  ];
  const v = buildVerdict(record, decisions);
  const a3 = v.findings.find(f => f.id === 'A3');
  expect(a3.tier).toBe('Confirmed');
  expect(a3.tierOverride).toEqual({ from: 'Singleton', to: 'Confirmed', reason: 'clearly valid' });
  expect(a3.decision).toBe('accepted');
  expect(v.findings.find(f => f.id === 'C15').duplicateOf).toBe('A1');
  // untouched findings default cleanly
  expect(v.findings.find(f => f.id === 'A1').decision).toBeNull();
});

test('writeVerdictAtomic writes valid JSON via rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-'));
  const file = path.join(dir, 'verdict.json');
  writeVerdictAtomic(file, buildVerdict(record, []));
  expect(fs.existsSync(file)).toBe(true);
  expect(JSON.parse(fs.readFileSync(file, 'utf-8')).runId).toBe('av-receiver-council');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/council/verdict.test.js`
Expected: FAIL — `Cannot find module '../../src/council/verdict'`.

- [ ] **Step 3: Implement `verdict.js`**

```javascript
// src/council/verdict.js
'use strict';
const fs = require('fs');

const VERDICT_SCHEMA_VERSION = 1;

/**
 * Merge a tally record with Claude's Stage-4 decisions into the verdict record.
 * @param {object} record  tally() output
 * @param {Array<{id,decision,applied,duplicateOf,tierOverride}>} decisions
 */
function buildVerdict(record, decisions = []) {
  const byId = new Map(decisions.map(d => [d.id, d]));
  return {
    schemaVersion: VERDICT_SCHEMA_VERSION,
    runId: record.meta.runId,
    runType: record.meta.runType,
    date: record.meta.date,
    chair: record.meta.chair,
    council: record.meta.models,
    claudeInCouncil: record.meta.claudeInCouncil,
    findings: record.findings.map(f => {
      const d = byId.get(f.id) || {};
      const tierOverride = d.tierOverride || f.tierOverride || null;
      return {
        id: f.id, raiser: f.raiser, severity: f.severity,
        tier: tierOverride ? tierOverride.to : f.tier,
        basis: f.basis, confidence: f.confidence, tierOverride,
        duplicateOf: d.duplicateOf || null,
        adjudications: f.adjudications,
        decision: d.decision || null,
        applied: d.applied === true,
      };
    }),
    streetCred: record.streetCred.map(s => ({ model: s.model, withSelf: s.withSelf, peersOnly: s.peersOnly })),
    runStats: record.runStats,
    tierCounts: record.tierCounts,
  };
}

/** Atomic write: tmp + rename (matches the repo's wave.json convention). */
function writeVerdictAtomic(filePath, verdict) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(verdict, null, 2));
  fs.renameSync(tmp, filePath);
}

module.exports = { buildVerdict, writeVerdictAtomic, VERDICT_SCHEMA_VERSION };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/council/verdict.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/council/verdict.js tests/council/verdict.test.js
git commit -m "feat(ws3): verdict.json builder + atomic write (#12)"
```

---

### Task 6: Reliability ledger (`ledger.js`)

**Files:**
- Create: `src/council/ledger.js`
- Test: `tests/council/ledger.test.js`

**Interfaces:**
- Consumes: a tally `record` (Task 4); `getConfigDir` from `src/utils/config.js`.
- Produces:
  - `buildLedgerRows(record) → Array<row>` (pure). One row per `meta.models` entry; `confirmRate`/`factErrorRate` over **raw** raised findings; `null` when `judged` is false.
  - `appendRun(record, opts?) → rows` — appends each row as a JSONL line under `opts.dir || getConfigDir()`/`council-ledger.jsonl`.
  - `deriveReliability(opts?) → Array<aggregate>` — per-model aggregates; `peersOnly` nulls excluded from the average; `lowN = runs < 3`; tolerates a malformed/partial trailing line.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/council/ledger.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLedgerRows, appendRun, deriveReliability } = require('../../src/council/ledger');
const { tally } = require('../../src/council/tally');
const avInput = require('./fixtures/av-receiver-input');

const record = tally(avInput);

test('buildLedgerRows computes raw rates and carries role/wasChair/conformance', () => {
  const rows = buildLedgerRows(record);
  const gpt = rows.find(r => r.model === 'gpt');
  expect(gpt.findingsRaised).toBe(12);
  expect(gpt.confirmRate).toBeCloseTo(7 / 12);   // raw, not de-duped
  expect(gpt.factErrorRate).toBe(0);
  expect(gpt.bySeverity).toEqual({ blocker: 1, major: 5, minor: 5, nit: 1 });
  const ds = rows.find(r => r.model === 'deepseek');
  expect(ds.wasChair).toBe(true);
  expect(ds.judged).toBe(true);
});

test('judged:false record yields null rates and street-cred', () => {
  const single = { ...record, judged: false,
    streetCred: record.streetCred.map(s => ({ ...s, withSelf: null, peersOnly: null })) };
  const rows = buildLedgerRows(single);
  expect(rows[0].confirmRate).toBeNull();
  expect(rows[0].streetCredPeersOnly).toBeNull();
  expect(rows[0].judged).toBe(false);
});

test('appendRun + deriveReliability round-trip; trailing partial line tolerated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  appendRun(record, { dir });
  appendRun(record, { dir });
  fs.appendFileSync(path.join(dir, 'council-ledger.jsonl'), '{ broken partial');
  const agg = deriveReliability({ dir });
  const gpt = agg.find(a => a.model === 'gpt');
  expect(gpt.runs).toBe(2);
  expect(gpt.lowN).toBe(true);                 // < 3 runs
  expect(gpt.avgStreetCredPeersOnly).toBeCloseTo(1.0);
});

test('peersOnly:null rows are excluded from the average', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const r2 = { ...record, streetCred: record.streetCred.map(s =>
    s.model === 'gpt' ? { ...s, peersOnly: null } : s) };
  appendRun(record, { dir });   // gpt peersOnly 1.0
  appendRun(r2, { dir });       // gpt peersOnly null → ignored
  const gpt = deriveReliability({ dir }).find(a => a.model === 'gpt');
  expect(gpt.avgStreetCredPeersOnly).toBeCloseTo(1.0);
});

test('aggregates rows written under a newer schemaVersion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  appendRun(record, { dir });
  const future = { ...buildLedgerRows(record)[0], schemaVersion: 2 };
  fs.appendFileSync(path.join(dir, 'council-ledger.jsonl'), JSON.stringify(future) + '\n');
  expect(deriveReliability({ dir }).find(a => a.model === 'gpt').runs).toBe(2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/council/ledger.test.js`
Expected: FAIL — `Cannot find module '../../src/council/ledger'`.

- [ ] **Step 3: Implement `ledger.js`**

```javascript
// src/council/ledger.js
'use strict';
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('../utils/config');

const LEDGER_SCHEMA_VERSION = 1;
const LEDGER_FILE = 'council-ledger.jsonl';

function countSeverity(findings) {
  const c = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const f of findings) { if (c[f.severity] !== undefined) { c[f.severity] += 1; } }
  return c;
}

/** One model-level row per council model. Rates are over RAW raised findings. */
function buildLedgerRows(record) {
  const { meta, findings, streetCred, runStats, judged } = record;
  const sc = new Map(streetCred.map(s => [s.model, s]));
  const rs = new Map(runStats.map(r => [r.model, r]));
  return meta.models.map(model => {
    const raised = findings.filter(f => f.raiser === model);
    const s = sc.get(model) || {};
    const r = rs.get(model) || {};
    const denom = raised.length;
    return {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      runId: meta.runId, date: meta.date, runType: meta.runType, model,
      role: r.role || 'council', wasChair: !!r.wasChair, judged: judged === true,
      streetCredWithSelf: judged ? (s.withSelf ?? null) : null,
      streetCredPeersOnly: judged ? (s.peersOnly ?? null) : null,
      findingsRaised: denom,
      bySeverity: countSeverity(raised),
      confirmRate: judged && denom ? raised.filter(f => f.tier === 'Confirmed').length / denom : null,
      factErrorRate: judged && denom ? raised.filter(f => f.tier === 'Disputed').length / denom : null,
      conformance: r.conformance || 'clean',
    };
  });
}

function appendRun(record, opts = {}) {
  const dir = opts.dir || getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LEDGER_FILE);
  const rows = buildLedgerRows(record);
  for (const row of rows) { fs.appendFileSync(file, JSON.stringify(row) + '\n'); }
  return rows;
}

function readRows(dir) {
  const file = path.join(dir, LEDGER_FILE);
  if (!fs.existsSync(file)) { return []; }
  return fs.readFileSync(file, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function avg(nums) { return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null; }

/** Aggregate the ledger per model. peersOnly nulls excluded; lowN flags < 3 runs. */
function deriveReliability(opts = {}) {
  const dir = opts.dir || getConfigDir();
  const byModel = new Map();
  for (const row of readRows(dir)) {
    if (!byModel.has(row.model)) { byModel.set(row.model, []); }
    byModel.get(row.model).push(row);
  }
  return [...byModel.entries()].map(([model, rows]) => {
    const peers = rows.map(r => r.streetCredPeersOnly).filter(v => typeof v === 'number');
    const confirms = rows.map(r => r.confirmRate).filter(v => typeof v === 'number');
    const facts = rows.map(r => r.factErrorRate).filter(v => typeof v === 'number');
    const conformance = rows.reduce((acc, r) => { acc[r.conformance] = (acc[r.conformance] || 0) + 1; return acc; }, {});
    return {
      model, runs: rows.length, lowN: rows.length < 3,
      avgStreetCredPeersOnly: avg(peers),
      lifetimeConfirmRate: avg(confirms),
      lifetimeFactErrorRate: avg(facts),
      conformance,
    };
  });
}

module.exports = { buildLedgerRows, appendRun, deriveReliability, LEDGER_FILE, LEDGER_SCHEMA_VERSION };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/council/ledger.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/council/ledger.js tests/council/ledger.test.js
git commit -m "feat(ws3): reliability ledger + deriveReliability (#9)"
```

---

### Task 7: CLI surface (`amicus council tally|stats`)

**Files:**
- Create: `src/cli-handlers-council.js`
- Test: `tests/council/cli-handlers-council.test.js`
- Modify: `bin/amicus.js` (add `case 'council'` to the `switch (command)`, ~line 94 area)
- Modify: `src/utils/lifecycle.js:15` (add `'council'` to `ONE_SHOT_COMMANDS`)
- Modify: `src/cli.js` (`getUsage()` — add a council usage block)

**Interfaces:**
- Consumes: `tally` (Task 4), `deriveReliability` (Task 6), `failJson`/`ERROR_CODES` (`src/utils/error-doc.js`).
- Produces: `handleCouncil(args) → Promise<number>` (exit code). `args._` positionals: `_[0]='council'`, `_[1]` subcommand (`tally`|`stats`), `_[2]` input path for `tally`. `args.json` toggles JSON output.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/council/cli-handlers-council.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleCouncil } = require('../../src/cli-handlers-council');
const avInput = require('./fixtures/av-receiver-input');

function capture(fn) {
  const out = []; const orig = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  return Promise.resolve().then(fn)
    .then(code => ({ code, out: out.join('') }))
    .finally(() => { process.stdout.write = orig; });
}

test('tally reads input.json and prints a record on --json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-'));
  const file = path.join(dir, 'input.json');
  fs.writeFileSync(file, JSON.stringify(avInput));
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'tally', file], json: true }));
  expect(code).toBe(0);
  const doc = JSON.parse(out);
  expect(doc.tierCounts).toEqual({ Confirmed: 19, Contested: 2, Singleton: 11, Disputed: 3 });
});

test('tally with a missing file emits a BAD_ARGS envelope on stdout, exit 1', async () => {
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'tally', 'nope.json'], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

test('unknown subcommand → BAD_ARGS', async () => {
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'frobnicate'], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});

test('structurally-invalid input (valid JSON, missing arrays) → BAD_ARGS', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-'));
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, JSON.stringify({ meta: { models: [] } }));
  const { code, out } = await capture(() => handleCouncil({ _: ['council', 'tally', file], json: true }));
  expect(code).toBe(1);
  expect(JSON.parse(out).error.code).toBe('BAD_ARGS');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/council/cli-handlers-council.test.js`
Expected: FAIL — `Cannot find module '../../src/cli-handlers-council'`.

- [ ] **Step 3: Implement `cli-handlers-council.js`**

```javascript
// src/cli-handlers-council.js
'use strict';
const fs = require('fs');
const { tally } = require('./council/tally');
const { deriveReliability } = require('./council/ledger');
const { failJson, ERROR_CODES } = require('./utils/error-doc');

function runTally(inputPath, useJson) {
  if (!inputPath) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: 'council tally needs an <input.json> path',
      hint: 'amicus council tally <input.json> [--json]' });
  }
  let input;
  try { input = JSON.parse(fs.readFileSync(inputPath, 'utf-8')); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `cannot read ${inputPath}: ${e.message}`,
      hint: 'pass a valid tally input JSON file' });
  }
  let record;
  try { record = tally(input); }
  catch (e) {
    return failJson(useJson, { code: ERROR_CODES.BAD_ARGS, message: `malformed tally input: ${e.message}`,
      hint: 'input needs meta.models, findings[], adjudications[], rankings[]' });
  }
  process.stdout.write(useJson ? JSON.stringify(record, null, 2) + '\n' : renderRecord(record));
  return 0;
}

function runStats(useJson) {
  const agg = deriveReliability();
  process.stdout.write(useJson ? JSON.stringify(agg, null, 2) + '\n' : renderStats(agg));
  return 0;
}

function renderRecord(r) {
  const t = r.tierCounts;
  return `Council tally (${r.meta.runId})\n` +
    `  Confirmed ${t.Confirmed}  Contested ${t.Contested}  Singleton ${t.Singleton}  Disputed ${t.Disputed}\n`;
}
function renderStats(agg) {
  if (!agg.length) { return 'No council runs recorded yet.\n'; }
  return 'model            runs  avg-cred  confirm  fact-err  notes\n' +
    agg.map(a => `${a.model.padEnd(16)} ${String(a.runs).padStart(4)}  ` +
      `${fmt(a.avgStreetCredPeersOnly)}     ${fmt(a.lifetimeConfirmRate)}    ${fmt(a.lifetimeFactErrorRate)}` +
      `${a.lowN ? '   low-N' : ''}`).join('\n') + '\n';
}
function fmt(v) { return (v === null || v === undefined) ? '  —  ' : v.toFixed(2); }

/** @param {{_:string[], json?:boolean}} args @returns {Promise<number>} */
async function handleCouncil(args) {
  const sub = args._[1];
  const useJson = !!args.json;
  if (sub === 'tally') { return runTally(args._[2], useJson); }
  if (sub === 'stats') { return runStats(useJson); }
  return failJson(useJson, { code: ERROR_CODES.BAD_ARGS,
    message: `unknown council subcommand '${sub || ''}'`, hint: 'amicus council tally|stats' });
}

module.exports = { handleCouncil };
```

- [ ] **Step 4: Wire the dispatcher, one-shot set, and usage**

In `bin/amicus.js`, inside `switch (command)` (next to `case 'models'`):

```javascript
      case 'council': {
        const { handleCouncil } = require('../src/cli-handlers-council');
        exitCode = await handleCouncil(args);
        break;
      }
```

In `src/utils/lifecycle.js:15`, add `'council'` to the set:

```javascript
const ONE_SHOT_COMMANDS = new Set(['start', 'continue', 'resume', 'list', 'read', 'abort', 'fanout', 'models', 'key', 'council']);
```

In `src/cli.js` `getUsage()`, add to the command list:

```text
  amicus council tally <input.json> [--json]   Tally council findings → tiers/street-cred
  amicus council stats [--json]                Reviewer-reliability from the ledger
```

- [ ] **Step 5: Run the handler tests + full council suite + gates**

Run: `npx jest tests/council/ && npm run check:sizes && npm run check:secrets`
Expected: PASS; all council files ≤ 300 lines; no secrets. (Both npm aliases pass `--all`; a bare `node scripts/check-file-sizes.js` scans only staged files.)

- [ ] **Step 6: Smoke the wired CLI**

Run: `node bin/amicus.js council stats --json`
Expected: a valid JSON array (`[]` if the ledger is empty; non-empty if earlier runs already appended rows — the ledger is global and append-only) and exit 0. Then with the fixture:
Run: `node -e "require('fs').writeFileSync('t.json', JSON.stringify(require('./tests/council/fixtures/av-receiver-input')))" && node bin/amicus.js council tally t.json --json && rm t.json`
Expected: a record JSON whose `tierCounts` is `{Confirmed:19,Contested:2,Singleton:11,Disputed:3}`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/cli-handlers-council.js tests/council/cli-handlers-council.test.js bin/amicus.js src/utils/lifecycle.js src/cli.js
git commit -m "feat(ws3): amicus council tally|stats CLI surface (#1/#9)"
```

---

### Task 8: Skill documentation (COUNCIL-DESIGN / SKILL / MODEL-NOTES)

**Files:**
- Modify: `skills/second-opinion/COUNCIL-DESIGN.md`
- Modify: `skills/second-opinion/SKILL.md`
- Modify: `skills/second-opinion/MODEL-NOTES.md`

No automated tests (prose). The deliverable is that the skill's documented flow matches the new code and the boundary is re-drawn. Work through these edits explicitly.

- [ ] **Step 1: COUNCIL-DESIGN.md — boundary carve-out (§2/§9)**

Replace the §2/§9 "No code/backend for scoring or parsing — Claude does it inline" lines with:

> Deterministic arithmetic/formatting/schema helpers under `amicus council` (findings validation, tier tally, street-cred, ledger) are sanctioned; judgment, synthesis, anonymization, and de-anonymization remain Claude's inline work.

- [ ] **Step 2: COUNCIL-DESIGN.md — §5.2 tier taxonomy**

Rewrite §5.2 to define the four canonical tiers and the peers-only cascade verbatim from the spec (Disputed `d≥2 & d>a`; Confirmed `a≥2 & a>d`; Contested `d≥1`; Singleton else), the `confidence: thin` margin cells `(0,0)/(1,0)/(0,1)`, and the rule that the raiser's self-adjudication is excluded. Note Claude may override `thin` tiers (recorded as `tierOverride`).

- [ ] **Step 3: COUNCIL-DESIGN.md — §7 reliability source-of-truth + §8 run-stats**

Replace the hand-edited §7 table with: "the append-only `council-ledger.jsonl` (via `amicus council stats`) is the authoritative reviewer-reliability data; MODEL-NOTES keeps only qualitative quirks + may embed a generated snapshot." In §8, state run-stats are read from the wave/run docs (real `durationMs`/`usage`); missing → `null`, never invented.

- [ ] **Step 4: SKILL.md — Stage 1 findings contract**

Add to the Stage-1 briefing: each reviewer outputs its prose review **plus** a trailing fenced ` ```json ` block `{overall, findings:[{id,severity,claim,location,rationale}]}` with sequential ids `1..n` and `severity ∈ {blocker,major,minor,nit}`. After the wave, run `validateFindings` per leg; on failure, issue up to **2** solo `start --json` re-prompts ("re-emit only the findings JSON, fixing: <errors>"), keeping the first pass's prose; if still bad, mark the review `unstructured` and hand-parse its prose. Note solo `start` is not subject to the WS-2 cost gate.

- [ ] **Step 5: SKILL.md — Stage 2→tally assembly + Stage 3/5/6**

Document the assembly recipe: rewrite each review's local id to a run-global label id (`A1`,`B1`), build `adjudications` for every judge across all findings (`findingId` = label id; raiser via the label↔model map), and translate each judge's `FINAL RANKING:` review-label order into a model `order` array. Then `amicus council tally <input.json> --json`. Stage 5: write `verdict.json` via the builder. Stage 6: `amicus council` auto-appends the ledger row (shown in the run summary); the MODEL-NOTES prose update stays approval-gated. Stage 0: consult `amicus council stats` for bench recommendations.

- [ ] **Step 6: MODEL-NOTES.md — reliability now generated**

Change the reviewer-reliability section to note the numbers come from `amicus council stats` (the ledger), not hand-edits; keep per-model qualitative quirks and structural-conformance notes (clean/repaired/unstructured).

- [ ] **Step 7: Commit**

```bash
git add skills/second-opinion/COUNCIL-DESIGN.md skills/second-opinion/SKILL.md skills/second-opinion/MODEL-NOTES.md
git commit -m "docs(ws3): council skill on the trust-spine transport"
```

---

### Task 9: Real-LLM council smoke + holistic review + merge

**Files:** none new (verification + integration).

- [ ] **Step 1: Full deterministic suite + gates**

Run: `npx jest tests/council/ && npm test && npm run lint && npm run check:sizes && npm run check:secrets`
Expected: all green; council files ≤ 300 lines.

- [ ] **Step 2: Real-LLM council smoke (key-gated, foreground)**

With a live key configured, run a 2-model council on a short artifact with **one deliberately malformed findings block** seeded into a reviewer briefing, end-to-end through Stages 1–6. Verify: `validateFindings` triggers the repair re-prompt (≤2) and recovers (or marks `unstructured`); `amicus council tally` produces a sane `record`; `verdict.json` is written and parses; the ledger gains rows and `amicus council stats` renders them. Run `fanout`/`start` **foreground** (a backgrounded smoke agent loses the wave — F7 lesson). Capture the run folder for evidence.
Expected: pipeline completes; tierCounts sum to the finding count; exit 0.

- [ ] **Step 3: Opus holistic whole-branch review**

Dispatch a fresh Opus review over the full `ws3/...` diff vs `main`: verify the four locked decisions hold, the golden fixture matches the spec table, no boundary violation (code stays arithmetic-only), schemas round-trip, and no `sidecar` brand regressions. Address any Critical/Important findings; re-run the suite.

- [ ] **Step 4: Merge to local main (local-only)**

```bash
# from the main clone, fast-forward merge the worktree branch
git -C C:/Users/sendt/dev/amicus merge --ff-only ws3/council-trust-spine
npm --prefix C:/Users/sendt/dev/amicus run check:sizes
```
Then remove the worktree (junction-safe): delete the node_modules junction with PowerShell `Remove-Item -Force` (NO `-Recurse`) **before** `git worktree remove --force amicus-ws3`. **Do not push** — local-only until the user OKs the milestone.

- [ ] **Step 5: Update memory + program tracker**

Record WS-3 completion in `project_amicus` memory (commit range, suite baseline, follow-ups) and note WS-4 is next.

---

## Self-Review

**Spec coverage:** #5 → Task 1 + Task 8 Step 4 (repair loop is skill prose). #1 → Tasks 2–4, fixture in Task 4. #9 → Task 6 + Task 7 (`stats`). #12 → Task 5. CLI surface → Task 7. Doc edits (§8) → Task 8. Versioning/degradation/budget-gate notes → encoded in code (`judged`, `peersOnly:null`, schemaVersion) + Task 8 docs. Testing (§10) → per-task tests + Task 9 smoke. Sequencing (§11) → task order. All spec sections map to a task. Two §10 sub-cases are deliberately light: tally-layer "override recording" is asserted as `tierOverride: null` (real overrides are tested at the verdict layer, Task 5), and ledger "config-dir resolution" is exercised by the smoke/integration run (unit tests pass an explicit `{dir}`).

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the only intentionally prose task (Task 8) gives exact replacement wording per edit.

**Type consistency:** `record` shape is produced by `tally` (Task 4) and consumed unchanged by `buildVerdict` (Task 5), `buildLedgerRows` (Task 6), and `handleCouncil` (Task 7) — fields `meta`, `judged`, `streetCred[].{withSelf,peersOnly}`, `findings[].{tier,basis,raiser,severity,adjudications}`, `runStats[].{role,wasChair,conformance,durationMs,usage}`, `tierCounts` are referenced identically. `assignTier`/`computeStreetCred`/`tally` names are stable across Tasks 2–7. Error code is `ERROR_CODES.BAD_ARGS` throughout.
