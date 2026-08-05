# GoA paper review — adoption notes & design inputs (GOA-1…GOA-8)

**Provenance.** Session 2026-08-05, branch `claude/amicus-paper-review-61714k`. Christian asked for
a review of the Graph-of-Agents paper against amicus, then backlogged eight items (BACKLOG.md
§ "GoA paper review (2026-08-05)", GOA-1…GOA-8). This doc is the durable record of the full
analysis — the paper's mechanics with exact numbers, the code-grounding map (every claim verified
against source at `0385ae1`), the exploration-policy design discussion behind GOA-5/6/7/8, the
items **considered but deliberately not backlogged**, and the do-not-overclaim limits. Read this
before implementing any GOA item; do not re-derive it.

**Paper.** "Graph-of-Agents: A Graph-based Framework for Multi-Agent LLM Collaboration."
Yun, Peng, Li, Fan, Chen, Zou, Li, Chen (UNC Chapel Hill / Eigent AI / MIT-IBM / Stanford).
ICLR 2026. arXiv:2604.17148 (v1 2026-04-18). Code: https://github.com/UNITES-Lab/GoA.
James Zou co-authored the original Mixture-of-Agents (MoA) paper this one supersedes.

---

## 1. What the paper does (all test-time, prompt-only — no training, same constraint as amicus)

Four steps; the parenthesized constants are theirs, tuned on 7–8B open models:

1. **Node sampling.** Each pool model gets a *model card* — Domain / Task specialization /
   Parameter size / Special features — summarized once from its Hugging Face README. A cheap
   general "meta-LLM" (they used Qwen2.5-7B-Instruct) picks the top-k (k=3) models for the query.
   The selection prompt explicitly allows **repeating an index** when one model dominates
   (the Self-MoA result: self-ensembling the best model often beats mixing).
2. **Edge sampling.** Selected agents answer independently; each agent then scores the *others'*
   responses (self excluded to reduce self-bias), distributing **exactly 1.0** across peers.
   Summed incoming scores = per-agent relevance S_j; agents with S_j < τ (τ=0.05) are pruned;
   scores normalize into a weighted directed adjacency matrix.
3. **Directed message passing**, two phases in a load-bearing order: Source→Target (strong
   agents' answers shown to weak agents, who revise), then Target→Source (revisions flow back;
   strong agents finalize). Peer answers are labeled **high relevance** (w>0.7) /
   **moderate** (0.4<w≤0.7) / **low** (w≤0.4) in the prompt, with "Be critical — some
   information may be incorrect."
4. **Graph pooling.** *Max*: return the top-relevance agent's final answer — zero extra calls.
   *Mean*: meta-LLM synthesizes, weighted by relevance.

**Headline results.** GoA with **3 agents beats six 6-agent baselines** (Debate,
Self-Consistency, Refine, ReConcile, MoA, Self-MoA) across MMLU / MMLU-Pro / GPQA / MATH /
HumanEval / MedMCQA. Efficiency on MMLU-Pro (their Table 2): GoA-Max **11 calls / 19.18k tokens /
100.43s @ 54.78 acc** vs MoA **19 / 56.05k / 240.26s @ 53.33**. Replicated with gpt-4o, where
GoA with 3 agents matches/beats DyLAN with 8 on MedMCQA + HumanEval.

**Ablations worth remembering** (MMLU-Pro / GPQA deltas from GoA baseline 54.78/39.98):
- **Reversed message-passing direction is the WORST cut** (−2.60 / −5.05) — worse than removing
  either direction entirely. Direction carries real signal; naive "everyone sees everyone" is
  closer to the failure mode than to the win.
- w/o Source→Target −2.57 / −3.86; w/o Target→Source −1.12 / −1.95 (both directions matter).
- **Unweighted edges (A_ij=1) cost −1.87 / −2.64** — the evidence behind GOA-2: throwing away
  relevance weights at synthesis time measurably hurts.
- k=2 too little diversity; k=5 slight degradation; τ=0.1/0.2 over-prune (τ=0.05 best).
- Fixed-node HumanEval (3 identical code models, isolating the communication pattern):
  GoA 85.98 > MoA 85.37 > ReConcile 80.61 > **Debate 71.95**. Directional refinement beats
  symmetric debate at similar cost.

