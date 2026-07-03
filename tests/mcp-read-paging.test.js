// tests/mcp-read-paging.test.js
'use strict';

/**
 * 15a.3 (B17) — amicus_read gains a default ~50KB cap plus tail/offset/limit
 * paging params so an unbounded conversation.jsonl (or huge summary/wave)
 * can't flood the calling agent's context.
 *
 * Contract under test:
 * - Under-cap content is returned byte-identical to today (regression pin).
 * - Over-cap content with NO slicing params defaults to the TAIL of the
 *   content, prefixed with a truncation notice as the first line of the body
 *   (inside the fence for prose modes, unfenced for metadata).
 * - offset/limit page through the raw content BEFORE fencing.
 * - tail=true explicitly requests the last `limit` bytes.
 * - metadata mode is exempt from slicing params but still cap-defended.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const READ_CAP_BYTES = 51200; // keep in sync with src/utils/read-slice.js

function getText(result) {
  return result.content[0].text;
}

describe('amicus_read size cap + paging (15a.3 / B17)', () => {
  let tmpDir;
  let handlers;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-read-paging-'));
    handlers = require('../src/mcp-server').handlers;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSession(taskId, meta) {
    const sessDir = path.join(tmpDir, '.claude', 'amicus_sessions', taskId);
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({ taskId, ...meta }, null, 2));
    return sessDir;
  }

  describe('conversation mode (primary unbounded flow)', () => {
    test('under-cap content is returned byte-identical to today (regression pin)', async () => {
      const sessDir = writeSession('conv-small', { status: 'complete' });
      const body = '{"role":"user","content":"hi"}\n{"role":"assistant","content":"hello"}\n';
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), body);

      const result = await handlers.amicus_read({ taskId: 'conv-small', mode: 'conversation' }, tmpDir);
      const text = getText(result);
      expect(text).toContain('<untrusted_sidecar_output');
      expect(text).toContain(body);
      expect(text).not.toContain('[truncated:');
    });

    test('over-cap content with no slicing params defaults to the tail + notice, fence intact', async () => {
      const sessDir = writeSession('conv-big', { status: 'complete' });
      // Build distinguishable head/tail markers around a big filler.
      const filler = 'x'.repeat(READ_CAP_BYTES + 5000);
      const body = 'HEAD_MARKER\n' + filler + '\nTAIL_MARKER';
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), body);

      const result = await handlers.amicus_read({ taskId: 'conv-big', mode: 'conversation' }, tmpDir);
      const text = getText(result);

      // Fence markers must remain intact around the sliced body.
      expect(text).toContain('<untrusted_sidecar_output');
      expect(text).toContain('</untrusted_sidecar_output>');
      // Truncation notice is the first line of the body, inside the fence.
      const noticeMatch = text.match(/\[truncated: showing last \d+ of \d+ bytes[^\]]*\]/);
      expect(noticeMatch).not.toBeNull();
      // Total size in the notice matches the real byte length.
      const totalBytes = Buffer.byteLength(body, 'utf-8');
      expect(text).toContain(`of ${totalBytes} bytes`);
      // Tail content present, head content absent from the sliced body.
      expect(text).toContain('TAIL_MARKER');
      expect(text).not.toContain('HEAD_MARKER');
    });

    test('offset/limit paging returns the requested slice', async () => {
      const sessDir = writeSession('conv-page', { status: 'complete' });
      // 0-9 repeated digits make offsets trivially verifiable.
      const body = Array.from({ length: 2000 }, (_, i) => String(i % 10)).join('');
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), body);

      const result = await handlers.amicus_read(
        { taskId: 'conv-page', mode: 'conversation', offset: 10, limit: 20 }, tmpDir
      );
      const text = getText(result);
      const expectedSlice = body.slice(10, 30);
      expect(text).toContain(expectedSlice);
      expect(text).not.toContain('[truncated:');
    });

    test('tail=true returns the end of the content using limit as the window', async () => {
      const sessDir = writeSession('conv-tail', { status: 'complete' });
      const body = Array.from({ length: 2000 }, (_, i) => String(i % 10)).join('');
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), body);

      const result = await handlers.amicus_read(
        { taskId: 'conv-tail', mode: 'conversation', tail: true, limit: 15 }, tmpDir
      );
      const text = getText(result);
      const expectedSlice = body.slice(body.length - 15);
      expect(text).toContain(expectedSlice);
    });
  });

  describe('summary mode', () => {
    test('under-cap summary unaffected (regression pin)', async () => {
      const sessDir = writeSession('sum-small', { status: 'complete', model: 'gemini' });
      fs.writeFileSync(path.join(sessDir, 'summary.md'), '# Verdict\n\nLooks good.');

      const result = await handlers.amicus_read({ taskId: 'sum-small' }, tmpDir);
      const text = getText(result);
      expect(text).toContain('Looks good.');
      expect(text).not.toContain('[truncated:');
    });

    test('over-cap summary defaults to tail + notice inside the fence', async () => {
      const sessDir = writeSession('sum-big', { status: 'complete', model: 'gemini' });
      const filler = 'y'.repeat(READ_CAP_BYTES + 3000);
      fs.writeFileSync(path.join(sessDir, 'summary.md'), 'HEAD\n' + filler + '\nEND_OF_SUMMARY');

      const result = await handlers.amicus_read({ taskId: 'sum-big' }, tmpDir);
      const text = getText(result);
      expect(text).toContain('<untrusted_sidecar_output');
      expect(text).toMatch(/\[truncated: showing last \d+ of \d+ bytes/);
      expect(text).toContain('END_OF_SUMMARY');
    });

    test('offset/limit paging works on summary mode too', async () => {
      // No `model` in metadata: amicus_read only prepends the "**Model:**"
      // header when metadata.model is set, so the summary body starts at
      // byte 0 and offsets are directly verifiable against `body`.
      const sessDir = writeSession('sum-page', { status: 'complete' });
      const body = Array.from({ length: 500 }, (_, i) => String(i % 10)).join('');
      fs.writeFileSync(path.join(sessDir, 'summary.md'), body);

      const result = await handlers.amicus_read(
        { taskId: 'sum-page', offset: 5, limit: 10 }, tmpDir
      );
      const text = getText(result);
      expect(text).toContain(body.slice(5, 15));
    });
  });

  describe('metadata mode exemption', () => {
    test('metadata mode ignores slicing params (small structured JSON) but stays unfenced', async () => {
      writeSession('meta-small', { status: 'complete', model: 'gemini' });

      const result = await handlers.amicus_read(
        { taskId: 'meta-small', mode: 'metadata', offset: 5, limit: 10, tail: true }, tmpDir
      );
      const text = getText(result);
      expect(text).not.toContain('<untrusted_sidecar_output');
      const parsed = JSON.parse(text);
      expect(parsed).toMatchObject({ taskId: 'meta-small' });
    });

    test('metadata mode still applies the cap defensively (unfenced notice) if huge', async () => {
      const sessDir = writeSession('meta-big', { status: 'complete' });
      // Pad metadata.json itself past the cap with a big filler field.
      const meta = {
        taskId: 'meta-big', status: 'complete',
        filler: 'z'.repeat(READ_CAP_BYTES + 2000),
        tailMarkerField: 'END_OF_META',
      };
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify(meta));

      const result = await handlers.amicus_read({ taskId: 'meta-big', mode: 'metadata' }, tmpDir);
      const text = getText(result);
      expect(text).not.toContain('<untrusted_sidecar_output');
      expect(text).toMatch(/\[truncated: showing last \d+ of \d+ bytes/);
    });
  });
});
