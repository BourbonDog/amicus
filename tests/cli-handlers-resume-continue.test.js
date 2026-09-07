'use strict';

/**
 * v4.7.1 Task 7 (R-D): `amicus continue --tag foo` / `amicus resume --tag foo`
 * parse today (getKnownFlags() unions every usage block's flags, including
 * start's/fanout's `--tag`) but are read by nobody in either handler — the
 * exact silently-ignored-flag shape the Amicus product principle bars. Both
 * commands now reject `--tag` explicitly, mirroring handleFanout's
 * --tag/--retry-failed rejection (src/cli-handlers-fanout.js:27-29): same
 * failJson/ERROR_CODES.BAD_ARGS shape, same process.exit before any other
 * work happens.
 */

describe('handleResume rejects --tag (R-D)', () => {
  test('json mode: exits via failJson(true, BAD_ARGS) with a message naming the alternative, before touching resumeAmicus', async () => {
    jest.resetModules();
    const mockResumeAmicus = jest.fn();
    jest.doMock('../src/index', () => ({ resumeAmicus: mockResumeAmicus }));
    const { handleResume } = require('../src/cli-handlers-resume-continue');

    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(handleResume({
      _: ['resume', 'sometask'], json: true, 'no-ui': true, tag: 'foo',
    })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockResumeAmicus).not.toHaveBeenCalled();
    const written = outSpy.mock.calls.map((c) => c[0]).join('');
    const doc = JSON.parse(written.trim());
    expect(doc.error).toMatchObject({ code: 'BAD_ARGS' });
    expect(doc.error.message).toContain('--tag');
    expect(doc.error.message).toContain('inherited from the parent session');

    outSpy.mockRestore();
    exitSpy.mockRestore();
    jest.dontMock('../src/index');
  });

  test('non-json mode: exits 1 with the same message on stderr', async () => {
    jest.resetModules();
    const mockResumeAmicus = jest.fn();
    jest.doMock('../src/index', () => ({ resumeAmicus: mockResumeAmicus }));
    const { handleResume } = require('../src/cli-handlers-resume-continue');

    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(handleResume({
      _: ['resume', 'sometask'], 'no-ui': true, tag: 'foo',
    })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockResumeAmicus).not.toHaveBeenCalled();
    const written = errSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('--tag');
    expect(written).toContain('inherited from the parent session');

    errSpy.mockRestore();
    exitSpy.mockRestore();
    jest.dontMock('../src/index');
  });
});

describe('handleContinue rejects --tag (R-D)', () => {
  test('json mode: exits via failJson(true, BAD_ARGS) with a message naming the alternative, before touching continueAmicus', async () => {
    jest.resetModules();
    const mockContinueAmicus = jest.fn();
    jest.doMock('../src/index', () => ({ continueAmicus: mockContinueAmicus }));
    const { handleContinue } = require('../src/cli-handlers-resume-continue');

    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(handleContinue({
      _: ['continue', 'sometask'], json: true, 'no-ui': true, prompt: 'hi', tag: 'foo',
    })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockContinueAmicus).not.toHaveBeenCalled();
    const written = outSpy.mock.calls.map((c) => c[0]).join('');
    const doc = JSON.parse(written.trim());
    expect(doc.error).toMatchObject({ code: 'BAD_ARGS' });
    expect(doc.error.message).toContain('--tag');
    expect(doc.error.message).toContain('inherited from the parent session');

    outSpy.mockRestore();
    exitSpy.mockRestore();
    jest.dontMock('../src/index');
  });

  test('non-json mode: exits 1 with the same message on stderr, and never requires --prompt first', async () => {
    jest.resetModules();
    const mockContinueAmicus = jest.fn();
    jest.doMock('../src/index', () => ({ continueAmicus: mockContinueAmicus }));
    const { handleContinue } = require('../src/cli-handlers-resume-continue');

    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    // Deliberately omits --prompt/--briefing: the --tag rejection must fire
    // before the MISSING_PROMPT check, proving it is checked first/unconditionally.
    await expect(handleContinue({
      _: ['continue', 'sometask'], 'no-ui': true, tag: 'foo',
    })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockContinueAmicus).not.toHaveBeenCalled();
    const written = errSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('--tag');
    expect(written).toContain('inherited from the parent session');
    expect(written).not.toContain('--prompt is required');

    errSpy.mockRestore();
    exitSpy.mockRestore();
    jest.dontMock('../src/index');
  });
});

/**
 * #218 PR 4, council #235 r1 (D6): `--thinking` is the same silently-ignored-flag
 * shape as `--tag` above. It parses on every command because getKnownFlags()
 * (src/utils/known-flags.js) scrapes the whole composed usage string and start's
 * block declares it (src/cli.js); neither handler ever reads it; and
 * validateStartArgs — PR 4's vocabulary check — runs only on `start`
 * (src/cli-handlers-run.js), so even `--thinking bogus` used to exit 0 here having
 * done nothing. Both commands now reject it, naming where the level belongs.
 */

