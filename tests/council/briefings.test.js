// tests/council/briefings.test.js
'use strict';
const b = require('../../src/council/briefings');

const ARGS = { briefing: 'Review the attached pricing page.', date: '2026-07-19' };

describe('anti-sycophancy clause (SEAT-BRIEFS.md, verbatim)', () => {
  test('exported constant matches SEAT-BRIEFS wording', () => {
    expect(b.ANTI_SYCOPHANCY_CLAUSE).toBe(
      'Do not soften findings to be agreeable. Lead with your most severe finding. ' +
      'No praise cushions before criticism, and never perform enthusiasm you don\'t hold — ' +
      'if the artifact is mediocre, say so and show why. Do not pad: report every real ' +
      'finding and no invented ones. An empty severity category is a valid result.'
    );
  });

  test.each(['buildSeatBriefing', 'buildCriticBriefing'])(
    '%s embeds the clause verbatim', (fn) => {
      expect(b[fn](ARGS)).toContain(b.ANTI_SYCOPHANCY_CLAUSE);
    });

  test('buildLensBriefing embeds the clause verbatim', () => {
    expect(b.buildLensBriefing({ ...ARGS, lens: 'security architect' }))
      .toContain(b.ANTI_SYCOPHANCY_CLAUSE);
  });
});

describe('structured-output contract', () => {
  test('every Stage-1 review briefing carries the findings JSON contract and the date', () => {
    for (const text of [
      b.buildSeatBriefing(ARGS),
      b.buildCriticBriefing(ARGS),
      b.buildLensBriefing({ ...ARGS, lens: 'CFO focused on unit economics' }),
    ]) {
      expect(text).toContain('"findings"');
      expect(text).toContain('blocker | major | minor | nit');
      expect(text).toContain('sequential integer');
      expect(text).toContain("Today's date is 2026-07-19.");
      expect(text).toContain(ARGS.briefing);
    }
  });
});

describe('LC-10: the briefing and the validator finally say the same thing', () => {
  // The contradiction this closes: every Stage-1 review briefing has always shipped the
  // anti-sycophancy clause's "An empty severity category is a valid result" while
  // validateFindings rejected exactly that answer (EMPTY_FINDINGS) — so the only
  // way to satisfy the schema was to produce a finding. The clause is not the fix
  // on its own; the OUTPUT CONTRACT is what a model reads when it writes the block.
  const { validateFindings } = require('../../src/council/findings');

  test.each(['buildSeatBriefing', 'buildCriticBriefing'])(
    '%s tells the model an empty findings array is acceptable', (fn) => {
      const text = b[fn](ARGS);
      expect(text).toContain('emit [] and say so in "overall"');
      expect(text).toMatch(/[Nn]ever invent a finding/);
    });

  test('every Stage-1 review briefing requires a non-empty "overall"', () => {
    for (const text of [
      b.buildSeatBriefing(ARGS),
      b.buildCriticBriefing(ARGS),
      b.buildLensBriefing({ ...ARGS, lens: 'security architect' }),
    ]) {
      expect(text).toContain('"overall" — a non-empty string');
    }
  });

  test('the answer the briefing describes actually VALIDATES', () => {
    // The linkage, not a restatement: the briefing promises `[]` + a real
    // `overall` is acceptable, so the validator must accept it. If either side
    // ever moves alone, this fails.
    expect(b.buildSeatBriefing(ARGS)).toContain('emit [] and say so in "overall"');
    expect(validateFindings('Prose.\n```json\n{"overall":"I read the material and '
      + 'found nothing to report.","findings":[]}\n```').ok).toBe(true);
  });

  test('the repair prompt\'s empty-response branch describes a VALID answer too', () => {
    // briefings.js's "your previous response was empty" branch tells the model to
    // emit an empty findings array and say so in "overall". While EMPTY_FINDINGS
    // stood, a model that complied burned its repair attempt and still landed
    // 'unstructured' — the instruction and the validator disagreed on the ONE
    // case where nothing else can guard the spend.
    const p = b.buildFindingsRepairPrompt({ errors: [{ code: 'NO_FENCED_BLOCK', detail: 'none' }] });
    expect(p).toMatch(/emit an empty "findings" array/);
    expect(validateFindings('```json\n{"overall":"My previous response was empty; I have '
      + 'nothing to report.","findings":[]}\n```').ok).toBe(true);
  });
});

