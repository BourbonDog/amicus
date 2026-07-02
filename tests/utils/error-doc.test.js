'use strict';
const { buildErrorDoc, ERROR_CODES, failJson } = require('../../src/utils/error-doc');
const { SCHEMA_VERSION } = require('../../src/utils/result-schema');

describe('error-doc', () => {
  it('builds an envelope with the shared schemaVersion and ok:false', () => {
    const doc = buildErrorDoc({ code: ERROR_CODES.MISSING_KEY, message: 'no key' });
    expect(doc).toEqual({
      schemaVersion: SCHEMA_VERSION,
      type: 'error',
      ok: false,
      error: { code: 'MISSING_KEY', message: 'no key', hint: null, command: null },
    });
  });

  it('passes hint and command through', () => {
    const doc = buildErrorDoc({ code: ERROR_CODES.BUDGET_EXCEEDED, message: 'too costly', hint: 'breakdown…', command: 'amicus fanout …' });
    expect(doc.error.hint).toBe('breakdown…');
    expect(doc.error.command).toBe('amicus fanout …');
  });

  it('freezes the code set', () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    expect(new Set(Object.values(ERROR_CODES))).toEqual(new Set([
      'BAD_ARGS', 'MISSING_PROMPT', 'BAD_MODEL', 'MISSING_KEY', 'BAD_SESSION', 'BUDGET_EXCEEDED', 'INTERNAL',
    ]));
  });
});

describe('failJson', () => {
  let outSpy, errSpy;
  beforeEach(() => {
    outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => { outSpy.mockRestore(); errSpy.mockRestore(); });

  it('writes a parseable envelope to stdout and nothing to stderr when useJson', () => {
    const code = failJson(true, { code: ERROR_CODES.BAD_ARGS, message: 'bad flag' });
    expect(code).toBe(1);
    expect(errSpy).not.toHaveBeenCalled();
    const written = outSpy.mock.calls[0][0];
    const parsed = JSON.parse(written);
    expect(parsed).toMatchObject({ type: 'error', ok: false, error: { code: 'BAD_ARGS' } });
  });

  it('writes the human message to stderr and nothing to stdout when not useJson', () => {
    failJson(false, { code: ERROR_CODES.BAD_ARGS, message: 'bad flag' });
    expect(outSpy).not.toHaveBeenCalled();
    expect(errSpy.mock.calls[0][0]).toContain('bad flag');
  });

  it('prints the hint on a second stderr arrow line in human mode', () => {
    failJson(false, {
      code: ERROR_CODES.BUDGET_EXCEEDED,
      message: 'Error: budget gate refused the run',
      hint: 'raise --max-cost or trim the model list',
    });
    expect(outSpy).not.toHaveBeenCalled();
    const stderrText = errSpy.mock.calls.map(c => c[0]).join('');
    expect(stderrText).toBe(
      'Error: budget gate refused the run\n  → raise --max-cost or trim the model list\n'
    );
  });

  it('omits the arrow line when there is no hint', () => {
    failJson(false, { code: ERROR_CODES.BAD_ARGS, message: 'bad flag' });
    const stderrText = errSpy.mock.calls.map(c => c[0]).join('');
    expect(stderrText).toBe('bad flag\n');
    expect(stderrText).not.toContain('→');
  });

  it('json mode is unchanged: hint stays in the envelope, stderr untouched', () => {
    failJson(true, { code: ERROR_CODES.BAD_ARGS, message: 'bad', hint: 'try --help' });
    expect(errSpy).not.toHaveBeenCalled();
    expect(JSON.parse(outSpy.mock.calls[0][0]).error.hint).toBe('try --help');
  });
});