describe('handleResume rejects --thinking (#218 PR 4, council #235 r1 D6)', () => {
  // Named mutant "RESUMETHINKINGSILENT": drop the `args.thinking` guard in
  // handleResume (src/cli-handlers-resume-continue.js).
  test('json mode: exits via failJson(true, BAD_ARGS) naming where the level belongs, before touching resumeAmicus, and without any vocabulary check of its own', async () => {
    jest.resetModules();
    const mockResumeAmicus = jest.fn();
    jest.doMock('../src/index', () => ({ resumeAmicus: mockResumeAmicus }));
    const { handleResume } = require('../src/cli-handlers-resume-continue');

    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    // `bogus` is deliberately NOT a level: no vocabulary check runs on this path,
    // so the rejection must come from the guard itself, not from validateStartArgs.
    await expect(handleResume({
      _: ['resume', 'sometask'], json: true, 'no-ui': true, thinking: 'bogus',
    })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockResumeAmicus).not.toHaveBeenCalled();
    const written = outSpy.mock.calls.map((c) => c[0]).join('');
    const doc = JSON.parse(written.trim());
    expect(doc.error).toMatchObject({ code: 'BAD_ARGS' });
    expect(doc.error.message).toContain('--thinking');
    expect(doc.error.message).toContain('the run that started the session');

    outSpy.mockRestore();
    exitSpy.mockRestore();
    jest.dontMock('../src/index');
  });

  test('non-json mode: exits 1 with the same message on stderr', async () => {
    jest.resetModules();
    const mockResumeAmicus = jest.fn();
    jest.doMock('../src/index', () => ({ resumeAmicus: mockResumeAmicus }));
    const { handleResume } = require('../src/cli-handlers-resume-continue');

    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    await expect(handleResume({
      _: ['resume', 'sometask'], 'no-ui': true, thinking: 'bogus',
    })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockResumeAmicus).not.toHaveBeenCalled();
    const written = errSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('--thinking');
    expect(written).toContain('the run that started the session');

    errSpy.mockRestore();
    exitSpy.mockRestore();
    jest.dontMock('../src/index');
  });
});

describe('handleContinue rejects --thinking (#218 PR 4, council #235 r1 D6)', () => {
  // Named mutant "CONTINUETHINKINGSILENT": drop the `args.thinking` guard in
  // handleContinue (src/cli-handlers-resume-continue.js).
  test('json mode: exits via failJson(true, BAD_ARGS) naming where the level belongs, before touching continueAmicus, and without any vocabulary check of its own', async () => {
    jest.resetModules();
    const mockContinueAmicus = jest.fn();
    jest.doMock('../src/index', () => ({ continueAmicus: mockContinueAmicus }));
    const { handleContinue } = require('../src/cli-handlers-resume-continue');

    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    // Same point as handleResume: `bogus` is not a level, and nothing here checks.
    await expect(handleContinue({
      _: ['continue', 'sometask'], json: true, 'no-ui': true, prompt: 'hi', thinking: 'bogus',
    })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockContinueAmicus).not.toHaveBeenCalled();
    const written = outSpy.mock.calls.map((c) => c[0]).join('');
    const doc = JSON.parse(written.trim());
    expect(doc.error).toMatchObject({ code: 'BAD_ARGS' });
    expect(doc.error.message).toContain('--thinking');
    expect(doc.error.message).toContain('the run that starts a session');

    outSpy.mockRestore();
    exitSpy.mockRestore();
    jest.dontMock('../src/index');
  });

  test('non-json mode: exits 1 with the same message on stderr, and never requires --prompt first', async () => {
    jest.resetModules();
    const mockContinueAmicus = jest.fn();
    jest.doMock('../src/index', () => ({ continueAmicus: mockContinueAmicus }));
    const { handleContinue } = require('../src/cli-handlers-resume-continue');

    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((c) => { throw new Error(`exit:${c}`); });

    // Omits --prompt, as the --tag twin above does: the --thinking rejection must
    // fire before the MISSING_PROMPT check, proving it is checked unconditionally.
    await expect(handleContinue({
      _: ['continue', 'sometask'], 'no-ui': true, thinking: 'bogus',
    })).rejects.toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockContinueAmicus).not.toHaveBeenCalled();
    const written = errSpy.mock.calls.map((c) => c[0]).join('');
    expect(written).toContain('--thinking');
    expect(written).toContain('the run that starts a session');
    expect(written).not.toContain('--prompt is required');

    errSpy.mockRestore();
    exitSpy.mockRestore();
    jest.dontMock('../src/index');
  });
});
