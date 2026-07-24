'use strict';
const { buildLocalSectionHTML, CHIP_ORDER } = require('../../electron/setup-ui-local');
const { buildLocalScript } = require('../../electron/setup-ui-local-script');
const { PRESETS } = require('../../src/utils/local-providers');

describe('buildLocalSectionHTML', () => {
  it('renders the section container, URL field (text, not password), and bearer field (password)', () => {
    const html = buildLocalSectionHTML();
    expect(html).toContain('id="local-section"');
    expect(html).toMatch(/id="local-url-input"\s+type="text"/);
    expect(html).toMatch(/id="local-bearer-input"\s+type="password"/);
    expect(html).toContain('id="local-id-input"');
    expect(html).toContain('id="local-test-btn"');
    expect(html).toContain('id="local-save-btn"');
  });

  it('LOCKED parity: LM Studio leads the chip order (widget copy + chip markup)', () => {
    expect(CHIP_ORDER[0].id).toBe('lmstudio');
    const html = buildLocalSectionHTML();
    expect(html.indexOf('LM Studio')).toBeGreaterThan(-1);
    expect(html.indexOf('LM Studio')).toBeLessThan(html.indexOf('Ollama'));
    expect(html.indexOf('Ollama')).toBeLessThan(html.indexOf('vLLM'));
    expect(html.indexOf('Local server')).toBeLessThan(html.indexOf('LM Studio'));
  });

  it('preset chips carry 127.0.0.1 URLs sourced from src/utils/local-providers.js PRESETS (single source, never re-hardcoded)', () => {
    const html = buildLocalSectionHTML();
    expect(html).toContain(`data-preset="lmstudio" data-url="${PRESETS.lmstudio.baseURL}" data-flavor="lmstudio"`);
    expect(html).toContain(`data-preset="ollama" data-url="${PRESETS.ollama.baseURL}" data-flavor="ollama"`);
    expect(html).toContain(`data-preset="vllm" data-url="${PRESETS.vllm.baseURL}" data-flavor="vllm"`);
    // 127.0.0.1 never localhost (IPv6-first ::1 gotcha, spec §4.1/§4.10).
    expect(html).not.toContain('localhost');
  });
});

describe('buildLocalScript', () => {
  it('invokes setup:probe-local and setup:save-local-provider with literal channel names (allowlist-checkable)', () => {
    const js = buildLocalScript();
    expect(js).toContain("invoke('setup:probe-local'");
    expect(js).toContain("invoke('setup:save-local-provider'");
  });

  it('renders the probe result via textContent, never innerHTML, for server-derived strings', () => {
    const js = buildLocalScript();
    expect(js).toMatch(/setStatus\(res\.count/);
    expect(js).not.toMatch(/statusMsg\.innerHTML/);
    expect(js).not.toMatch(/\.innerHTML\s*=.*res\./);
  });

  it('preset chip click fills the URL field and tracks a flavor', () => {
    const js = buildLocalScript();
    expect(js).toMatch(/urlInput\.value = chip\.getAttribute\('data-url'\)/);
    expect(js).toMatch(/selectedFlavor = chip\.getAttribute\('data-flavor'\)/);
  });

  it("a manually-edited URL that matches no chip falls back to flavor 'generic' (entryFromArgs parity)", () => {
    const js = buildLocalScript();
    expect(js).toMatch(/selectedFlavor = matched\.length > 0 \? matched\[0\]\.getAttribute\('data-flavor'\) : 'generic'/);
  });

  it('never puts the bearer value in a request when the field is empty (undefined, not empty string)', () => {
    const js = buildLocalScript();
    expect(js).toMatch(/bearer:\s*\(bearerInput && bearerInput\.value\)\s*\|\|\s*undefined/);
  });

  it('a save warning (plaintext-bearer posture) is surfaced, not silently dropped', () => {
    const js = buildLocalScript();
    expect(js).toMatch(/res\.warning/);
  });
});
