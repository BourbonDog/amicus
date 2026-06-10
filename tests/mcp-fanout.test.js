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
});
