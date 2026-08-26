// tests/council/briefings-task.test.js
'use strict';
const b = require('../../src/council/briefings');
const t = require('../../src/council/briefings-task');
const { validateFindings } = require('../../src/council/findings');

const ARGS = { briefing: 'Size the SMB churn risk of a 12% price increase.', date: '2026-08-25' };

/**
 * The `--- MATERIAL / BRIEFING ---` separator is a PRODUCTION contract:
 * src/sidecar/list-search.js:14 (COUNCIL_MATERIAL_SEPARATOR) splits
 * briefing-stage1.md on this exact string. Pinned byte-identical here so the
 * task skeleton can never drift from what list-search reads.
 */
const SEPARATOR = '--- MATERIAL / BRIEFING ---';

describe('task frames share the composed skeleton (separator is a production contract)', () => {
  const composed = () => [
    ['buildTaskSeatBriefing', t.buildTaskSeatBriefing(ARGS)],
    ['buildTaskCriticBriefing', t.buildTaskCriticBriefing(ARGS)],
    ['buildTaskLensBriefing', t.buildTaskLensBriefing({ ...ARGS, lens: 'growth-stage VC' })],
  ];

  test('every composed task brief carries the byte-identical separator, the date, and the briefing', () => {
    for (const [, text] of composed()) {
      expect(text).toContain(SEPARATOR);
      expect(text).toContain("Today's date is 2026-08-25.");
      expect(text).toContain(ARGS.briefing);
    }
  });

  test('every composed task brief embeds the task anti-sycophancy clause verbatim', () => {
    for (const [, text] of composed()) {
      expect(text).toContain(t.TASK_ANTI_SYCOPHANCY_CLAUSE);
    }
  });

  test('the seat role frames execution, not review', () => {
    const text = t.buildTaskSeatBriefing(ARGS);
    expect(text).toContain('You are one analyst on an independent multi-model bench.');
    expect(text).toContain('you are not reviewing the briefing, you are executing it');
    expect(text).not.toContain('You are one reviewer');
  });

  test('the two-part framing asks for a deliverable, then the trailing json block', () => {
    const text = t.buildTaskSeatBriefing(ARGS);
    expect(text).toContain('Produce exactly two things, in this order:');
    expect(text).toContain('1. Your deliverable — the full analysis, answer, or artifact the briefing asks for.');
    expect(text).not.toContain('A prose review');
  });

  test('the critic brief runs four passes over generative work (V13)', () => {
    const text = t.buildTaskCriticBriefing(ARGS);
    expect(text).toContain('Assumption hunt');
    expect(text).toContain('Edge-case hunt');
    expect(text).toContain('Framing check');
    expect(text).toContain('Actionability test');
    expect(text).toContain('An empty pass is a valid result.');
  });

  test('the lens brief pins the analyst to the lens and stays in-domain', () => {
    const text = t.buildTaskLensBriefing({ ...ARGS, lens: 'growth-stage VC' });
    expect(text).toContain('Do the work the briefing asks for strictly through the lens of a growth-stage VC');
    expect(text).toContain('Stay in-domain');
    expect(text).toContain('leave it to the other analysts');
  });
});

describe('CUT 1: same JSON skeleton, same severity enum — glosses fork, structure never', () => {
  test('the task shape opens with the review shape\'s byte-identical JSON skeleton', () => {
    // The fenced example block (```json … ``` plus the blank line after it) is
    // the first 10 lines of BOTH shapes. Same keys, same example — only the
    // field glosses below it are task-worded.
    const skeleton = b.FINDINGS_JSON_SHAPE.split('\n').slice(0, 10).join('\n');
    expect(skeleton).toContain('"overall"');
    expect(skeleton).toContain('"findings"');
    expect(t.TASK_FINDINGS_JSON_SHAPE.startsWith(skeleton)).toBe(true);
  });

  test('the severity enum is verbatim blocker | major | minor | nit', () => {
    expect(t.TASK_FINDINGS_JSON_SHAPE).toContain('blocker | major | minor | nit');
  });

  test('the task glosses speak in claims, not findings', () => {
    expect(t.TASK_FINDINGS_JSON_SHAPE).toContain('the load-bearing claims your deliverable rests on');
    expect(t.TASK_FINDINGS_JSON_SHAPE).toContain('the answer fails if this');
    expect(t.TASK_FINDINGS_JSON_SHAPE)
      .toContain('a source, a computation, or the literal word "assumption"');
  });

  test('the contract is the two-part framing plus the shape, joined by a blank line', () => {
    expect(t.TASK_FINDINGS_CONTRACT.endsWith(t.TASK_FINDINGS_JSON_SHAPE)).toBe(true);
    expect(t.TASK_FINDINGS_CONTRACT).toContain('Produce exactly two things');
  });
});