**Prompt-level details worth copying** (their Appendix B): initial responses are structured JSON
with a `confidence_level` float used to detect format-incapable models and **substitute a general
model** (→ GOA-3); single user-role messages, no system prompt, for cross-model compatibility;
edge-scoring output is a bare comma-separated score list summing to 1.0; refinement prompts carry
the relevance labels above.

---

## 2. Code-grounding map (verified against source, 2026-08-05, `0385ae1`)

| GoA mechanism | amicus today | Gap |
|---|---|---|
| Node sampling (query-aware selection) | Benches are **static** alias lists — `src/utils/council-presets.js` (`free`/`budget`/`frontier`); user councils in config. Nothing selects per-prompt. | GOA-1 |
| Model cards | Catalog cache keeps only `{id, name, contextLength, pricing}` — `src/utils/model-fetcher.js:42-48` **drops OpenRouter's `description` at fetch time** (same response, zero extra network to keep it). | GOA-1 enabling change |
| Edge sampling (peer score matrix) | **Already collected**: Stage-2 judges rank all reviews (`council/briefings-stage2.js` Task A) → `computeStreetCred()` mean ranks, `src/council/tally.js:49`. But the signal is *descriptive only* — tiers come from **unweighted** agree/dispute counts (`tally.js:84-107`), and nothing prunes or weights with it. | GOA-2 |
| Relevance labels in prompts | Chair packet presents seats symmetrically; `ANTI_SYCOPHANCY_CLAUSE` exists (`council/briefings.js`) but no per-seat calibration. | GOA-2 |
| Directed message passing | Debate (`council/run-debate.js`) is adversarial + finding-scoped (defense solos, re-vote wave on Contested/Disputed). No consensus-building review-refinement stage. | not backlogged (§4) |
| Graph pooling (max = skip synthesis) | Chair always runs; fallback is another chair (`council/run-chair.js` `pickFallbackChair`). No zero-cost terminal fallback. | not backlogged (§4) |
| Confidence backstop | `utils/no-output-backstop.js` (transport-level) + `sidecar/fallback-chains.js` (fanout legs) exist; findings contract (`council/findings.js`) has **no confidence field**; conformance repair is retry-same-model, never substitute. | GOA-3 |
| Cross-run memory | **amicus exceeds the paper**: `council/ledger.js` aggregates lifetime confirmRate / factErrorRate / avgStreetCredPeersOnly / conformance per model (`deriveReliability`, `lowN = runs < 3` at `ledger.js:78`). The paper is stateless. Nothing feeds it back into selection. | GOA-1/5/6/7 |
| Self-exclusion / anonymity in peer scoring | **amicus exceeds the paper**: blind labels (`council/anonymize.js`, `workspace/blind-mode.js`) + peers-only street-cred. Keep both when adopting weighting. | — |
| Duplicate seats (Self-MoA) | `parseModelsList` allows duplicates (`src/sidecar/fanout-validate.js:22-25`), but ledger/runStats **join by model string** (`ledger.js:24-29`, `run-debate.js:135-137`) — duplicates would collide. | not backlogged (§4) |

---

## 3. The eight backlogged items (rationale digest — actionable entries live in BACKLOG.md)

- **GOA-1 auto-bench** — the paper's headline economics (3 right seats > 6 static, ~1/3 tokens).
  Meta-LLM picks k seats from model cards; amicus-only upgrade: blend `deriveReliability()` rows
  into the picker (a learned router from data amicus already writes — the thing the paper's
  related work says DyLAN needs extra optimization for). Composes with `--max-cost` preflight.
- **GOA-2 relevance-weighted chair packet** — reuse the street-cred amicus already computes as
  the paper's high/moderate/low labels in the chair packet (+ optional weighted tally variant,
  schema-versioned). Their A_ij=1 ablation is the evidence. **Never silently τ-prune findings** —
  a minority-raised blocker is what the tier system + debate exist to protect. Weight the chair's
  attention, don't delete evidence.
- **GOA-3 per-finding confidence field** — additive contract field; feeds `thin/solid` and, more
  valuably, seat-level substitution: chronic low-confidence + `unstructured` conformance →
  fallback-chain swap instead of paying blind repair solos.
