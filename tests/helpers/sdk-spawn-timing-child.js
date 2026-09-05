'use strict';

/**
 * Runs in a PLAIN node process, not under jest: @opencode-ai/sdk is ESM and
 * reaches amicus through a dynamic import() that jest cannot load under
 * CommonJS. Puts the fake engine FIRST on PATH, starts the engine through the
 * real startServer -> the real createOpencodeServer -> the fake, then prints
 * what the fake engine saw in its env at spawn time. The parent test asserts.
 */
const fs = require('fs');
const path = require('path');

(async () => {
  const fixture = path.join(__dirname, '..', 'fixtures', 'fake-engine');
  process.env.PATH = fixture + path.delimiter + (process.env.PATH || '');
  if (process.platform === 'win32' && !/\.CMD(;|$)/i.test(process.env.PATHEXT || '')) {
    process.env.PATHEXT = `${process.env.PATHEXT || ''};.CMD`;
  }
  const { startServer } = require('../../src/opencode-client');
  const { server } = await startServer({
    _hasOpencodeBinary: () => true,
    _createClient: async () => ({}),
    timeout: 15000,
  });
  const seen = JSON.parse(fs.readFileSync(process.env.FAKE_ENGINE_OUT, 'utf8'));
  await server.close();
  process.stdout.write(JSON.stringify(seen));
})().catch((err) => {
  process.stderr.write(String((err && err.stack) || err));
  process.exit(1);
});