describe('LC-10 parity: the empty set stays valid in task mode', () => {
  test('the shape blesses an empty claims list with a real overall', () => {
    expect(t.TASK_FINDINGS_JSON_SHAPE).toContain('emit [] and say so');
    expect(t.TASK_FINDINGS_JSON_SHAPE).toMatch(/[Nn]ever invent a claim/);
  });

  test('the clause says an empty claims list under a real answer is valid', () => {
    expect(t.TASK_ANTI_SYCOPHANCY_CLAUSE)
      .toContain('An empty claims list under a real answer is a valid result.');
  });

  test('the repair prompt\'s empty-response branch describes a VALID answer', () => {
    const p = t.buildTaskFindingsRepairPrompt({ errors: [{ code: 'NO_FENCED_BLOCK', detail: 'none' }] });
    expect(p).toMatch(/previous response was empty/i);
    expect(p).toMatch(/emit an empty "findings" array/);
    expect(p).toMatch(/do not invent claims/i);
    expect(p).not.toContain('YOUR PREVIOUS RESPONSE');
    // …and the answer it describes actually validates (findings.js untouched).
    expect(validateFindings('```json\n{"overall":"My previous response was empty; the '
      + 'deliverable rests on no discrete claims.","findings":[]}\n```').ok).toBe(true);
  });
});

describe('task repair prompt mirrors the review repair prompt (LC-6 carries)', () => {
  const errors = [{ code: 'BAD_SEVERITY', detail: "bad severity 'high' on id 2" }];

  test('quotes the validation errors and demands ONLY the JSON block', () => {
    const p = t.buildTaskFindingsRepairPrompt({ errors, review: 'Deliverable text.' });
    expect(p.startsWith('Do NOT use any tools')).toBe(true);
    expect(p).toContain("BAD_SEVERITY: bad severity 'high' on id 2");
    expect(p).toContain('Re-emit ONLY the corrected findings JSON block (the same claims, fixed');
    expect(p).not.toContain('Produce exactly two things');
  });

  test('carries the response being repaired, verbatim and labelled as the model\'s own', () => {
    const original = 'The deliverable.\n\n```json\n{"findings":[]}\n```';
    const p = t.buildTaskFindingsRepairPrompt({ errors, review: original });
    expect(p).toContain(original);
    expect(p).toContain('--- YOUR PREVIOUS RESPONSE (verbatim — this is the text to correct) ---');
    expect(p).toContain('--- END OF YOUR PREVIOUS RESPONSE ---');
  });

  test('the response body is never truncated, however long', () => {
    const long = 'x'.repeat(40000);
    expect(t.buildTaskFindingsRepairPrompt({ errors, review: long })).toContain(long);
  });

  test('ends with the TASK shape (the claims gloss, not the review gloss)', () => {
    const p = t.buildTaskFindingsRepairPrompt({ errors, review: 'text' });
    expect(p.endsWith(t.TASK_FINDINGS_JSON_SHAPE)).toBe(true);
  });
});

describe('CUT 2 round-trip: the answer a task brief asks for validates against the REAL validator', () => {
  test('a synthetic task response in the briefed shape passes validateFindings unchanged', () => {
    // The brief promises this shape; findings.js was not touched. If either
    // side ever moves alone, this fails.
    const brief = t.buildTaskSeatBriefing(ARGS);
    expect(brief).toContain('"claim", "location", "rationale" — non-empty strings');
    const response = [
      'A 12% increase is survivable: churn risk concentrates in the SMB tier and',
      'enterprise renewals are contractually insulated for the fiscal year.',
      '',
      '```json',
      JSON.stringify({
        overall: 'A 12% increase is survivable; the churn risk concentrates in SMB.',
        findings: [
          { id: 1, severity: 'blocker', claim: 'SMB demand is price-elastic above 10%',
            location: 'assumption', rationale: 'no cohort elasticity data was provided' },
          { id: 2, severity: 'minor', claim: 'enterprise contracts renew annually',
            location: 'briefing, contract-terms section', rationale: 'stated in the material' },
        ],
      }, null, 2),
      '```',
    ].join('\n');
    const res = validateFindings(response);
    expect(res.ok).toBe(true);
    expect(res.findings).toHaveLength(2);
  });

  test('the briefed empty-set answer validates too (KEEP)', () => {
    expect(validateFindings('Full inline reasoning, no discrete claims to adjudicate.\n\n'
      + '```json\n{"overall":"The reasoning is fully inline; no discrete claim needs '
      + 'adjudication.","findings":[]}\n```').ok).toBe(true);
  });
});

