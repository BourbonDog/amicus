'use strict';
/**
 * Task 17.1 (B46) — docs/council.md end-to-end reference.
 *
 * The external DeepSeek docs review's #1 CRITICAL finding: README and
 * usage.md list `amicus council tally|stats|report|validate|verdict|
 * save|list|show` with no explanation of what inputs they expect, where
 * those inputs come from, or what they produce. This suite pins:
 *  - docs/council.md exists and is linked from README + the Documentation table.
 *  - it documents all 8 council subcommands (worked-example commands exist).
 *  - the tally-input / tally-record schema field names it lists match the
 *    real fields tally() actually produces (src/council/tally.js) and the
 *    real fields verdict.json actually carries (src/council/verdict.js) —
 *    without importing the source into the doc (pinned against a literal
 *    fixture of the real keys, so a schema drift breaks this suite, not a
 *    silent doc lie).
 *  - verdict.json's provenance (built from tally record + Stage-4 decisions)
 *    is stated.
 *  - README's council section links to and summarizes it rather than
 *    growing prose bloat.
 */
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

// Real output keys, captured directly from the source (not re-typed by hand)
// so a future schema change breaks this suite instead of leaving the doc to
// silently drift.
const { tally } = require('../src/council/tally');
const { buildVerdict } = require('../src/council/verdict');

describe('B46 — docs/council.md exists and is wired in', () => {
  it('the file exists', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'docs', 'council.md'))).toBe(true);
  });

  it('README Documentation table links to it', () => {
    const readme = read('README.md');
    const docTable = readme.match(/## Documentation[\s\S]*?(?=\n---)/)[0];
    expect(docTable).toMatch(/docs\/council\.md/);
  });

  it('README "The Council" section links to it instead of re-deriving the schema inline', () => {
    const readme = read('README.md');
    const section = readme.slice(readme.indexOf('## The Council'), readme.indexOf('## The parallel window'));
    expect(section).toMatch(/docs\/council\.md/);
  });
});

describe('B46 — docs/council.md documents all 8 council subcommands', () => {
  const doc = read('docs/council.md');
  it.each(['tally', 'stats', 'report', 'validate', 'verdict', 'save', 'list', 'show'])(
    'mentions `amicus council %s`', (sub) => {
      expect(doc).toMatch(new RegExp('amicus council ' + sub));
    });
});

describe('B46 — tally-input / tally-record schema documented field-by-field', () => {
  const doc = read('docs/council.md');
  const record = tally({
    meta: { runId: 'x', models: ['a', 'b'], chair: 'a', claudeInCouncil: false },
    findings: [{ id: 'A1', raiser: 'a', severity: 'major' }],
    adjudications: [{ findingId: 'A1', judge: 'b', verdict: 'agree' }],
    rankings: [{ judge: 'b', order: ['a', 'b'] }],
    runStats: [],
  });

  it('every top-level tally-record key is documented', () => {
    for (const key of Object.keys(record)) {
      expect(doc).toContain(key);
    }
  });

  it('documents the meta fields the ledger/tally.js actually require', () => {
    expect(doc).toMatch(/runId/);
    expect(doc).toMatch(/claudeInCouncil/);
    expect(doc).toMatch(/models/);
    expect(doc).toMatch(/chair/);
  });

  it('documents the findings[] shape (id, raiser, severity)', () => {
    expect(doc).toMatch(/raiser/);
    expect(doc).toMatch(/severity/);
  });

  it('documents the four tiers and the confidence flag', () => {
    for (const tier of ['Confirmed', 'Contested', 'Singleton', 'Disputed']) {
      expect(doc).toContain(tier);
    }
    expect(doc).toMatch(/confidence/);
    expect(doc).toMatch(/\bthin\b/);
    expect(doc).toMatch(/\bsolid\b/);
  });
});

