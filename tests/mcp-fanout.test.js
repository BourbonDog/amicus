// tests/mcp-fanout.test.js
'use strict';

const { getTools } = require('../src/mcp-tools');

describe('amicus_fanout MCP surface (F4)', () => {
  it('defines the amicus_fanout tool with models array and prompt', () => {
    const tool = getTools().find(t => t.name === 'amicus_fanout');
    expect(tool).toBeDefined();
    expect(tool.description).toMatch(/parallel/i);
    expect(tool.inputSchema.models).toBeDefined();
    expect(tool.inputSchema.prompt).toBeDefined();
  });

  it('handler writes briefing.md and spawns the CLI with --prompt-file, never inline prompt', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
    expect(src).toContain('async amicus_fanout(');
    expect(src).toContain("'--prompt-file'");
    expect(src).toContain("'--wave-id'");
    expect(src).toContain('briefing.md');
    // wave-aware status + read
    expect(src).toMatch(/type === 'wave'/);
  });

  it('forwards --cowork-process and --session-id to the spawned fanout legs (#10)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
    // Scope to the amicus_fanout handler body
    const start = src.indexOf('async amicus_fanout(');
    const end = src.indexOf('async amicus_council_tally(', start);
    const handler = src.slice(start, end);
    expect(handler).toContain("'--cowork-process'");
    expect(handler).toContain('input.coworkProcess');
    expect(handler).toContain("'--session-id'");
    expect(handler).toContain('input.parentSession');
  });

  // v4.7 F8 (D13, errata E-PR3-2): argv-only forward — unlike pack, this does
  // NOT pre-seed the wave metadata (no single-resolution rule forces it here);
  // the spawned CLI child's own cli-handlers-fanout.js stores the tag on wave
  // metadata itself (Task 3), so fanout.js's metaTag inherit arm has no MCP
  // producer and is defense-in-depth only.
  it('forwards --tag to the spawned fanout legs when provided, argv-only (not pre-seeded on wave metadata) (F8 D13)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
    const start = src.indexOf('async amicus_fanout(');
    const end = src.indexOf('async amicus_council_tally(', start);
    const handler = src.slice(start, end);
    expect(handler).toContain("'--tag'");
    expect(handler).toContain('input.tag');
    // The push must live in the args-builder section (after `const args = [`),
    // not inside the pre-spawn metadata.json write above it — confirms this is
    // an argv-only forward, never a wave-metadata pre-seed.
    const argsIdx = handler.indexOf('const args = [');
    const tagPushIdx = handler.indexOf("args.push('--tag'");
    expect(argsIdx).toBeGreaterThan(-1);
    expect(tagPushIdx).toBeGreaterThan(argsIdx);
  });
});

