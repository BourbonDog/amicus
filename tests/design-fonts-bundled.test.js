const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'src', 'design', 'fonts');
const REQUIRED = [
  'Outfit-300.ttf', 'Outfit-400.ttf', 'Outfit-500.ttf',
  'Outfit-600.ttf', 'Outfit-700.ttf', 'Outfit-800.ttf',
  'IBMPlexMono-400.ttf', 'IBMPlexMono-500.ttf', 'IBMPlexMono-600.ttf'
];

describe('bundled design fonts', () => {
  it('ships all 9 required .ttf weights', () => {
    for (const f of REQUIRED) {
      const p = path.join(FONT_DIR, f);
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it('each font file is a non-empty TrueType binary (0x00010000 magic)', () => {
    for (const f of REQUIRED) {
      const buf = fs.readFileSync(path.join(FONT_DIR, f));
      expect(buf.length).toBeGreaterThan(10000);
      // TTF sfnt version: 0x00010000
      expect(buf.readUInt32BE(0)).toBe(0x00010000);
    }
  });
});
