const { validateApiKey } = require('../../src/utils/validators');

describe('validateApiKey missing-key message', () => {
  const KEY = 'GOOGLE_GENERATIVE_AI_API_KEY';
  let savedEnv, savedPlatform;

  beforeEach(() => {
    savedEnv = process.env[KEY];
    delete process.env[KEY];
    savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });
  afterEach(() => {
    if (savedEnv === undefined) { delete process.env[KEY]; } else { process.env[KEY] = savedEnv; }
    Object.defineProperty(process, 'platform', savedPlatform);
  });
  const setPlatform = (p) =>
    Object.defineProperty(process, 'platform', { value: p, configurable: true });

  it('leads with the in-product `amicus key <provider>` fix and drops legacy brand', () => {
    setPlatform('linux');
    const r = validateApiKey('google/gemini-3.5-flash');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('GOOGLE_GENERATIVE_AI_API_KEY not found');
    expect(r.error).toContain('amicus key google');
    expect(r.error).not.toMatch(/sidecar/i);
  });

  it('shows Windows-correct persistence on win32 (setx, no ~/.zshrc)', () => {
    setPlatform('win32');
    const r = validateApiKey('google/gemini-3.5-flash');
    expect(r.error).toContain('setx GOOGLE_GENERATIVE_AI_API_KEY');
    expect(r.error).not.toContain('~/.zshrc');
    expect(r.error).not.toContain('~/.zshenv');
  });

  it('shows shell-rc guidance on non-Windows', () => {
    setPlatform('darwin');
    const r = validateApiKey('google/gemini-3.5-flash');
    expect(r.error).toContain('~/.zshenv');
    expect(r.error).not.toContain('setx');
  });
});
