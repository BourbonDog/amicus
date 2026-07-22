// tests/cli-council-verdict-render.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleCouncil } = require('../src/cli-handlers-council');

function tallyDoc() {
  return {
    schemaVersion: 2, type: 'council-tally',
    meta: { runId: 'r', runType: 'headless', date: 'd', chair: 'deepseek', models: ['gemini', 'gpt'], claudeInCouncil: false },
    findings: [{ id: 'A1', raiser: 'gemini', severity: 'major', tier: 'Confirmed', basis: { a: 2, d: 0, n: 0 },
      confidence: 'solid', tierOverride: null, adjudications: [] }],
    rankings: [], streetCred: [], runStats: [], tierCounts: { Confirmed: 1, Contested: 0, Singleton: 0, Disputed: 0 }, judged: true,
  };
}

test('council verdict --render writes verdict.json AND report.html next to it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
  const tallyPath = path.join(dir, 'tally.json');
  fs.writeFileSync(tallyPath, JSON.stringify(tallyDoc()));
  const outPath = path.join(dir, 'verdict.json');
  const code = await handleCouncil({ _: ['council', 'verdict', tallyPath], out: outPath, render: true });
  expect(code).toBe(0);
  expect(fs.existsSync(outPath)).toBe(true);
  expect(fs.existsSync(path.join(dir, 'report.html'))).toBe(true);
  expect(fs.readFileSync(path.join(dir, 'report.html'), 'utf-8')).toContain('Council Report');
});

test('council verdict without --render writes only verdict.json (v4.0 behavior)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norender-'));
  const tallyPath = path.join(dir, 'tally.json');
  fs.writeFileSync(tallyPath, JSON.stringify(tallyDoc()));
  const outPath = path.join(dir, 'verdict.json');
  await handleCouncil({ _: ['council', 'verdict', tallyPath], out: outPath });
  expect(fs.existsSync(path.join(dir, 'report.html'))).toBe(false);
});

// 4.1.1 Fix B: report.html held model output but was written with no mode,
// so a fresh --out-dir landed it at the umask default (typically 0o644 on
// POSIX) instead of matching every sibling writer's { mode: 0o600 }
// (src/council/run-assemble.js, src/mcp-server.js, src/council/run-launch.js).
// Assert the call args directly (works on any OS) rather than relying only
// on statSync, since NTFS ignores Unix mode bits and would mask a regression
// on a Windows dev box.
test('council verdict --render writes report.html with { mode: 0o600 }', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-mode-'));
  const tallyPath = path.join(dir, 'tally.json');
  fs.writeFileSync(tallyPath, JSON.stringify(tallyDoc()));
  const outPath = path.join(dir, 'verdict.json');
  const reportPath = path.join(dir, 'report.html');

  const realWriteFileSync = fs.writeFileSync.bind(fs);
  const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation((...args) => realWriteFileSync(...args));
  try {
    const code = await handleCouncil({ _: ['council', 'verdict', tallyPath], out: outPath, render: true });
    expect(code).toBe(0);
    const reportCall = spy.mock.calls.find(([p]) => p === reportPath);
    expect(reportCall).toBeDefined();
    expect(reportCall[2]).toEqual({ mode: 0o600 });
  } finally {
    spy.mockRestore();
  }
});

// POSIX-only real-permissions check: NTFS ignores Unix mode bits, so fs
// reports 0o666 on Windows even though the source passed { mode: 0o600 }
// (harmless no-op there) — see the identical pattern in api-key-store.test.js.
const itPosix = process.platform === 'win32' ? it.skip : it;
itPosix('council verdict --render leaves report.html at 0o600 on disk (POSIX only)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-mode-posix-'));
  const tallyPath = path.join(dir, 'tally.json');
  fs.writeFileSync(tallyPath, JSON.stringify(tallyDoc()));
  const outPath = path.join(dir, 'verdict.json');
  await handleCouncil({ _: ['council', 'verdict', tallyPath], out: outPath, render: true });
  const stats = fs.statSync(path.join(dir, 'report.html'));
  expect(stats.mode & 0o777).toBe(0o600);
});
