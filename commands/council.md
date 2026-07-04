---
description: Run a structured multi-model LLM council review of the given material — wraps the second-opinion skill (independent reviews → anonymous cross-review → non-Claude chair verdict → accept/deny decisions).
argument-hint: [material, path, or URL] [analysis request + criteria]
disable-model-invocation: true
---

Run a full council review by invoking the `second-opinion` skill shipped in this
plugin (listed as `amicus:second-opinion`). Do not synthesize a verdict yourself —
the skill's chair model does that; you orchestrate.

Treat everything the user typed after the command as the review request:

$ARGUMENTS

Interpret it as three inputs: the **material** (inline text, a file path, or a URL),
the **analysis request**, and the **criteria**. If any of the three is missing or
ambiguous, ask for it before launching any model (the skill's Stage 0 covers this —
don't re-ask for what is already present).

Then follow the second-opinion skill end to end, in pipeline order: Stage 0
intake/prep and run-folder setup, then council selection with a cost estimate
and explicit user confirmation; Stage 1 independent reviews, running
`amicus council validate` on each leg's findings block as it lands; Stage 2
cross-review, followed by `amicus council tally` once cross-review settles;
Stage 3 council-chair synthesis; Stage 4 the accept/deny decision pass; and
Stage 5, which runs `amicus council verdict` to write the final `verdict.json`.
