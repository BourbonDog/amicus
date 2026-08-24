// tests/scripts/extract-workflow-env.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const {
  extractEnvBlocks, render, parseEntry, redactValue,
} = require('../../scripts/extract-workflow-env');

// The #194 bench's finding B1: the first version was an indentation scan that
// silently returned LESS on legal Actions YAML — the same silent-omission
// failure the feature exists to prevent. These are behavioural tests over the
// exact constructs it named, not string-presence assertions over the workflow.
const keysOf = (blocks) => blocks.flatMap((b) => b.body.map((l) => l.trim().split(':')[0]));

describe('extract-workflow-env', () => {
  describe('parseEntry', () => {
    test('reads a plain entry', () => {
      expect(parseEntry('      FOO: bar')).toEqual({ key: 'FOO', value: 'bar' });
    });

    test('reads quoted keys', () => {
      expect(parseEntry('      "FOO": bar').key).toBe('FOO');
      expect(parseEntry("      'FOO': bar").key).toBe('FOO');
    });

    test('strips a trailing comment but not a mid-token hash', () => {
      expect(parseEntry('      FOO: bar  # a note').value).toBe('bar');
      expect(parseEntry('      FOO: a#b').value).toBe('a#b');
    });

    test('never cuts inside quotes or a ${{ }} expression', () => {
      expect(parseEntry('      FOO: "a # b"').value).toBe('"a # b"');
      expect(parseEntry("      M: ${{ inputs.m || 'a#b' }}").value)
        .toBe("${{ inputs.m || 'a#b' }}");
    });

    test('returns null for a non-mapping line', () => {
      expect(parseEntry('      - just a sequence item')).toBeNull();
    });
  });

  describe('block extraction', () => {
    test('captures a job-level block and skips step-level env', () => {
      const { blocks } = extractEnvBlocks('w.yml', [
        'jobs:',
        '  build:',
        '    env:',
        '      A: 1',
        '      B: 2',
        '    steps:',
        '      - run: echo hi',
        '        env:',
        '          STEP_ONLY: 3',
      ].join('\n'));
      expect(keysOf(blocks)).toEqual(['A', 'B']);
      expect(blocks[0].at).toContain('job build');
    });

    test('a dedented comment does NOT end the block', () => {
      // The original scan stopped here and dropped B entirely.
      const { blocks } = extractEnvBlocks('w.yml', [
        'jobs:',
        '  build:',
        '    env:',
        '      A: 1',
        '# a comment flush at column 0, which YAML ignores',
        '      B: 2',
      ].join('\n'));
      expect(keysOf(blocks)).toEqual(['A', 'B']);
    });

    test('a blank line does not end the block', () => {
      const { blocks } = extractEnvBlocks('w.yml', [
        'jobs:', '  build:', '    env:', '      A: 1', '', '      B: 2',
      ].join('\n'));
      expect(keysOf(blocks)).toEqual(['A', 'B']);
    });

    test('flow style is read, not silently seen as empty', () => {
      const { blocks, warnings } = extractEnvBlocks('w.yml', [
        'jobs:', '  build:', '    env: { A: 1, B: two }',
      ].join('\n'));
      expect(keysOf(blocks)).toEqual(['A', 'B']);
      expect(warnings).toEqual([]);
    });

    test('a workflow-level block is captured and labelled', () => {
      const { blocks } = extractEnvBlocks('w.yml', ['env:', '  A: 1', 'jobs:'].join('\n'));
      expect(blocks[0].at).toContain('workflow level');
      expect(keysOf(blocks)).toEqual(['A']);
    });

    test('the real council-review.yml yields the three vars two benches called undefined', () => {
      const wf = path.join(__dirname, '..', '..', '.github', 'workflows', 'council-review.yml');
      const { blocks } = extractEnvBlocks(wf, fs.readFileSync(wf, 'utf-8'));
      const keys = keysOf(blocks);
      for (const k of ['GH_REPO', 'MODELS', 'CHAIR']) { expect(keys).toContain(k); }
    });
  });

  describe('nothing is dropped in silence', () => {
    test('a multi-line scalar is REPORTED, not omitted', () => {
      const { blocks, warnings } = extractEnvBlocks('w.yml', [
        'jobs:', '  build:', '    env:', '      A: 1',
        '      BLOB: |', '        line one', '        line two',
      ].join('\n'));
      expect(keysOf(blocks)).toContain('A');
      // BLOB parses as an entry; its continuation lines are what cannot be read,
      // and the reader is told so rather than left to assume completeness.
      expect(warnings.join(' ')).toMatch(/NOT shown/);
    });

    test('an unhandled inline value is reported with its text', () => {
      const { blocks, warnings } = extractEnvBlocks('w.yml', [
        'jobs:', '  build:', '    env: &anchor', '      A: 1',
      ].join('\n'));
      expect(blocks).toEqual([]);
      expect(warnings[0]).toContain('NOT shown');
      expect(warnings[0]).toContain('&anchor');
    });

    test('render surfaces warnings with a loud marker', () => {
      const out = render('w.yml', ['jobs:', '  build:', '    env: &x', '      A: 1'].join('\n'));
      expect(out).toContain('!!');
    });
  });

  describe('redaction (#194 finding A1)', () => {
    test('a pure expression is kept — the file holds a reference, not the secret', () => {
      expect(redactValue('GH_TOKEN', '${{ github.token }}')).toBe('${{ github.token }}');
      expect(redactValue('MY_API_KEY', '${{ secrets.FOO }}')).toBe('${{ secrets.FOO }}');
    });

    test('a literal under a sensitive key is withheld', () => {
      expect(redactValue('MY_TOKEN', 'abc123')).toContain('withheld');
      expect(redactValue('DB_PASSWORD', 'hunter2')).toContain('withheld');
      expect(redactValue('API_KEY', 'sk-live-xyz')).not.toContain('sk-live-xyz');
    });

    test('an ordinary key keeps its literal — the bench needs the real value', () => {
      expect(redactValue('RUN_DIR', 'council-run')).toBe('council-run');
      expect(redactValue('DIFF_CAP', '240000')).toBe('240000');
    });

    test('a sensitive key mixing a literal into an expression is withheld', () => {
      expect(redactValue('AUTH_HEADER', 'Bearer ${{ secrets.X }} extra-literal'))
        .toContain('withheld');
    });
  });
});
