// tests/list-search.test.js
'use strict';
/**
 * F8 D15 — `--search` over id/tag/briefing on both list surfaces, errata
 * E-PR3-5. This file covers the shared core (searchSessions) and the CLI
 * surface (listSidecars); MCP-specific council-material tests live in
 * tests/mcp-council-list.test.js and tests/mcp-server.test.js (sanitization
 * ordering).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { enumerateSessions, listSidecars, searchSessions } = require('../src/sidecar/read');

function writeSession(project, taskId, meta) {
  const dir = path.join(project, '.claude', 'amicus_sessions', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
  return dir;
}

describe('searchSessions — core matcher', () => {
  let project;
  beforeEach(() => { project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-search-')); });
  afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

  it('matches by id substring, case-insensitively', () => {
    writeSession(project, 'zzz-needle-zzz', { status: 'complete', briefing: 'irrelevant', createdAt: '2026-01-01T00:00:00.000Z' });
    writeSession(project, 'other-row', { status: 'complete', briefing: 'irrelevant too', createdAt: '2026-01-01T00:00:00.000Z' });
    const rows = enumerateSessions(project, {});
    const matched = searchSessions(rows, 'NEEDLE', { project });
    expect(matched.map(r => r.id)).toEqual(['zzz-needle-zzz']);
  });

  it('matches by tag', () => {
    writeSession(project, 'tagrow1', { status: 'complete', tag: 'sprint-42', briefing: 'irrelevant', createdAt: '2026-01-01T00:00:00.000Z' });
    writeSession(project, 'tagrow2', { status: 'complete', briefing: 'irrelevant', createdAt: '2026-01-01T00:00:00.000Z' });
    const rows = enumerateSessions(project, {});
    const matched = searchSessions(rows, 'sprint-42', { project });
    expect(matched.map(r => r.id)).toEqual(['tagrow1']);
  });

  it('matches a solo row by its full briefing text, case-insensitively', () => {
    writeSession(project, 'solo0001', { status: 'complete', briefing: 'a long prompt with UNIQUEWORD buried inside it', createdAt: '2026-01-01T00:00:00.000Z' });
    writeSession(project, 'solo0002', { status: 'complete', briefing: 'nothing relevant here', createdAt: '2026-01-01T00:00:00.000Z' });
    const rows = enumerateSessions(project, {});
    const matched = searchSessions(rows, 'uniqueword', { project });
    expect(matched.map(r => r.id)).toEqual(['solo0001']);
  });

  it('matches a wave row via the FULL briefing.md text, beyond the 200-char metadata excerpt', () => {
    const full = 'x'.repeat(220) + ' TAILNEEDLE ' + 'y'.repeat(20);
    const waveDir = writeSession(project, 'wavefull1', {
      type: 'wave', status: 'running', legs: [], briefing: full.slice(0, 200), createdAt: '2026-01-01T00:00:00.000Z',
    });
    fs.writeFileSync(path.join(waveDir, 'briefing.md'), full);
    const rows = enumerateSessions(project, {});
    const matched = searchSessions(rows, 'tailneedle', { project });
    expect(matched.map(r => r.id)).toEqual(['wavefull1']);
    // Sanity: the needle really is past the 200-char excerpt stored on the row.
    expect(full.slice(0, 200).toLowerCase()).not.toContain('tailneedle');
  });

  it('falls back to the 200-char excerpt when briefing.md is missing', () => {
    const full = 'HEADNEEDLE right at the start, ' + 'z'.repeat(300);
    // No briefing.md written for this wave — MCP pre-flight-failure case.
    writeSession(project, 'wavexcpt1', {
      type: 'wave', status: 'error', legs: [], briefing: full.slice(0, 200), createdAt: '2026-01-01T00:00:00.000Z',
    });
    const rows = enumerateSessions(project, {});
    const matched = searchSessions(rows, 'headneedle', { project });
    expect(matched.map(r => r.id)).toEqual(['wavexcpt1']);
  });

  it('LEG rows are NOT matched via inherited briefing text, but ARE matched by id', () => {
    const waveDir = writeSession(project, 'legwave01', {
      type: 'wave', status: 'complete', legs: ['legwave01-1'], briefing: 'wave excerpt, no needle here', createdAt: '2026-01-01T00:00:00.000Z',
    });
    fs.writeFileSync(path.join(waveDir, 'briefing.md'), 'wave excerpt, no needle here either');
    writeSession(project, 'legwave01-1', {
      status: 'complete', parentWave: 'legwave01', briefing: 'inherited parent context with PARENTNEEDLE inside', createdAt: '2026-01-01T00:00:00.000Z',
    });
    const rows = enumerateSessions(project, {});

    const byBriefing = searchSessions(rows, 'parentneedle', { project });
    expect(byBriefing).toEqual([]);

    const byId = searchSessions(rows, 'legwave01-1', { project });
    expect(byId.map(r => r.id)).toEqual(['legwave01-1']);
  });

  it('absent material (no briefing.md, no excerpt) degrades to id/tag matching without throwing', () => {
    // Wave row with no stored excerpt and no briefing.md on disk at all.
    writeSession(project, 'nomatwave', { type: 'wave', status: 'error', legs: [], createdAt: '2026-01-01T00:00:00.000Z' });
    const rows = enumerateSessions(project, {});
    expect(() => searchSessions(rows, 'anything', { project })).not.toThrow();
    expect(searchSessions(rows, 'anything', { project })).toEqual([]);
    expect(searchSessions(rows, 'nomatwave', { project }).map(r => r.id)).toEqual(['nomatwave']);
  });
});

// T6 review: --all rows are stamped with their OWN project (enumerateAllProjects),
// which can differ from the caller's cwd. rowMatchesSearch must resolve wave/council
// material against the ROW's project, not the ctx project, or a cross-project wave's
// full briefing.md is silently unreachable and search quietly degrades to the 200-char
// excerpt with no signal that anything went wrong.
describe('searchSessions — cross-project wave material under --all (T6 review)', () => {
  let project, projB, configDir, prevConfigDir;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-search-a-'));
    projB = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-search-b-'));
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-search-idxcfg-'));
    prevConfigDir = process.env.AMICUS_CONFIG_DIR;
    process.env.AMICUS_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (prevConfigDir === undefined) { delete process.env.AMICUS_CONFIG_DIR; }
    else { process.env.AMICUS_CONFIG_DIR = prevConfigDir; }
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(projB, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("finds a cross-project wave needle past the 200-char excerpt, via that row's OWN project", () => {
    const { enumerateAllProjects } = require('../src/sidecar/read');
    const { recordSession } = require('../src/utils/session-index');

    // A DIFFERENT session recorded under projB is what puts projB into the
    // session-index's values — the thing enumerateAllProjects reads to learn
    // which projects to scan. Deliberately NOT recording 'crosswave1' itself:
    // safeSessionDir has its own taskId->project index fallback (T6 review
    // fold 4), and recording this wave's own taskId would let THAT self-heal
    // mask the bug this test exists to catch. enumerateAllProjects discovers
    // crosswave1 by directory listing once projB is a known project — no
    // individual per-taskId index entry is required for that part.
    writeSession(projB, 'anchor01', { status: 'complete', briefing: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
    recordSession('anchor01', projB);

    const full = 'x'.repeat(220) + ' CROSSNEEDLE ' + 'y'.repeat(20);
    const waveDir = writeSession(projB, 'crosswave1', {
      type: 'wave', status: 'running', legs: [], briefing: full.slice(0, 200), createdAt: '2026-01-01T00:00:00.000Z',
    });
    fs.writeFileSync(path.join(waveDir, 'briefing.md'), full);

    // rows are stamped with `project: projB` for the cross-project row; ctx here
    // is deliberately the OTHER project (`project`, projA) — the caller's cwd —
    // to prove material resolution uses the row's own project, not ctx's.
    const rows = enumerateAllProjects({ project });
    const matched = searchSessions(rows, 'crossneedle', { project });
    expect(matched.map(r => r.id)).toEqual(['crosswave1']);
  });
});

describe('listSidecars (CLI) — --search wiring', () => {
  let project, logSpy;
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-search-cli-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { logSpy.mockRestore(); fs.rmSync(project, { recursive: true, force: true }); });

  it('filters the printed rows by --search', async () => {
    writeSession(project, 'findme01', { status: 'complete', briefing: 'has a GOLDFINCH in it', createdAt: '2026-01-01T00:00:00.000Z' });
    writeSession(project, 'skipme01', { status: 'complete', briefing: 'nothing to see', createdAt: '2026-01-01T00:00:00.000Z' });
    await listSidecars({ project, search: 'goldfinch' });
    const out = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(out).toContain('findme01');
    expect(out).not.toContain('skipme01');
  });

  it('a valueless --search (parseArgs sets search: true) errors instead of listing', async () => {
    writeSession(project, 'anyrow001', { status: 'complete', briefing: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
    await expect(listSidecars({ project, search: true })).rejects.toThrow('--search requires a value');
  });
});