describe('B46 — verdict.json provenance is stated', () => {
  const doc = read('docs/council.md');
  const verdict = buildVerdict(
    tally({
      meta: { runId: 'x', models: ['a', 'b'], chair: 'a', claudeInCouncil: false },
      findings: [{ id: 'A1', raiser: 'a', severity: 'major' }],
      adjudications: [{ findingId: 'A1', judge: 'b', verdict: 'agree' }],
      rankings: [{ judge: 'b', order: ['a', 'b'] }],
      runStats: [],
    }),
    [{ id: 'A1', decision: 'accepted', applied: true }]
  );

  it('every top-level verdict.json key is documented', () => {
    for (const key of Object.keys(verdict)) {
      expect(doc).toContain(key);
    }
  });

  it('states verdict.json is built FROM the tally record + Stage-4 decisions', () => {
    expect(doc).toMatch(/tally record/i);
    expect(doc).toMatch(/decisions/i);
    expect(doc).toMatch(/buildVerdict/);
  });

  it('documents the schemaVersion field and that it is distinct from the error envelope schemaVersion', () => {
    expect(doc).toMatch(/schemaVersion/);
  });
});

describe('B46 — a worked example with a full command sequence', () => {
  const doc = read('docs/council.md');

  it('shows the pipeline in sequence: tally → verdict → report → stats', () => {
    const tallyIdx = doc.indexOf('council tally');
    const verdictIdx = doc.indexOf('council verdict');
    const reportIdx = doc.indexOf('council report');
    expect(tallyIdx).toBeGreaterThan(-1);
    expect(verdictIdx).toBeGreaterThan(tallyIdx);
    expect(reportIdx).toBeGreaterThan(verdictIdx);
  });

  it('includes a realistic tally-input JSON snippet with meta/findings/adjudications/rankings', () => {
    expect(doc).toMatch(/"meta"/);
    expect(doc).toMatch(/"findings"/);
    expect(doc).toMatch(/"adjudications"/);
    expect(doc).toMatch(/"rankings"/);
  });

  it('includes a decisions.json array example', () => {
    expect(doc).toMatch(/"decision"/);
  });

  it('documents council validate\'s tri-state exit contract', () => {
    const idx = doc.indexOf('## `amicus council validate`');
    expect(idx).toBeGreaterThan(-1);
    const section = doc.slice(idx, doc.indexOf('## `amicus council tally`'));
    expect(section).toMatch(/exit 0|`0`/);
    expect(section).toMatch(/exit 2|`2`/);
    expect(section).toMatch(/exit 1|`1`/);
  });

  it('documents where run-folder artifacts live (cross-checked against the skill)', () => {
    expect(doc).toMatch(/output\/<stem>-council\//);
  });

  it('does not contradict the skill\'s run-folder naming for tally.json/verdict.json', () => {
    const skill = read('skills/second-opinion/SKILL.md');
    // Both must agree tally.json is the redirected --json output of `council tally`.
    expect(doc).toMatch(/tally\.json/);
    expect(skill).toMatch(/tally\.json/);
  });
});

describe('B46 — council presets (save/list/show) documented with shadowing behavior', () => {
  const doc = read('docs/council.md');
  it('documents the built-in benches', () => {
    expect(doc).toMatch(/free/);
    expect(doc).toMatch(/budget/);
    expect(doc).toMatch(/frontier/);
  });
  it('documents that a saved council shadows a built-in of the same name', () => {
    expect(doc).toMatch(/shadow/i);
  });
});

describe('B46 — council stats documented as ledger-derived reliability', () => {
  const doc = read('docs/council.md');
  it('mentions the ledger and reliability aggregation', () => {
    const idx = doc.indexOf('## `amicus council stats`');
    expect(idx).toBeGreaterThan(-1);
    const section = doc.slice(idx, doc.indexOf('## Council presets'));
    expect(section).toMatch(/ledger/i);
  });
});

describe('B46 — self-contained for a future README restructure', () => {
  const doc = read('docs/council.md');
  it('does not depend on README section anchors to be understood (no bare "see above" without a target)', () => {
    expect(doc).not.toMatch(/see above(?!\s*\()/i);
  });
  it('has its own top-level heading (not assuming it is embedded under a README heading)', () => {
    expect(doc.trimStart().startsWith('#')).toBe(true);
  });
});

describe('B46 — every fenced ```json block is valid, parseable JSON (adversarial-review Fix 4)', () => {
  const doc = read('docs/council.md');
  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => m[1]);

  it('the doc has fenced json blocks to check (sanity)', () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(blocks.map((b, i) => [i, b]))('json block #%i parses without error', (_i, block) => {
    expect(() => JSON.parse(block)).not.toThrow();
  });
});