describe('critic brief (four passes)', () => {
  test('names all four passes', () => {
    const text = b.buildCriticBriefing(ARGS);
    expect(text).toContain('Adversarial pass');
    expect(text).toContain('Edge-case hunt');
    expect(text).toContain('Consistency check');
    expect(text).toContain('Executability test');
  });
});

describe('lens brief', () => {
  test('pins the reviewer to the lens and stays in-domain', () => {
    const text = b.buildLensBriefing({ ...ARGS, lens: 'growth-stage VC' });
    expect(text).toContain('strictly through the lens of a growth-stage VC');
    expect(text).toContain('Stay in-domain');
  });
});

describe('findings repair prompt', () => {
  test('quotes the validation errors and demands ONLY the JSON block', () => {
    const text = b.buildFindingsRepairPrompt({
      errors: [{ code: 'BAD_SEVERITY', detail: "bad severity 'high' on id 2" }],
    });
    expect(text.startsWith('Do NOT use any tools')).toBe(true);
    expect(text).toContain("BAD_SEVERITY: bad severity 'high' on id 2");
    expect(text).toContain('ONLY the corrected findings JSON');
  });

  test('does NOT tell the model to write a prose review (no two-part framing)', () => {
    // Regression: buildFindingsRepairPrompt used to append the FULL
    // FINDINGS_CONTRACT, whose own text opens with "Produce exactly two
    // things... 1. A prose review... 2. A trailing json block" — directly
    // contradicting this prompt's own "Re-emit ONLY the corrected JSON"
    // line. It must reference only the json-shape rules now.
    const text = b.buildFindingsRepairPrompt({
      errors: [{ code: 'BAD_SEVERITY', detail: "bad severity 'high' on id 2" }],
    });
    expect(text).not.toContain('Produce exactly two things');
    expect(text).not.toContain('A prose review');
    expect(text).toContain('```json');                 // still carries the shape to re-emit
    expect(text).toContain('sequential integer');
  });

  // ⚠️ LC-6 (v4.4.1 backlog): the repair prompt used to carry the validation
  // ERRORS without the REVIEW they were errors about. Measured across five paid
  // councils: qwen (wsgate02) and glm (wsgate04) refused outright — "I don't
  // have a previous review to correct" / "the previous review's content was
  // excluded by the caller… I will not fabricate findings" — losing the seat
  // while still paying for the tokens; grok (costgate01) complied by inventing
  // a self-referential finding about its own empty output, which entered
  // tally.json, the street-cred table and the chair synthesis as C1. Honest
  // models lose the seat; compliant ones poison the record.
  test('carries the review being repaired, verbatim and unambiguously labelled', () => {
    const original = 'Prose review body.\n\n```json\n{"findings":[]}\n```';
    const text = b.buildFindingsRepairPrompt({
      errors: [{ code: 'EMPTY_FINDINGS', detail: 'findings is missing or empty' }],
      review: original,
    });
    expect(text).toContain(original);
    // Labelled as the model's OWN prior output, so a model that refuses for
    // lack of one has nothing left to refuse over.
    expect(text).toMatch(/YOUR PREVIOUS REVIEW/);
    expect(text).toContain('END OF YOUR PREVIOUS REVIEW');
    // …and still the errors, still only-the-JSON.
    expect(text).toContain('EMPTY_FINDINGS: findings is missing or empty');
    expect(text).toContain('ONLY the corrected findings JSON');
  });

  test('never fabricates a review it was not given', () => {
    // The honest degenerate case: no prior text at all. The prompt must SAY so
    // rather than open a labelled block around nothing, and must not leave the
    // model to guess (which is what produced grok\'s invented finding).
    for (const review of [undefined, '', '   ']) {
      const text = b.buildFindingsRepairPrompt({ errors: [{ code: 'NO_FENCED_BLOCK', detail: 'none' }], review });
      expect(text).not.toContain('YOUR PREVIOUS REVIEW');
      expect(text).toMatch(/previous response was empty/i);
      expect(text).toMatch(/do not invent/i);
    }
  });

  test('the review body is not truncated, however long it is', () => {
    // glm\'s wsgate04 review was 35 KB. A silent cap would recreate LC-6 in a
    // subtler form: the model would repair a review it can only half see.
    const long = `${'x'.repeat(40000)}\n\n\`\`\`json\n{"findings":[]}\n\`\`\``;
    const text = b.buildFindingsRepairPrompt({ errors: [], review: long });
    expect(text).toContain(long);
  });
});