describe('dispatcher contract (briefings.stage1Xxx)', () => {
  const LENS_ARGS = { ...ARGS, lens: 'security architect' };
  const REPAIR_ARGS = {
    errors: [{ code: 'EMPTY_FINDINGS', detail: 'findings is missing or not an array' }],
    review: 'Prior text.\n\n```json\n{}\n```',
  };

  test('intent undefined → byte-identical to the review builders', () => {
    expect(b.stage1SeatBriefing(undefined, ARGS)).toBe(b.buildSeatBriefing(ARGS));
    expect(b.stage1CriticBriefing(undefined, ARGS)).toBe(b.buildCriticBriefing(ARGS));
    expect(b.stage1LensBriefing(undefined, LENS_ARGS)).toBe(b.buildLensBriefing(LENS_ARGS));
    expect(b.stage1RepairPrompt(undefined, REPAIR_ARGS)).toBe(b.buildFindingsRepairPrompt(REPAIR_ARGS));
  });

  test("intent 'task' → byte-identical to the task builders", () => {
    expect(b.stage1SeatBriefing('task', ARGS)).toBe(t.buildTaskSeatBriefing(ARGS));
    expect(b.stage1CriticBriefing('task', ARGS)).toBe(t.buildTaskCriticBriefing(ARGS));
    expect(b.stage1LensBriefing('task', LENS_ARGS)).toBe(t.buildTaskLensBriefing(LENS_ARGS));
    expect(b.stage1RepairPrompt('task', REPAIR_ARGS)).toBe(t.buildTaskFindingsRepairPrompt(REPAIR_ARGS));
  });

  test('any other intent value falls back to the review frame (fail-closed)', () => {
    // The plumbing contract is `o.intent === 'task' | absent`; anything else
    // must compose the review brief, never throw and never half-fork.
    expect(b.stage1SeatBriefing('review', ARGS)).toBe(b.buildSeatBriefing(ARGS));
  });

  test('briefings.js never top-requires briefings-task (load-acyclic)', () => {
    // The task module top-requires briefings for the shared skeleton; the
    // dispatchers must lazy-require at call time or the cycle deadlocks into
    // a half-initialized module object.
    // ⚠️ v4.9 fix round 2 (council C4): this variant used to `.test(l.trim())`.
    // Anchored at column 0 now — that is what "top-level" actually means —
    // matching briefings-chair-task.test.js and briefings-stage2-task.test.js.
    // MEASURED, because the obvious reading of the trimming variant is the wrong
    // one: it is not BLIND to the defect (both spellings catch a genuine column-0
    // `const … require`), it is OVER-eager — it counts a legitimate lazy require
    // written in `const` form and REDS on correct code. briefings-chair.js
    // lazy-requires in exactly that form, which is why the sibling pin had to be
    // strict from the start.
    //
    // ⚠️ MEASURED while unifying them: briefings.js has NO top-level requires at
    // ALL (its four task requires are every one a call-time
    // `return … require('./briefings-task')`), so `topLevelRequires` is [] and a
    // bare "none of them names briefings-task" is VACUOUS — in BOTH spellings,
    // which is why the loose regex never showed it. The sibling variants can use
    // `topLevelRequires.length > 0` as their non-vacuity control because their
    // targets really do top-require something; here the honest control is the
    // other direction — the file DOES require the task module, and every one of
    // those requires is indented.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'council', 'briefings.js'), 'utf-8');
    const lines = src.split('\n');
    const topLevelRequires = lines.filter(l => /^(const|let|var)\s.*require\(/.test(l));
    expect(topLevelRequires.filter(l => l.includes('briefings-task'))).toHaveLength(0);
    // Non-vacuous: there is something here for the heuristic to have caught.
    expect(lines.filter(l => l.includes("require('./briefings-task')")).length).toBeGreaterThan(0);
  });
});

describe('composeWith: the generalized skeleton the review path delegates to', () => {
  test('compose-built review briefs are reproducible through composeWith with the review fragments', () => {
    expect(b.composeWith(
      'You are one reviewer on an independent multi-model review bench. Review the material ' +
      'below against the briefing\'s own criteria.',
      b.ANTI_SYCOPHANCY_CLAUSE, b.FINDINGS_CONTRACT, ARGS
    )).toBe(b.buildSeatBriefing(ARGS));
  });
});
