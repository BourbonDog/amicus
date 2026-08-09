// tests/cli-template-args.test.js
'use strict';

/**
 * v4.7 PR6 sweep: `--template`/`--artifact`/`--var` application was
 * verbatim-triplicated across handleStart, handleFanout, and handleCouncilRun
 * (src/cli-handlers-run.js, src/cli-handlers-fanout.js,
 * src/cli-handlers-council-run.js). This is the single shared application
 * point, `applyTemplateForArgs`.
 *
 * NEVER calls process.exit — handleCouncilRun's contract is return-the-exit-
 * code, so this returns {fail:<code>} and lets each caller decide.
 */

const fs = require('fs');
const path = require('path');
const { readIfPresent } = require('./helpers/read-if-present');

let out; let err;
beforeEach(() => {
  out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  out.mockRestore(); err.mockRestore();
  jest.resetModules();
});
const stdout = () => out.mock.calls.map((c) => c[0]).join('');
const stderr = () => err.mock.calls.map((c) => c[0]).join('');

describe('applyTemplateForArgs', () => {
  it('returns {applied:false} when neither --template nor --artifact/--var is set', () => {
    const { applyTemplateForArgs } = require('../src/cli-template-args');
    expect(applyTemplateForArgs({}, 'hi', false)).toEqual({ applied: false });
  });

  it('fails when --artifact is used without --template', () => {
    const { applyTemplateForArgs } = require('../src/cli-template-args');
    const r = applyTemplateForArgs({ artifact: 'a.md' }, 'hi', true);
    expect(r.fail).toBe(1);
    expect(JSON.parse(stdout()).error.message)
      .toBe('Error: --artifact/--var require --template (expansion happens only in template files)');
  });

  it('fails when --var is used without --template', () => {
    const { applyTemplateForArgs } = require('../src/cli-template-args');
    expect(applyTemplateForArgs({ var: ['k=v'] }, 'hi', true).fail).toBe(1);
  });

  it('applies the template, threading prompt/promptMeta/templateMeta and pumping notices to stderr', () => {
    jest.doMock('../src/template/apply', () => ({
      applyTemplate: jest.fn(() => ({
        prompt: 'rendered prompt',
        promptMeta: { template: { name: 'tpl-a' }, other: 'meta' },
        notices: ['Notice: one', 'Notice: two'],
      })),
    }));
    const { applyTemplateForArgs } = require('../src/cli-template-args');
    const { applyTemplate } = require('../src/template/apply');

    const r = applyTemplateForArgs({ template: 'tpl-a', cwd: '/proj' }, 'raw prompt', false);

    expect(applyTemplate).toHaveBeenCalledWith({
      templateRef: 'tpl-a', prompt: 'raw prompt',
      artifactFile: undefined, varList: undefined, project: '/proj',
    });
    expect(r).toEqual({
      applied: true,
      prompt: 'rendered prompt',
      promptMeta: { template: { name: 'tpl-a' }, other: 'meta' },
      templateMeta: { name: 'tpl-a' },
    });
    expect(stderr()).toBe('Notice: one\nNotice: two\n');
  });

  it('the needs-template message exists in exactly one source file', () => {
    // Walks `src/` with fs rather than `git grep -- src/`: on a brand-new file
    // that hasn't been `git add`ed yet, plain `git grep` searches the index/
    // tracked working tree and misses untracked paths entirely, which would
    // make this assertion fail on the very commit that introduces the file.
    // An fs walk needs no index state and proves the same thing.
    const NEEDLE = 'expansion happens only in template files';
    const ROOT = path.join(__dirname, '..', 'src');
    const hits = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); }
        else if (entry.isFile() && entry.name.endsWith('.js')) {
          // readIfPresent, not readFileSync: a parallel worker's temp file can be
          // named by the readdir above and unlinked before this read — see
          // helpers/read-if-present.
          if (readIfPresent(full)?.includes(NEEDLE)) {
            hits.push(path.relative(path.join(__dirname, '..'), full).split(path.sep).join('/'));
          }
        }
      }
    };
    walk(ROOT);
    expect(hits).toEqual(['src/cli-template-args.js']);
  });
});
