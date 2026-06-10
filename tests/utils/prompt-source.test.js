// tests/utils/prompt-source.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolvePromptSource } = require('../../src/utils/prompt-source');

describe('resolvePromptSource', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-prompt-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors when both --prompt and --prompt-file are given', () => {
    const r = resolvePromptSource({ prompt: 'x', 'prompt-file': 'y.md' });
    expect(r.error).toMatch(/mutually exclusive/);
  });

  it('errors when neither is given', () => {
    const r = resolvePromptSource({});
    expect(r.error).toMatch(/--prompt or --prompt-file is required/);
  });

  it('errors when --prompt is a bare flag with no value', () => {
    const r = resolvePromptSource({ prompt: true });
    expect(r.error).toMatch(/requires a value/);
  });

  it('returns inline prompt with metadata', () => {
    const r = resolvePromptSource({ prompt: 'hello world' });
    expect(r.prompt).toBe('hello world');
    expect(r.promptMeta).toEqual({ source: 'inline', file: null, chars: 11 });
  });

  it('reads a prompt file, strips a UTF-8 BOM, resolves the path', () => {
    const f = path.join(tmp, 'briefing.md');
    fs.writeFileSync(f, '﻿briefing text');
    const r = resolvePromptSource({ 'prompt-file': f });
    expect(r.prompt).toBe('briefing text');
    expect(r.promptMeta.source).toBe('file');
    expect(r.promptMeta.file).toBe(path.resolve(f));
    expect(r.promptMeta.chars).toBe(13);
  });

  it('handles files larger than the 32KB Windows arg cap', () => {
    const f = path.join(tmp, 'big.md');
    fs.writeFileSync(f, 'y'.repeat(40000));
    const r = resolvePromptSource({ 'prompt-file': f });
    expect(r.prompt.length).toBe(40000);
  });

  it('errors on a missing file', () => {
    const r = resolvePromptSource({ 'prompt-file': path.join(tmp, 'nope.md') });
    expect(r.error).toMatch(/cannot read --prompt-file/);
  });

  it('errors on an empty/whitespace-only file', () => {
    const f = path.join(tmp, 'empty.md');
    fs.writeFileSync(f, '   \n');
    const r = resolvePromptSource({ 'prompt-file': f });
    expect(r.error).toMatch(/empty/);
  });
});