describe('repair prompts carry the artifact being repaired', () => {
  // LC-12: buildFindingsRepairPrompt was fixed in f2f554b; these four builders had
  // the identical omission (buildChairRepairPrompt took no arguments at all). A
  // repair leg is a FRESH session with no memory of the turn it is repairing.
  const stage2 = require('../../src/council/briefings-stage2');
  const dbrief = require('../../src/council/briefings-debate');
  const errors = [{ code: 'BAD_SEVERITY', detail: "bad severity 'huge' on id 1" }];

  test('buildJudgeRepairPrompt embeds the judgement verbatim', () => {
    const judgement = 'RANKING: C, A, B\nF1: agree — the fence is real.';
    const p = stage2.buildJudgeRepairPrompt({ errors, judgement });
    expect(p).toContain(judgement);
    expect(p).toContain('BAD_SEVERITY');
  });

  test('buildJudgeRepairPrompt states the absent case instead of papering over it', () => {
    const p = stage2.buildJudgeRepairPrompt({ errors, judgement: '' });
    expect(p).toMatch(/no prior|was empty/i);
    expect(p).not.toMatch(/--- YOUR PREVIOUS/);
  });

  test('buildChairRepairPrompt embeds the synthesis it must verdict on', () => {
    const synthesis = 'The bench converged on three blockers.';
    const p = stage2.buildChairRepairPrompt({ synthesis });
    expect(p).toContain(synthesis);
    expect(p).toContain('VERDICT: Ship it');
  });

  test('buildChairRepairPrompt still works with no synthesis', () => {
    expect(() => stage2.buildChairRepairPrompt({})).not.toThrow();
    expect(() => stage2.buildChairRepairPrompt()).not.toThrow();
    expect(stage2.buildChairRepairPrompt({})).toContain('VERDICT: Ship it');
    expect(stage2.buildChairRepairPrompt({})).not.toContain('YOUR SYNTHESIS');
  });

  test('buildDefenseRepairPrompt embeds the defense', () => {
    const defense = 'F3: amend — the reviewer is right about the ordering.';
    expect(dbrief.buildDefenseRepairPrompt({ errors, defense })).toContain(defense);
  });

  test('buildRevoteRepairPrompt embeds the re-vote', () => {
    const revote = 'F3: hold dispute.';
    expect(dbrief.buildRevoteRepairPrompt({ errors, revote })).toContain(revote);
  });

  test('the debate builders state the absent case rather than opening an empty block', () => {
    for (const p of [dbrief.buildDefenseRepairPrompt({ errors }),
      dbrief.buildRevoteRepairPrompt({ errors, revote: '   ' })]) {
      expect(p).not.toContain('YOUR PREVIOUS DEFENSE');
      expect(p).not.toContain('YOUR PREVIOUS RE-VOTE');
      expect(p).toMatch(/was empty/i);
      expect(p).toMatch(/do not invent/i);
    }
  });

  test('no repair builder truncates the artifact, however long it is', () => {
    // glm's wsgate04 review was 35 KB. A silent cap recreates the defect in a
    // subtler form: repairing an artifact the model can only half see.
    const long = 'y'.repeat(40000);
    expect(stage2.buildJudgeRepairPrompt({ errors, judgement: long })).toContain(long);
    expect(stage2.buildChairRepairPrompt({ synthesis: long })).toContain(long);
    expect(dbrief.buildDefenseRepairPrompt({ errors, defense: long })).toContain(long);
    expect(dbrief.buildRevoteRepairPrompt({ errors, revote: long })).toContain(long);
  });
});

describe('FINDINGS_CONTRACT composition (fragment split)', () => {
  test('is the two-part framing and the json-shape fragment, joined by a blank line', () => {
    expect(b.FINDINGS_CONTRACT).toBe(`${b.FINDINGS_TWO_PART_FRAMING}\n\n${b.FINDINGS_JSON_SHAPE}`);
  });

  test('the two-part framing fragment is NOT itself the json-shape fragment', () => {
    expect(b.FINDINGS_TWO_PART_FRAMING).toContain('Produce exactly two things');
    expect(b.FINDINGS_JSON_SHAPE).not.toContain('Produce exactly two things');
  });
});