- **GOA-4 report/workspace relevance surface** — the paper's Table 2 as a per-run artifact:
  street-cred-ordered seat rail with relevance badges, and an efficiency panel (calls/tokens/cost
  vs. what the full static bench would have cost) from data already in tally/spend ledger.
- **GOA-5 scout seat** — exploration mechanism for auto-bench; see §5.
- **GOA-6 lowN = prior-vs-evidence** — below 3 runs the ledger is advisory, never a veto; see §5.
- **GOA-7 ledger keyed by resolved model + recency decay** — prerequisite fixes a **live defect**
  independent of everything else; see §5.
- **GOA-8 shadow seat** — zero-risk audition variant; see §5.

Dependencies: GOA-5/6/8 presuppose GOA-1 (no selection ⇒ no exploration problem). GOA-7's
prerequisite and GOA-2/3/4 are independent of GOA-1.

---

## 4. Considered, NOT backlogged (2026-08-05) — recorded so the reasoning isn't re-derived

Not rejected — just not queued. Evidence retained here for revival:

1. **Max-pool verdict mode (`--pool max`) / chair-free short-circuit.** Promote the top
   street-cred seat's review as the verdict surface, zero chair call. GoA-Max was their best
   average config. Two shapes: explicit mode for budget/free benches (free-tier models make poor
   chairs), and a **third fallback rung** in `run-chair.js` when chair + fallback chair both die
   (today that ends chairless). Risk that kept it out: max-pooling discards minority-correct
   answers — it must replace *chair synthesis only*, never the findings table.
