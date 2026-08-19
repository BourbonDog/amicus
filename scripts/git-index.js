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
  let i = 0;
  while (off < buf.length && i < paths.length) {
    const nl = buf.indexOf(0x0a, off);
    if (nl === -1) {break;}
    const header = buf.toString('utf-8', off, nl);
    off = nl + 1;
    if (header.endsWith(' missing')) { i++; continue; }
    const size = Number(header.split(' ')[2]);
    if (!Number.isFinite(size)) { i++; continue; }
    out.set(paths[i], buf.toString('utf-8', off, off + size));
    off += size + 1; // content, then the newline the protocol appends
    i++;
  }
  return out;
}

/**
 * Read many paths' index content in one git call.
 * @param {string[]} paths
 * @param {(input: string) => Buffer} [batch] - injectable for tests
 * @returns {Map<string, string>} path -> staged content (absent if not in index)
 */
function readIndexContent(paths, batch = runBatch) {
  if (!paths.length) {return new Map();}
  return parseBatch(batch(paths.map(p => `:${p}`).join('\n') + '\n'), paths);
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
