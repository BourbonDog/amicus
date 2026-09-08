'use strict';

/**
 * Runs in a PLAIN node process, not under jest: @electron/get 5.x is ESM-only
 * and reaches amicus through a dynamic `import()` jest cannot load under
 * CommonJS (the repo's established pattern — cf. sdk-spawn-timing-child.js).
 *
 * WHAT IT MEASURES, and why it is a child rather than an argument in a docblock.
 * Council seat B1 called `withScrubbedRepoEnv`'s coverage "an unverified
 * invariant about @electron/get internals". This replaces `process.env` with a
 * recording Proxy and drives the REAL installed library through a real
 * `downloadArtifact`, with an injected offline downloader and no network, so
 * the invariant is re-measured on every test run instead of argued from a
 * source read that nothing keeps true.
 *
 * Prints ONE json object on stdout; `tests/electron-env-scrub-get5-contract.test.js`
 * asserts on it.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { withScrubbedRepoEnv, isRepoPlantedName } = require('../../src/sidecar/electron-env-scrub');

const GET5 = path.join(__dirname, '..', '..', 'node_modules', '@electron', 'get', 'dist', 'index.js');
const VERSION = '43.1.1';
const FILE_NAME = `electron-v${VERSION}-win32-x64.zip`;
const OFFICIAL = 'https://github.com/electron/electron/releases/download/';
const ATTACKER = 'https://ATTACKER.example/mirror/';

/** What a hostile repository's `.npmrc` / `package.json` plants (npm 11.16.0 shapes). */
const PLANTED = {
  npm_config_electron_mirror: ATTACKER,
  NPM_CONFIG_ELECTRON_MIRROR: `${ATTACKER}UPPER/`,
  npm_config_electron_custom_dir: 'ATTACKERDIR',
  npm_package_config_electron_mirror: `${ATTACKER}pkgjson/`,
  npm_package_config_electron_customFilename: 'ATTACKER.zip',
};

let phase = 'before';
const reads = [];

/** Record every electron-ish env GET, tagged with the scrub phase it happened in. */
function installRecordingEnv() {
  const base = { ...process.env, ...PLANTED };
  process.env = new Proxy(base, {
    get(t, p) {
      if (typeof p === 'string' && /^(npm_(config|package_config)_electron|electron_)/i.test(p)) {
        reads.push({ phase, name: p, planted: isRepoPlantedName(p) });
      }
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; },
    deleteProperty(t, p) { delete t[p]; return true; },
  });
}

/** An offline downloader: records the URL it was asked for, writes fixed bytes. */
function stubDownloader(bytes, urls) {
  return {
    download: async (url, target) => {
      urls.push(url);
      await new Promise((r) => setImmediate(r));   // a genuinely async download
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    },
  };
}

/**
 * One real downloadArtifact, offline.
 * @param {object} o
 * @param {boolean} o.scrub    wrap the call in withScrubbedRepoEnv
 * @param {boolean} o.pinned   send a `checksums` table (amicus's normal route)
 * @param {string[]} o.urls    collects every URL the downloader was asked for
 */
async function downloadOnce({ scrub, pinned, urls }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amicus-scrubcontract-'));
  const bytes = Buffer.from('PK-offline-fixture-bytes');
  const { downloadArtifact } = await import(`file:///${GET5.replace(/\\/g, '/')}`);
  const args = {
    version: VERSION,
    artifactName: 'electron',
    force: true,
    cacheRoot: path.join(tmp, 'cache'),
    platform: 'win32',
    arch: 'x64',
    downloader: stubDownloader(bytes, urls),
    downloadOptions: {},
    ...(pinned ? { checksums: { [FILE_NAME]: crypto.createHash('sha256').update(bytes).digest('hex') } } : {}),
  };
  const call = () => {
    phase = 'inside-scrub';
    const p = downloadArtifact(args);
    phase = 'after-restore';
    return p;
  };
  try {
    await (scrub ? withScrubbedRepoEnv(call) : call());
  } catch { /* the unpinned case ends in a checksum-parse failure; the URLs are the datum */ }
  phase = 'idle';
}

/**
 * B3's claim: can any OTHER task observe the scrubbed environment? Samples
 * `process.env` from the microtask, immediate and timer queues while two
 * concurrent scrubbed downloads run.
 */
async function measureInterleaving() {
  const seen = { samples: 0, sawScrubbed: 0 };
  let sampling = true;
  const sample = () => {
    if (!sampling) { return; }
    seen.samples += 1;
    if (process.env.npm_config_electron_mirror === undefined) { seen.sawScrubbed += 1; }
  };
  // BOUNDED microtask sampling: an unbounded `while (…) await Promise.resolve()`
  // starves the loop outright (measured — the probe never progressed).
  const micro = async () => { for (let i = 0; i < 50; i += 1) { sample(); await Promise.resolve(); } };
  const immediate = () => { if (!sampling) { return; } sample(); micro(); setImmediate(immediate); };
  const timer = () => { if (!sampling) { return; } sample(); setTimeout(timer, 0); };
  immediate();
  timer();
  const a = [];
  const b = [];
  await Promise.all([
    downloadOnce({ scrub: true, pinned: true, urls: a }),
    downloadOnce({ scrub: true, pinned: true, urls: b }),
  ]);
  sampling = false;
  return { ...seen, concurrentUrls: [...a, ...b] };
}

(async () => {
  installRecordingEnv();

  const pinnedScrubbed = [];
  await downloadOnce({ scrub: true, pinned: true, urls: pinnedScrubbed });
  const pinnedReads = reads.splice(0);

  const pinnedBare = [];
  await downloadOnce({ scrub: false, pinned: true, urls: pinnedBare });
  reads.length = 0;

  const unpinnedScrubbed = [];
  await downloadOnce({ scrub: true, pinned: false, urls: unpinnedScrubbed });
  const unpinnedReads = reads.splice(0);

  const interleaving = await measureInterleaving();

  const count = (rows, want) => rows.filter((r) => r.planted && r.phase === want).length;
  process.stdout.write(JSON.stringify({
    official: OFFICIAL,
    attacker: ATTACKER,
    pinnedScrubbedUrls: pinnedScrubbed,
    pinnedUnscrubbedUrls: pinnedBare,
    unpinnedScrubbedUrls: unpinnedScrubbed,
    pinned: { inside: count(pinnedReads, 'inside-scrub'), after: count(pinnedReads, 'after-restore') },
    unpinned: { inside: count(unpinnedReads, 'inside-scrub'), after: count(unpinnedReads, 'after-restore') },
    interleaving,
  }));
})().catch((err) => {
  process.stderr.write(String((err && err.stack) || err));
  process.exit(1);
});