2. **Cascade refinement stage** (the paper's directed message passing as a council stage).
   Between Stage 1 and Stage 2: low-ranked seats revise their reviews given high-ranked reviews
   (relevance-labeled), then top seats finalize seeing the revisions. Complementary to debate
   (consensus-building + review-scoped vs adversarial + finding-scoped), cheaper (no per-finding
   defense solos), applicable when nothing is contested. Evidence: fixed-node HumanEval
   85.98 vs Debate 71.95; the direction ablation says the strong→weak-then-back order is
   load-bearing. Natural home: a `run-debate-stage.js`-pattern sibling with briefings in the
   `briefings-debate.js` style.
3. **First-class self-ensemble seats** (Self-MoA). Duplicate seats differentiated by lens briefs
   (`skills/second-opinion/SEAT-BRIEFS.md`), e.g. same frontier model under security/perf lenses;
   auto-bench allowed to pick duplicates when the ledger says one model dominates. **Blocker to
   design first: seat-id ≠ model-id** — `ledger.js` `buildLedgerRows` and `run-assemble.js` key
   rows by model string, so duplicates collide today (GOA-7's re-keying is the natural moment to
   introduce a seat identity).

---

## 5. Exploration policy — the cold-start discussion behind GOA-5/6/7/8

**The question (Christian):** does ledger-driven selection have a low-run-count threshold, and
would it entrench proven models so new models never get analyzed?

**Facts:** today nothing selects models at all (static benches), so the risk is created by GOA-1,
not present in v4.6.x. The only related constant is `lowN = runs < 3` (`ledger.js:78`) — a
display flag, not a gate. New models still enter the *catalog* on refresh; they'd sit unselectable
under a naive greedy picker. The entrenchment loop is real: never seated ⇒ no ledger rows ⇒ never
seated; and an early unlucky streak buries a good model permanently.

**Why councils make exploration unusually cheap** (the design insight that shapes all four items):
in a classic bandit, trying the unknown option *is* your answer — exploration risks quality. In a
council, a rookie seat's output is peer-ranked, adjudicated, and tier-contained; a bad review gets
disputed down and earns a low street-cred rank — **which is exactly the evaluation data wanted,
produced as a byproduct, while the other seats protect the verdict**. Marginal cost of exploration
is one leg's tokens, not correctness. So the design question is "how do we budget exploration,"
not "how do we avoid it."

**Mechanisms** (in build order):
1. **Scout seat (GOA-5).** k−1 seats on merit + one rotating seat for an under-sampled
   domain-matching model (`lowN` first, then never-benched catalog entries). Configurable rate
   (`council.exploreRate`-style; a scout every Nth run); `--bench auto:frozen` disables for
   reproducible/spend-sensitive runs. Structural guarantee: every candidate reaches the 3-run
   graduation in bounded time.
2. **lowN as prior-vs-evidence switch (GOA-6).** Below 3 runs, ledger silent/advisory → selection
   falls back to model cards (exactly the paper's proven stateless config). Optional Bayesian
   shrinkage toward the vendor-family/tier prior (`curated-models.js` / `model-tiers.js`) so new
   models start at "presumed as good as their siblings," not zero. ⚠️ Prompt the picker explicitly
   that "runs: 0 — untested" is neutral-to-positive; an LLM picker left uninstructed reads missing
   data as risk.
3. **Recency decay + resolved-id keying (GOA-7).** Decay (or last-K window) lets stale evidence
   fade — drift handling + a path back for improved models. **Prerequisite and live defect:**
   ledger rows key by council ALIAS (`run-debate.js:135-137` states it verbatim), and aliases
   silently retarget — `council-presets.js` documents `gpt-pro` re-pinned to `gpt-5.6-sol-pro`
   and `opus` re-pinned, both 2026-08-04 — so an alias's history **conflates different underlying
   models** in `council stats` today. Fix: record the resolved executable id on each row
   (additive, schema-versioned; the ledger's append-only schema was deliberately NOT extended by
   review F3 — see `tally.js:117-124` — so this needs the schema-version bump done properly, not
   a drive-by field). A retarget then naturally resets the alias to `lowN` ⇒ scout treatment.
4. **UCB-style bonus** if selection ever goes numeric: score + c·sqrt(ln N_total / n_model).
   With an LLM picker, mechanisms 1–2 approximate it; don't build this first.
5. **Shadow seat (GOA-8)** for zero-variance users: rookie review included in the anonymized
   Stage-2 bundle (judges can't tell — blind labels), so it earns rankings/ledger rows, but its
   adjudication votes are excluded from tier bases and its findings marked advisory. Costs one leg
   + slightly larger judge bundles; zero influence on the verdict. Cheap tier: scout only on
   free/budget benches (`utils/free-models.js` — auditioning free models is literally free).

**Safe floor:** cards-only selection (no ledger term) is the paper's exact, proven configuration.
Ledger empty/unreadable must never block auto-bench — degrade to cards-only via the existing
degrade channels, and ultimately to the static bench.

---

## 6. Honest limits — do not overclaim when implementing

- **Domain transfer.** The paper's evidence is short-answer QA with 7–8B open models (plus a
  gpt-4o replication); amicus councils do long-form code review with frontier models. Direction
  and weighting effects plausibly transfer; **the constants (k=3, τ=0.05, 0.7/0.4 label cuts) do
  not** — validate via `evals/` before defaulting anything on.
- **Max-pool discards minority-correct answers.** Their case study works because the majority was
  right. The tier cascade (`assignTier` Singleton/Contested/Confirmed-thin) deliberately protects
  lone findings — any weighting/pooling must never suppress the findings table.
- **Peer scoring rewards confident fluency.** amicus already mitigates better than the paper
  (blind labels + peers-only street-cred vs their self-exclusion only). Keep both; extend the
  anti-sycophancy clause with per-seat calibration rather than replacing it.
- **Cost accounting.** Node sampling = one cheap meta-call (+ cached card summaries). Edge
  scoring = already paid — Stage-2 rankings ARE the score matrix; GOA-2 adds ~zero marginal
  spend. The scout/shadow seats are the only items that add legs, and both are rate-bounded.

## 7. Suggested sequencing

1. **GOA-7 prerequisite** (resolved-id on ledger rows) — independent, fixes the live `council
   stats` conflation, and unblocks seat-identity for future self-ensemble.
2. **GOA-2 + GOA-4** — cheap, reuse existing signals, no selection risk, immediately visible.
3. **GOA-3** — contract + parser + substitution wiring.
4. **GOA-1** — catalog `description` retention → cards → picker → degrade path (cards-only →
   static bench).
5. **GOA-6 → GOA-5 → GOA-8** — the exploration stack, in that order, on top of GOA-1.