describe('wave crash detection in amicus_status', () => {
  it('source: wave branch probes the fanout pid and cascades crashed to running legs', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf-8');
    const waveBranch = src.slice(src.indexOf("metadata.type === 'wave'"), src.indexOf('async amicus_read('));
    expect(waveBranch).toContain('process.kill(metadata.pid, 0)');
    expect(waveBranch).toContain('Fan-out process exited unexpectedly');
    expect(waveBranch).toContain('Parent fan-out process killed');
    expect(src).toContain('never leave a pid-less wave record');
  });

  it('behavioral: wave with dead pid is marked crashed and running legs cascade', async () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const { handlers } = require('../src/mcp-server');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-crash-'));
    try {
      // Create wave session dir
      const waveId = 'wave-crash-test-001';
      const legId  = 'wave-crash-leg-001';
      const sessBase = path.join(tmpDir, '.claude', 'amicus_sessions');

      const waveDir = path.join(sessBase, waveId);
      fs.mkdirSync(waveDir, { recursive: true });
      fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
        taskId: waveId, type: 'wave', status: 'running',
        pid: 999999991, legs: [legId],
        headless: true, createdAt: new Date().toISOString(),
      }, null, 2));

      // Create a running leg
      const legDir = path.join(sessBase, legId);
      fs.mkdirSync(legDir, { recursive: true });
      fs.writeFileSync(path.join(legDir, 'metadata.json'), JSON.stringify({
        taskId: legId, status: 'running',
        createdAt: new Date().toISOString(),
      }, null, 2));

      // Call status — pid 999999991 is guaranteed dead
      const result = await handlers.amicus_status({ taskId: waveId }, tmpDir);
      const response = JSON.parse(result.content[0].text);

      // Wave itself must be crashed
      expect(response.status).toBe('crashed');
      expect(response.reason).toBeDefined();

      // The wave metadata file on disk must be updated
      const waveMeta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8'));
      expect(waveMeta.status).toBe('crashed');
      expect(waveMeta.crashedAt).toBeDefined();

      // The running leg must have been cascaded to crashed
      const legMeta = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8'));
      expect(legMeta.status).toBe('crashed');
      expect(legMeta.reason).toBe('Parent fan-out process killed');

      // The legs array in the response must reflect the cascade
      const crashedLeg = response.legs.find(l => l.taskId === legId);
      expect(crashedLeg).toBeDefined();
      expect(crashedLeg.status).toBe('crashed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('behavioral: EPERM from kill(pid, 0) means alive — wave and running legs are not cascaded to crashed', async () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const { handlers } = require('../src/mcp-server');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-eperm-'));
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
      const e = new Error('kill EPERM'); e.code = 'EPERM'; throw e;
    });
    try {
      const waveId = 'wave-eperm-test-001';
      const legId  = 'wave-eperm-leg-001';
      const sessBase = path.join(tmpDir, '.claude', 'amicus_sessions');

      const waveDir = path.join(sessBase, waveId);
      fs.mkdirSync(waveDir, { recursive: true });
      fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
        taskId: waveId, type: 'wave', status: 'running',
        pid: process.pid, legs: [legId],
        headless: true, createdAt: new Date().toISOString(),
      }, null, 2));

      const legDir = path.join(sessBase, legId);
      fs.mkdirSync(legDir, { recursive: true });
      fs.writeFileSync(path.join(legDir, 'metadata.json'), JSON.stringify({
        taskId: legId, status: 'running',
        createdAt: new Date().toISOString(),
      }, null, 2));

      const result = await handlers.amicus_status({ taskId: waveId }, tmpDir);
      const response = JSON.parse(result.content[0].text);

      // Wave must stay running — EPERM is not a crash signal
      expect(response.status).toBe('running');

      const waveMeta = JSON.parse(fs.readFileSync(path.join(waveDir, 'metadata.json'), 'utf-8'));
      expect(waveMeta.status).toBe('running');
      expect(waveMeta.crashedAt).toBeUndefined();

      // The running leg must NOT have been cascaded to crashed
      const legMeta = JSON.parse(fs.readFileSync(path.join(legDir, 'metadata.json'), 'utf-8'));
      expect(legMeta.status).toBe('running');
    } finally {
      killSpy.mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('amicus_read on crashed wave without wave.json', () => {
  it('amicus_read on a crashed wave without wave.json is honest about it', async () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const { handlers } = require('../src/mcp-server');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-read-crash-'));
    try {
      const waveId = 'wave-read-crash-001';
      const sessBase = path.join(tmpDir, '.claude', 'amicus_sessions');
      const waveDir = path.join(sessBase, waveId);
      fs.mkdirSync(waveDir, { recursive: true });

      // Write wave metadata with 'crashed' status — no wave.json present
      fs.writeFileSync(path.join(waveDir, 'metadata.json'), JSON.stringify({
        taskId: waveId, type: 'wave', status: 'crashed', legs: ['x-1'],
        headless: true, createdAt: new Date().toISOString(),
      }, null, 2));

      const result = await handlers.amicus_read({ taskId: waveId, mode: 'summary' }, tmpDir);

      // Must be a non-error response with an honest message about the crash
      expect(result.isError).toBeUndefined();
      expect(/ended with status 'crashed'/.test(result.content[0].text)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
