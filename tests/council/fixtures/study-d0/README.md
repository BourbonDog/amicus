# Study run D0 (2026-09-11 council leg-failure study) — verbatim

`tally.json` and `verdict.json` exactly as the engine wrote them (run `20dde633`, task intent,
seats kimi/grok/qwen). All three seats came back as narration stubs, were repaired, and carry
`findingsUnverified: true` on their `runStats` rows; the run reported `complete`, exit 0, no
`degrades`. `verdict.json` is the PRE-4.9.8 document: its census is `{reviewed: 3, of: 3}`.
The fixture for #242 / spec §5 (tests/council/report-unverified.test.js, verdict.test.js V12).
