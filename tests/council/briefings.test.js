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
  test('every Stage-1 briefing carries the findings JSON contract and the date', () => {
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
