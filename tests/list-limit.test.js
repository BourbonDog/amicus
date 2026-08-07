// tests/list-limit.test.js
'use strict';
/**
 * v4.7 PR3 rider — `--limit <n>` on `amicus list`.
 *
 * WHY. D14 made `--all` real (cross-project via the sessions-index) with no
 * output cap. Measured on the dev machine at merge time: 21,145 rows in 8.3s,
 * 98% of them one residue project. An unbounded dump is not a listing.
 *
 * SHAPE. Opt-in, no default — an unlimited `list` stays byte-identical, which
 * is the house rule for additive flags. When the cap DOES elide rows it says
 * so (the no-silent-caps rule): a truncation notice naming the real total, on
 * stderr in --json mode so the document on stdout stays parseable.
 *
 * `--limit 0` is the explicit "no cap" spelling, so a scripted caller can opt
 * out without omitting the flag.
 *
 * NOTE ON SCOPE: this caps OUTPUT, not enumeration — `--all` still walks every
 * indexed project, so the 8.3s stays until the residue is pruned. Capping the
 * walk would change which rows win the newest-first sort.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listSidecars } = require('../src/sidecar/read');

function writeSession(project, taskId, meta) {
  const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
  return dir;
}

/** Five rows, newest-first by construction: row0 is newest. */
function seedFive(project) {
  for (let i = 0; i < 5; i++) {
    writeSession(project, `limitr${i}`, {
      status: 'complete',
      briefing: `briefing ${i}`,
      createdAt: `2026-01-0${5 - i}T00:00:00.000Z`,
    });
  }
}

describe('listSidecars — --limit output cap', () => {
  let project, logSpy, errSpy;
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-limit-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    fs.rmSync(project, { recursive: true, force: true });
  });

  const stdout = () => logSpy.mock.calls.map(c => c[0]).join('\n');
  const stderr = () => errSpy.mock.calls.map(c => c[0]).join('\n');

  it('prints only the N newest rows', async () => {
    seedFive(project);
    await listSidecars({ project, limit: 2 });
    const out = stdout();
    expect(out).toContain('limitr0');
    expect(out).toContain('limitr1');
    expect(out).not.toContain('limitr2');
    expect(out).not.toContain('limitr4');
  });

  it('announces the elision, naming the real total (no silent cap)', async () => {
    seedFive(project);
    await listSidecars({ project, limit: 2 });
    expect(stdout()).toMatch(/Showing 2 of 5/);
  });

  it('prints NO notice when the limit elides nothing', async () => {
    seedFive(project);
    await listSidecars({ project, limit: 5 });
    expect(stdout()).not.toMatch(/Showing/);
  });

  it('without --limit, every row prints and no notice appears (byte-identical default)', async () => {
    seedFive(project);
    await listSidecars({ project });
    const out = stdout();
    for (let i = 0; i < 5; i++) { expect(out).toContain(`limitr${i}`); }
    expect(out).not.toMatch(/Showing/);
  });

  it('--limit 0 means unlimited, not "show nothing"', async () => {
    seedFive(project);
    await listSidecars({ project, limit: 0 });
    const out = stdout();
    for (let i = 0; i < 5; i++) { expect(out).toContain(`limitr${i}`); }
    expect(out).not.toMatch(/Showing/);
  });

  it('--json emits exactly N rows and keeps stdout a parseable document', async () => {
    seedFive(project);
    await listSidecars({ project, limit: 2, json: true });
    const doc = JSON.parse(stdout());
    expect(doc).toHaveLength(2);
    expect(doc.map(r => r.id)).toEqual(['limitr0', 'limitr1']);
  });

  it('--json routes the truncation notice to stderr, never into the document', async () => {
    seedFive(project);
    await listSidecars({ project, limit: 2, json: true });
    expect(stderr()).toMatch(/Showing 2 of 5/);
    expect(() => JSON.parse(stdout())).not.toThrow();
  });

  it('rejects a valueless --limit (parseArgs sets limit: true)', async () => {
    seedFive(project);
    await expect(listSidecars({ project, limit: true })).rejects.toThrow('--limit requires a value');
  });

  it('rejects a non-numeric --limit instead of silently listing everything', async () => {
    seedFive(project);
    await expect(listSidecars({ project, limit: 'lots' })).rejects.toThrow(/--limit must be a non-negative integer/);
  });

  it('rejects a negative --limit', async () => {
    seedFive(project);
    await expect(listSidecars({ project, limit: -3 })).rejects.toThrow(/--limit must be a non-negative integer/);
  });
});
