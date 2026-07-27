# Security review — `md-lite.js`

The two prior chairs were both right about the fact they each checked and both wrong to stop there. The consumer-side clearance is correct: every call site (`workspace-panels.js:46`, `workspace-render.js:261`) hands the renderer a plain string and lets `md-lite.js` produce its own DOM — no `innerHTML` on the caller side. And the certification-blocker chair was correct that an unreviewed untrusted-input boundary cannot be waved through. Having now read the file itself, I can reconcile them: **the DOM-injection surface is genuinely clean, but the renderer is trivially vulnerable to catastrophic resource exhaustion, and its test suite proves only the one property its author was thinking about.** Nobody dies of XSS here; the tab hangs instead.

## DOM injection — clean, and I can say why

Every string reaches the DOM through exactly two sinks: `Element.textContent` (headings via `applyInline`, code bodies, paragraph/list text) and `document.createTextNode` (non-code inline segments). There is no `innerHTML`, no `insertAdjacentHTML`, no `setAttribute` on any attacker-influenceable attribute, no element name derived from input. Tag names are all literals (`h`+level, `pre`, `code`, `ul`/`ol`/`li`, `p`), and the one computed tag — `'h' + Math.min(6, b.level + 2)` — is clamped to `h3`–`h6` from an integer `level` that is itself `h[1].length` where `h[1]` matched `#{1,4}`, so it can only be 3–6. No `href`/`src`/`style`/event attributes are ever emitted, so the `javascript:`/`data:` URL vector in the threat model has no sink to land in. The `<img onerror>` and `<script>` payloads in the tests render as literal text because they never enter an HTML-parsing context. This half of the review is a genuine **clean** — the consumer-side chair's instinct was right, and now the internals back it.

## ReDoS / resource exhaustion — the real finding (major)

The individual regexes are linear and safe (`H_RE`, `UL_RE`, `OL_RE`, the inline backtick pattern all have no nested quantifiers). The exhaustion vector is not backtracking — it is **algorithmic blowup in `parseInline` under repeated re-scanning**, compounded by **zero input length cap** in a chain the callers advertise as reaching *200 KB*.

