'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

describe('README Requirements & Dependencies section (#44)', () => {
  const readme = read('README.md');

  // Isolate the consolidated section so we assert coverage lives *inside* it,
  // not scattered elsewhere in the README.
  function section() {
    const m = readme.match(/##\s+Requirements & Dependencies\b[\s\S]*?(?=\n## )/);
    return m ? m[0] : '';
  }

  it('has a single consolidated "Requirements & Dependencies" heading', () => {
    const heads = readme.match(/^##\s+Requirements & Dependencies\b/gm) || [];
    expect(heads.length).toBe(1);
  });

  it('does not keep the old "Prerequisites & what it costs you" heading as a duplicate', () => {
    expect(readme).not.toMatch(/^##\s+Prerequisites & what it costs you/m);
  });

  it('is linked from the Table of Contents', () => {
    expect(readme).toMatch(/\[Requirements & Dependencies\]\(#requirements--dependencies\)/);
  });

  describe('section content', () => {
    it('states the Node minimum version', () => {
      expect(section()).toMatch(/Node(\.js)?\s*(>=|≥)\s*18/);
    });

    it('covers the registry vs github: install with the git-toolchain note (#35)', () => {
      const s = section();
      expect(s).toMatch(/github:/);
      expect(s).toMatch(/git/i);
      // "runs identically" is the shipped #35 phrasing to preserve
      expect(s).toMatch(/identical/i);
    });

    it('warns that OpenRouter keys need purchased credits (zero-credit 402, #38)', () => {
      const s = section();
      expect(s).toMatch(/OpenRouter/);
      expect(s).toMatch(/credit/i);
      expect(s).toMatch(/402/);
    });

    it('lists the supported API-key env vars / providers', () => {
      const s = section();
      expect(s).toMatch(/OPENROUTER_API_KEY/);
      expect(s).toMatch(/GOOGLE_GENERATIVE_AI_API_KEY/);
      expect(s).toMatch(/OPENAI_API_KEY/);
      expect(s).toMatch(/ANTHROPIC_API_KEY/);
      expect(s).toMatch(/DEEPSEEK_API_KEY/);
    });

    it('marks Electron as OPTIONAL — headless + council work without it (#28/#30)', () => {
      const s = section();
      expect(s).toMatch(/Electron/);
      expect(s).toMatch(/optional/i);
      expect(s).toMatch(/headless/i);
    });

    it('mentions the bundled opencode-ai engine and the transient-install-retry note (#34)', () => {
      const s = section();
      expect(s).toMatch(/opencode/i);
      expect(s).toMatch(/transient/i);
      expect(s).toMatch(/re-?run|retry/i);
    });

    it('includes an OS-support note', () => {
      const s = section();
      expect(s).toMatch(/Windows/);
      expect(s).toMatch(/macOS|Linux/);
    });
  });
});
