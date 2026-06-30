/**
 * Web-UI route construction (#45).
 *
 * The OpenCode Web UI route must be built from the SAME directory the OpenCode
 * session was created/scoped to, NOT a fresh base64url(CWD) guess. When the
 * amicus process cwd != --cwd, a CWD-derived route points at a project route
 * with no matching session and follow-up prompts fail "unable to retrieve
 * session". buildSessionRoute takes the (server-echoed or consistently
 * canonicalized) session directory and builds the route from it.
 */

const { buildSessionRoute } = require('../../electron/session-route');

describe('buildSessionRoute', () => {
  const BASE = 'http://localhost:4096';

  it('returns the base URL unchanged when there is no session id', () => {
    expect(buildSessionRoute(BASE, '', '/some/dir')).toBe(BASE);
    expect(buildSessionRoute(BASE, undefined, '/some/dir')).toBe(BASE);
  });

  it('builds the route from the session directory, not a different cwd', () => {
    const sessionDir = 'C:/Users/me/project';
    const route = buildSessionRoute(BASE, 'ses_abc', sessionDir);
    const expectedSeg = Buffer.from(sessionDir).toString('base64url');
    expect(route).toBe(`${BASE}/${expectedSeg}/session/ses_abc`);
  });

  it('encodes the directory exactly (a CWD-derived route would not match)', () => {
    // The session was scoped to --cwd; the process cwd is something ELSE.
    const sessionDir = 'C:/Users/me/--cwd-target';
    const processCwd = 'C:/Users/me/process-launch-dir';

    const route = buildSessionRoute(BASE, 'ses_xyz', sessionDir);

    const sessionSeg = Buffer.from(sessionDir).toString('base64url');
    const cwdSeg = Buffer.from(processCwd).toString('base64url');
    expect(route).toContain(`/${sessionSeg}/session/ses_xyz`);
    expect(route).not.toContain(cwdSeg);
  });
});
