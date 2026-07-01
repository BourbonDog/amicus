/**
 * Web-UI session route builder (#45).
 *
 * OpenCode's router format is `/<base64url(projectPath)>/session/<sessionId>`.
 * The route MUST be built from the directory the OpenCode session was actually
 * created/scoped to — NOT a fresh base64url(process.cwd()) guess. When the
 * amicus process cwd != --cwd (the normal sidecar-skill launch), a CWD-derived
 * route points at a project route with no matching session, so Web-UI follow-up
 * prompts fail "unable to retrieve session". The caller passes the same
 * directory it used to scope createSession (the server-echoed session.directory,
 * or a consistent canonicalProjectPath(--cwd) fallback).
 *
 * Pure function: no electron, no fs, no process state. Safe to unit-test.
 *
 * The directory is canonicalized before encoding so incidental separator
 * differences (Windows '\\' vs '/', mixed/duplicate separators) produce the same
 * route segment — otherwise OpenCode normalizing '/' vs '\\' would yield a
 * mismatched base64url and a "session not found" route.
 *
 * @param {string} baseUrl - OpenCode server base URL (e.g. http://localhost:4096)
 * @param {string} [sessionId] - OpenCode session id; falsy → return baseUrl only
 * @param {string} sessionDirectory - The directory the session is scoped to
 * @returns {string} Fully-qualified route URL, or baseUrl when no session id.
 */
const { canonicalProjectPath } = require('../src/utils/project-path');

function buildSessionRoute(baseUrl, sessionId, sessionDirectory) {
  if (!sessionId) {
    return baseUrl;
  }
  const seg = Buffer.from(canonicalProjectPath(sessionDirectory)).toString('base64url');
  return `${baseUrl}/${seg}/session/${sessionId}`;
}

module.exports = { buildSessionRoute };