`parseInline` is O(n²) on a pathological line. Each iteration does `/`([^`\n]+)`/.exec(rest)` on the *entire* remaining string, then `rest = rest.slice(...)` advances by only the matched prefix. Feed it a long run with no closing backtick — e.g. a single 200 KB paragraph line of `"a".repeat(200000)` — and here is the subtlety: the first `.exec` scans all 200 K characters looking for a backtick pair, fails, and the function returns after one pass. That single case is O(n). The quadratic case is a line of the form `` `x` `` repeated tens of thousands of times: each `.exec` re-scans from the current offset, and while each match advances, the *paragraph coalescing* in `parseMdLite` (`p.join(' ')`) first concatenates every non-blank consecutive line into one megastring, so a 200 KB block of `` `a` `` pairs becomes one line fed to one `parseInline` call. On top of that, `String.prototype.slice` allocates a fresh copy of the tail each iteration — O(n) per iteration, O(n²) total in both time and transient allocation. A few hundred KB of alternating backticks will pin the renderer's thread for seconds and churn hundreds of MB. Because this runs on the **Electron renderer's main thread**, the Workspace UI freezes — no yield, no cancellation.

Severity **major**, not blocker: it is a denial-of-service against a local single-user desktop GUI displaying content the same user requested, not a cross-user or privilege-crossing exploit. But it is exploitable *now*, needs no user interaction beyond opening a panel, and the 200 KB truncation note in `workspace-render.js` proves the system already anticipates large inputs while doing nothing to bound their parse cost. The truncation is applied to *display* ("Truncated at 200 KB"), not before the parse — `renderMdLite` gets the full slice.

## Prototype pollution — clean

The parser builds block objects with literal keys (`t`, `level`, `text`, `items`, `code`) and never uses a parsed token as an object key. `blocks` is an array; `out`/`ul`/`ol` are arrays; there is no `obj[userControlledKey] = …` anywhere. `__proto__`/`constructor`/`prototype` in the input are just string content that flows to `text`. No pollution path exists. **Clean.**

## Correctness bugs that touch the security story (minor)

- **Fence detection is prefix-only.** `/^```/.test(line)` opens a code block on *any* line beginning with three backticks, and the same loose test closes it. A line like ```` ```rm -rf ```` opens a fence; more relevantly, `parseInline` is never applied inside code (correct), but a line that is ` ``` ` followed by content on later lines that themselves start with `` ``` `` will toggle in ways that can misattribute a heading/list as code body. Consequence is garbled rendering, not injection — but it is state that "leaks between blocks," which item 5 asked about. **Minor.**
- **Inline code regex forbids newlines but paragraph-join inserts spaces**, so a backtick span split across two source lines silently becomes one line via `p.join(' ')` and *can* now match. This is a correctness surprise, not a vuln. **Nit.**

## What the tests do NOT cover — findings in their own right

The suite is a well-constructed **proof of exactly one theorem**: "no string is ever assigned as HTML." The fake-DOM `throwTrap` on `innerHTML`/`outerHTML`/`insertAdjacentHTML`, plus the source-level grep for banned tokens, genuinely nail that property. But the threat model asked for five things and the tests exercise one:

1. **No resource/DoS test at all.** No large-input, deep-nesting, or pathological-repetition case. The O(n²) `parseInline` behavior above is invisible to this suite. **This gap is the twin of the major finding.**
2. **No prototype-pollution test.** A `__proto__`-laden document is never fed in. (The code is clean, but the suite doesn't *demonstrate* it — so the clean verdict rests on reading, not on a guard that would catch a future regression that introduced `obj[key]=…`.)
3. **No unbounded-input / length-cap test**, matching the fact that no cap exists.
4. The banned-token grep would **not catch a `setAttribute('href', userText)` regression** — it only guards the four HTML-string APIs, not attribute sinks. If a future edit added a link feature, the suite would stay green while opening a `javascript:` hole. This is a latent gap, worth a comment or an assertion.

None of these are blockers. Together they explain the two-chair standoff: the consumer chair read the one property the tests prove and generalized it to "safe"; the certification chair correctly refused to generalize from a suite that never tested four of the five threat categories.

## Bottom line

Reconciled verdict: **the injection concern that motivated the certification block is unfounded — this file does not have an XSS or DOM-injection path**, and the CSP (`default-src 'none'`, `script-src file:`) would in any case neutralize an injected inline handler. But clearing it for ship on the consumer chair's reasoning was premature, because the actual live defect is a **main-thread DoS via O(n²) inline parsing on uncapped input**, which neither chair looked for. Fix: cap input length before `parseMdLite` (the callers already know about 200 KB — enforce it as a parse bound, not just a display note), and rewrite `parseInline` to advance with a single non-backtracking scan / `lastIndex` cursor instead of `slice`. Add DoS and prototype-pollution tests so the suite covers the threat model rather than one corner of it.

```json
{
  "overall": "The DOM-injection surface is genuinely clean: every attacker-influenced string lands in the DOM via textContent or createTextNode, all tag names are literals, the one computed tag ('h'+level) is clamped to h3-h6 from a #{1,4} match, and no href/src/style/event attribute sink exists for the CSP-relevant javascript:/data: vectors. This reconciles the two chairs — the consumer-side clearance was correct about the sinks. The real, unlooked-for defect is resource exhaustion: parseInline is O(n^2) in time and transient allocation on a pathological line (repeated backtick pairs), parseMdLite coalesces consecutive lines into one megastring before that O(n^2) call via p.join(' '), and NO length cap is applied anywhere despite the callers advertising 200 KB inputs and even printing a 'Truncated at 200 KB' note that governs display only, not parse cost. This freezes the Electron renderer main thread. Severity major, not blocker: a local single-user desktop DoS on self-requested content, not a privilege- or user-crossing exploit. Prototype pollution is clean (literal keys only). The test suite is a tight proof of exactly one theorem — 'no string is assigned as HTML' — and does not touch four of the five threat-model categories (no DoS, no length-cap, no prototype-pollution test, and the banned-token grep would not catch a future setAttribute('href', userText) regression).",
  "findings": [
    { "id": 1, "severity": "major",
      "claim": "parseInline is O(n^2) in time and transient allocation on a pathological line, and parseMdLite feeds it an unbounded, line-coalesced megastring with no length cap, freezing the Electron renderer main thread (DoS).",
      "location": "md-lite.js parseInline (the `while (rest.length)` loop with `rest = rest.slice(...)`) and parseMdLite paragraph coalescing (`blocks.push({ t: 'p', text: p.join(' ') })`); consumer workspace-render.js:261 passes the full ~200 KB slice, truncating only the display note.",
      "rationale": "Each iteration runs /`([^`\\n]+)`/.exec on the entire remaining string and slice() allocates a fresh tail copy; a paragraph of tens of thousands of `x` backtick pairs (coalesced from consecutive lines into one line) makes total work quadratic. A few hundred KB pins the single UI thread for seconds and churns hundreds of MB. Exploitable now via any model emitting such prose; no cancellation or yield exists. Not a blocker because it is a local single-user desktop DoS on content the same user requested, not a cross-user/privilege-crossing exploit." },
    { "id": 2, "severity": "minor",
      "claim": "The test suite proves only 'no string is assigned as HTML' and omits four of the five threat-model categories: no resource/DoS test, no length-cap test, no prototype-pollution test.",
      "location": "tests/workspace/md-lite.test.js (entire file; the throwTrap DOM and banned-token grep cover only HTML-string sinks).",
      "rationale": "The briefing states gaps in the test file are findings in their own right. The O(n^2) behavior in finding 1 is invisible to this suite, and the clean prototype-pollution verdict rests on reading rather than a regression guard. This is the mechanical cause of the two-chair standoff: the suite proves one corner of the threat model and was generalized to 'safe'." },
    { "id": 3, "severity": "minor",
      "claim": "The banned-token source grep guards only the four HTML-string APIs and would not catch a future setAttribute('href'/'src', userText) regression, leaving a latent javascript:/data: URL hole undetected by CI.",
      "location": "tests/workspace/md-lite.test.js — the 'never spells the banned DOM-injection APIs' test (bannedTokens list).",
      "rationale": "The renderer emits no attribute sinks today (so this is not a live vuln), but the suite's only structural guard is a token grep that omits attribute-sink APIs. If a link/image feature were added, the suite would stay green while opening a javascript: URL vector that the CSP's script-src file: does not fully close for href-based navigation." },
    { "id": 4, "severity": "minor",
      "claim": "Fence detection is a loose prefix test (/^```/) for both open and close, so state can leak between blocks and misattribute headings/lists as code body.",
      "location": "md-lite.js parseMdLite — the two `/^```/.test(...)` checks governing code-fence open/close.",
      "rationale": "Any line starting with three backticks toggles fence state regardless of trailing content; a stray triple-backtick in prose can swallow subsequent structural lines into a code block. Consequence is garbled rendering, not injection, but it is the cross-block state leak item 5 of the briefing asked about." },
    { "id": 5, "severity": "nit",
      "claim": "Inline code regex forbids newlines, but paragraph coalescing (p.join(' ')) can merge a backtick span split across two source lines into one line that then matches, producing a surprising code span.",
      "location": "md-lite.js parseInline (/`([^`\\n]+)`/) interacting with parseMdLite paragraph join.",
      "rationale": "A correctness surprise, not a security defect: a span the author wrote across two lines becomes inline code after coalescing. Worth a note for renderer fidelity." }
  ]
}
```