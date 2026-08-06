// tests/scripts/publish-workflow.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', '..', '.github', 'workflows', 'publish.yml');

describe('publish workflow (Phase 11 release-rail hardening — B04 + B05)', () => {
  const yml = () => fs.readFileSync(WF, 'utf-8');

  test('tag<->package lockstep is checked before npm publish, with a clear ::error:: on mismatch', () => {
    const y = yml();
    const lockstepIdx = y.indexOf('::error::');
    expect(lockstepIdx).toBeGreaterThan(-1);
    // the lockstep check must reference both the tag-derived VERSION and the
    // package.json version, and must run strictly before `npm publish`
    const checkBlock = y.slice(0, y.indexOf('npm publish --access public'));
    expect(checkBlock).toMatch(/package\.json/);
    expect(checkBlock).toMatch(/VERSION/);
    expect(checkBlock).toContain('::error::');
    expect(checkBlock).toMatch(/exit 1/);
  });

  test('npm publish is gated by a version-exists guard, and the publish invocation stays byte-identical', () => {
    const y = yml();
    const stepStart = y.indexOf('- name: Publish to npm');
    const nextStepIdx = y.indexOf('- name: Install mcp-publisher');
    expect(stepStart).toBeGreaterThan(-1);
    expect(nextStepIdx).toBeGreaterThan(stepStart);
    const npmPublishStepBlock = y.slice(stepStart, nextStepIdx);
    // the exact publish command must survive untouched
    expect(npmPublishStepBlock).toContain('npm publish --access public --provenance');
    // guard must check the registry before publishing
    expect(npmPublishStepBlock).toMatch(/npm view "?amicus@\$VERSION"? version/);
    // must emit a ::notice:: when skipping
    expect(npmPublishStepBlock).toContain('::notice::');
  });

  test('ordering: npm version-exists guard < npm publish < mcp-publisher publish', () => {
    const y = yml();
    const versionExistsGuardMatch = y.match(/npm view "?amicus@\$VERSION"? version/);
    const versionExistsGuardIdx = versionExistsGuardMatch ? versionExistsGuardMatch.index : -1;
    const npmPublishIdx = y.indexOf('npm publish --access public --provenance');
    const mcpPublishIdx = y.indexOf('./mcp-publisher publish');
    expect(versionExistsGuardIdx).toBeGreaterThan(-1);
    expect(npmPublishIdx).toBeGreaterThan(-1);
    expect(mcpPublishIdx).toBeGreaterThan(-1);
    expect(versionExistsGuardIdx).toBeLessThan(npmPublishIdx);
    expect(npmPublishIdx).toBeLessThan(mcpPublishIdx);
  });

  test('mcp-publisher login github-oidc has its own 5x20s retry loop and hard-fails after exhaustion', () => {
    const y = yml();
    // literal string pinned by tests/scripts/package-manifest.test.js — must stay intact
    expect(y).toContain('mcp-publisher login github-oidc');

    // isolate the login step's script (between the login step name and the next step name)
    const loginStepIdx = y.indexOf('mcp-publisher login github-oidc');
    const publishCallIdx = y.indexOf('./mcp-publisher publish');
    expect(publishCallIdx).toBeGreaterThan(loginStepIdx);
    const loginBlock = y.slice(loginStepIdx, publishCallIdx);

    // retry loop: attempted up to 5 times
    expect(loginBlock).toMatch(/for i in 1 2 3 4 5/);
    expect(loginBlock).toMatch(/sleep 20/);
    // hard-fail semantics after exhaustion
    expect(loginBlock).toContain('::error::');
    expect(loginBlock).toMatch(/exit 1/);
  });

  test('mcp-publisher publish retains its existing 5x20s retry loop and hard-fail semantics', () => {
    const y = yml();
    // scope to the whole "Publish to MCP Registry" step (through the next
    // step header), so the retry `for` loop that wraps the publish call —
    // which starts BEFORE the call site — is captured regardless of exact
    // byte offsets.
    const stepStart = y.indexOf('- name: Publish to MCP Registry');
    const nextStepIdx = y.indexOf('- name: Create GitHub Release');
    expect(stepStart).toBeGreaterThan(-1);
    expect(nextStepIdx).toBeGreaterThan(stepStart);
    const registryStepBlock = y.slice(stepStart, nextStepIdx);
    expect(registryStepBlock).toContain('./mcp-publisher publish');
    // exactly two retry loops live in this step (login + publish); both use
    // the 5x20s pattern, so at least 2 occurrences confirms both intact.
    const retryLoopCount = (registryStepBlock.match(/for i in 1 2 3 4 5/g) || []).length;
    expect(retryLoopCount).toBeGreaterThanOrEqual(2);
    expect(registryStepBlock).toMatch(/sleep 20/);
    expect(registryStepBlock).toContain('::error::');
    expect(registryStepBlock).toMatch(/exit 1/);
  });

  test('registry publish is idempotent on re-run: pre-check against the registry API before publishing', () => {
    const y = yml();
    const stepStart = y.indexOf('- name: Publish to MCP Registry');
    const nextStepIdx = y.indexOf('- name: Create GitHub Release');
    expect(stepStart).toBeGreaterThan(-1);
    expect(nextStepIdx).toBeGreaterThan(stepStart);
    const registryStepBlock = y.slice(stepStart, nextStepIdx);
    // pre-check the MCP Registry for the tag version before calling mcp-publisher publish
    expect(registryStepBlock).toMatch(/registry\.modelcontextprotocol\.io\/v0/);
    expect(registryStepBlock).toContain('::notice::');
  });

  test('registry pre-check STATUS curl tolerates transport failure (non-fatal under bash -e)', () => {
    const y = yml();
    // scope to just the pre-check portion of the "Publish to MCP Registry"
    // step: from the step header through the login step's name (the
    // pre-check's STATUS curl/if-block lives entirely before login starts).
    const stepStart = y.indexOf('- name: Publish to MCP Registry');
    const loginStepIdx = y.indexOf('mcp-publisher login github-oidc');
    expect(stepStart).toBeGreaterThan(-1);
    expect(loginStepIdx).toBeGreaterThan(stepStart);
    const preCheckBlock = y.slice(stepStart, loginStepIdx);

    expect(preCheckBlock).toMatch(/registry\.modelcontextprotocol\.io\/v0/);

    // the STATUS=$(curl ...) assignment must not abort the step on a
    // transport-level curl failure (DNS/connection/TLS/timeout) under
    // `bash -e`. The curl call wraps across a line-continuation (`\`), so
    // isolate the full logical assignment (STATUS=$( ... ) through the
    // closing paren, tolerant of the wrap) and require a non-fatal guard
    // (`|| true` or equivalent) within it.
    const statusAssignMatch = preCheckBlock.match(/STATUS=\$\(curl[\s\S]*?\)[^\n]*/);
    expect(statusAssignMatch).not.toBeNull();
    const statusAssign = statusAssignMatch[0];
    expect(statusAssign).toMatch(/\|\|\s*true/);

    // `|| true` only covers transport-level errors (DNS/connection/TLS) —
    // it does NOT cover a hang: an accepted-then-stalled connection has no
    // default curl timeout, so a stuck pre-check could stall the release
    // job for hours on any publish run. Require an explicit transfer
    // timeout on this same curl invocation so a stall fails fast instead
    // (a non-zero exit from the timeout still hits `|| true` and correctly
    // falls through to the publish/retry path below).
    expect(statusAssign).toMatch(/--max-time\s+\d+/);
  });

  test('registry skip fires only on 200 AND a body that names this exact version (D6, v4.6.3)', () => {
    const y = yml();
    const stepStart = y.indexOf('- name: Publish to MCP Registry');
    const loginStepIdx = y.indexOf('mcp-publisher login github-oidc');
    const preCheckBlock = y.slice(stepStart, loginStepIdx);
    // the body must be captured to a file (never piped — no pipefail here)
    expect(preCheckBlock).toMatch(/-o\s+"\$BODY_FILE"/);
    // the skip condition requires BOTH the status test and the body grep
    const skipCond = preCheckBlock.match(/if \[ "\$STATUS" = "200" \][\s\S]*?then/);
    expect(skipCond).not.toBeNull();
    expect(skipCond[0]).toMatch(/grep -q/);
    expect(skipCond[0]).toMatch(/\$VERSION/);
    // fail-toward-publish: the pre-check region must contain no exit 1
    expect(preCheckBlock).not.toMatch(/exit 1/);
  });

  test('GitHub Release creation is guarded by an existence check (gh release view)', () => {
    const y = yml();
    const stepStart = y.indexOf('- name: Create GitHub Release');
    const nextStepIdx = y.indexOf('- name: Generate release notes with Claude');
    expect(stepStart).toBeGreaterThan(-1);
    expect(nextStepIdx).toBeGreaterThan(stepStart);
    const releaseStepBlock = y.slice(stepStart, nextStepIdx);
    expect(releaseStepBlock).toMatch(/gh release view\s+"\$TAG_NAME"/);
    expect(releaseStepBlock).toContain('::notice::');
    // the guard must precede the actual release create call
    const viewIdx = releaseStepBlock.indexOf('gh release view "$TAG_NAME"');
    const createIdx = releaseStepBlock.indexOf('gh release create "$TAG_NAME"');
    expect(viewIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(viewIdx).toBeLessThan(createIdx);
  });

  test('stale "re-run will NOT recover" claim is gone from the workflow comment block', () => {
    const y = yml();
    // tolerant of the comment-wrapped, multi-line phrasing (each line is its
    // own `# ...` comment, so a naive \s+ span misses the `#` + indentation
    // between wrapped words) — strip comment markers/newlines before matching.
    const flattened = y.replace(/^\s*#\s?/gm, ' ').replace(/\s+/g, ' ');
    expect(flattened).not.toMatch(/RE-RUN will NOT recover/i);
  });

  test('docs/DISTRIBUTION.md no longer claims re-run cannot recover; re-run is documented as the primary path', () => {
    const docPath = path.join(__dirname, '..', '..', 'docs', 'DISTRIBUTION.md');
    const doc = fs.readFileSync(docPath, 'utf-8');
    expect(doc).not.toMatch(/re-run\s+will\s+NOT\s+work/i);
    expect(doc.toLowerCase()).toMatch(/re-run/);
  });
});
