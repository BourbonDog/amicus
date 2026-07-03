// tests/fanout-e2e.integration.test.js
'use strict';

/**
 * Real-LLM fan-out smoke. Runs ONLY when an OpenRouter key is available
 * (same skip-when-no-key pattern as the other real-LLM integration tests).
 * Keys are loaded the same way the CLI loads them (env-loader), so a key in
 * ~/.config/amicus/.env counts even when the ambient env lacks it.
 * Run via: npm run test:integration -- fanout-e2e
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { loadCredentials } = require('../src/utils/env-loader');
loadCredentials();

const hasKey = !!process.env.OPENROUTER_API_KEY;
const d = hasKey ? describe : describe.skip;

d('fanout end-to-end (real LLM)', () => {
  jest.setTimeout(10 * 60 * 1000);

  it('runs a 2-model wave and emits a parseable wave document', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-fanout-e2e-'));
    try {
      let out;
      try {
        out = execFileSync('node', [
          path.join(__dirname, '..', 'bin', 'amicus.js'),
          'fanout',
          // Model IDs rot when providers rename or delist them.
          // Run `npm run models:check` to verify these are still valid.
          '--models', 'openrouter/google/gemini-2.5-flash-lite,openrouter/deepseek/deepseek-chat',
          '--prompt', 'Reply with exactly the word PONG and nothing else.',
          '--no-context', '--agent', 'Plan', '--timeout', '5',
          '--json', '--cwd', project,
        ], { encoding: 'utf-8' });
      } catch (err) {
        // exit 2 = partial wave (some legs completed, some failed) — acceptable
        if (err.status === 2) {
          out = err.stdout;
        } else {
          throw err;
        }
      }

      const doc = JSON.parse(out);
      expect(doc.type).toBe('wave');
      expect(doc.schemaVersion).toBe(1);
      expect(doc.legs).toHaveLength(2);
      expect(['complete', 'partial']).toContain(doc.status);
      expect(fs.existsSync(path.join(project, '.claude', 'amicus_sessions', doc.waveId, 'wave.json'))).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
