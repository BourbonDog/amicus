const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'design', 'tokens.css'),
  'utf8'
);

describe('src/design/tokens.css', () => {
  it('has a single :root block', () => {
    const roots = CSS.match(/:root\s*\{/g) || [];
    expect(roots.length).toBe(1);
  });

  it('uses the clay/gold accents, never Spectrum violet/lime', () => {
    expect(CSS).toMatch(/--accent:\s*#d97757/);
    expect(CSS).toMatch(/--accent-2:\s*#e8b24a/);
    expect(CSS.toLowerCase()).not.toContain('#8b5cf6'); // violet-500
    expect(CSS.toLowerCase()).not.toContain('#a3e635'); // lime-400
    expect(CSS.toLowerCase()).not.toContain('#7c3aed'); // violet-600
  });

  it('uses the neutral-black ramp (site canonical), never plum/void', () => {
    expect(CSS).toMatch(/--bg:\s*#0a0a0a/);
    expect(CSS).toMatch(/--surface-1:\s*#111113/);
    expect(CSS).toMatch(/--border:\s*#222225/);
    expect(CSS).toMatch(/--text-1:\s*#f5f5f3/);
    expect(CSS.toLowerCase()).not.toContain('#0c0a14'); // plum-bg
    expect(CSS.toLowerCase()).not.toContain('#08070d'); // void-bg
  });

  it('keeps provider anthropic clay fixed', () => {
    expect(CSS).toMatch(/--pv-anthropic:\s*#D97757/i);
  });

  it('declares @font-face for Outfit and IBM Plex Mono with relative ttf urls', () => {
    expect(CSS).toMatch(/@font-face/);
    expect(CSS).toMatch(/font-family:\s*'Outfit'/);
    expect(CSS).toMatch(/font-family:\s*'IBM Plex Mono'/);
    expect(CSS).toMatch(/url\('\.\/fonts\/Outfit-400\.ttf'\)\s*format\('truetype'\)/);
    expect(CSS).toMatch(/url\('\.\/fonts\/IBMPlexMono-400\.ttf'\)\s*format\('truetype'\)/);
  });

  it('retains the council light-ground tier palette + ink', () => {
    expect(CSS).toMatch(/--tier-confirmed:\s*#d7ead0/);
    expect(CSS).toMatch(/--tier-confirmed-ink:\s*#15803d/);
    expect(CSS).toMatch(/--tier-disputed-ink:\s*#a21caf/);
  });
});
