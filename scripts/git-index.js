#!/usr/bin/env node

/**
 * Read file content from the git INDEX rather than the working tree.
 *
 * The pre-commit gates (check-secrets, check-file-sizes, check-citations) all
 * used to `readFileSync` the working copy. That is not what a commit contains.
 * Stage a file, edit it again, and the hook inspects the edit while git commits
 * the staged version — so a staged secret, an oversized staged file, or a stale
 * staged citation could all be committed without ever being checked, and a valid
 * staged fix could be blocked by an unrelated working-tree edit.
 *
 * `git show :<path>` gives index content, but one subprocess per file blows the
 * hook's sub-2s budget on a repo this size. `git cat-file --batch` reads every
 * blob in ONE process, so the whole tree costs a single spawn.
 *
 * Content is returned as a Buffer-decoded string. Sizes in the batch protocol
 * are BYTE counts, so the parse walks the buffer by byte offset — slicing a JS
 * string by those numbers would desync on the first non-ASCII character, and
 * this repo's comments are full of em-dashes and arrows.
 */

const { execFileSync } = require('node:child_process');

/** Run `git cat-file --batch`, feeding it one object name per line. */
function runBatch(input) {
  return execFileSync('git', ['cat-file', '--batch'], {
    input,
    maxBuffer: 1 << 28,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}

/**
 * Parse `git cat-file --batch` output.
 *
 * Each entry is either `<oid> <type> <size>\n<content>\n` or `<name> missing\n`.
 * Entries come back in request order, so results zip against the input paths.
 * A "missing" entry is not an error: it is what a staged DELETION looks like.
 *
 * @param {Buffer} buf - raw batch output
 * @param {string[]} paths - the paths requested, in order
 * @returns {Map<string, string>} path -> content, absent for missing entries
 */
function parseBatch(buf, paths) {
  const out = new Map();
  let off = 0;
  const fail = (why) => { throw new Error(`git cat-file --batch: ${why}`); };

  // FAIL CLOSED. Every requested path must be accounted for — either with
  // content, or with git's explicit `missing`. Anything else throws.
  //
  // The alternative is worse than it looks: callers read an absent path as a
  // staged deletion and SKIP it. So a short or malformed response would make
  // check-secrets quietly not scan a file, which is a fail-OPEN on the highest
  // consequence gate in the repo. A crashing hook is recoverable; a hook that
  // silently stops checking is not.
  for (let i = 0; i < paths.length; i++) {
    if (off >= buf.length) {
      fail(`output ended after ${i} of ${paths.length} entries (next: ${paths[i]})`);
    }
    const nl = buf.indexOf(0x0a, off);
    if (nl === -1) { fail(`unterminated header for ${paths[i]}`); }
    const header = buf.toString('utf-8', off, nl);
    off = nl + 1;
    // The ONLY legitimate way for a requested path to carry no content.
    if (header.endsWith(' missing')) { continue; }
    const size = Number(header.split(' ')[2]);
    // Skipping a bad header without advancing `off` would read the NEXT entry's
    // body as a header and desync everything after it.
    if (!Number.isFinite(size)) { fail(`unparseable header '${header}' for ${paths[i]}`); }
    // A truncated blob silently drops whatever followed the cut — a secret in
    // the tail would read as a clean file.
    if (off + size > buf.length) {
      fail(`truncated output for ${paths[i]} (declared ${size} bytes, ${buf.length - off} available)`);
    }
    out.set(paths[i], buf.toString('utf-8', off, off + size));
    off += size + 1; // content, then the newline the protocol appends
  }
  return out;
}

/** Paths per `git cat-file` invocation, so one call's output stays bounded. */
const BATCH_SIZE = 400;

/**
 * Read many paths' index content, in chunked git calls.
 *
 * Chunking bounds the buffer any single call has to hold. One call for the whole
 * tree would make peak memory a function of repo size against a fixed maxBuffer,
 * so a large enough repo would fail outright where per-file reads had degraded
 * gracefully. A few calls cost a few milliseconds and remove that ceiling.
 *
 * @param {string[]} paths
 * @param {(input: string) => Buffer} [batch] - injectable for tests
 * @param {number} [chunkSize]
 * @returns {Map<string, string>} path -> staged content (absent if not in index)
 */
function readIndexContent(paths, batch = runBatch, chunkSize = BATCH_SIZE) {
  const out = new Map();
  for (let i = 0; i < paths.length; i += chunkSize) {
    const slice = paths.slice(i, i + chunkSize);
    const got = parseBatch(batch(slice.map(p => `:${p}`).join('\n') + '\n'), slice);
    for (const [k, v] of got) { out.set(k, v); }
  }
  return out;
}

/**
 * Read one path's index content.
 * @param {string} path
 * @param {(input: string) => Buffer} [batch]
 * @returns {string|null} staged content, or null when the path is not in the index
 */
function readIndexFile(path, batch = runBatch) {
  const got = readIndexContent([path], batch);
  return got.has(path) ? got.get(path) : null;
}

module.exports = { readIndexContent, readIndexFile, parseBatch, runBatch };
