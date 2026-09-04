# 01 — BUILD BRIEF (locked 2026-08-25) — the one file Codex follows

Domain authority: `docs/00-DOMAIN.md` (v2, frozen). Any NEW Razorpay fact must be added there with
[V]/[S] marking BEFORE code uses it. Public product name: **Vouch**. Folder stays `TALLY`.
Deadline: official 2026-09-05; internal submit 2026-09-04 evening. Feature freeze 2026-09-02 noon.

## 1. Product definition

Vouch is a three-source settlement verification agent: it proves every paise of a merchant's bank
credits against Razorpay's recon records and the merchant's own books — deterministically — and
uses AI only to propose typed hypotheses that deterministic code verifies or rejects. Everything
unprovable is honestly escalated.

Tagline (must be literally true and testable): **"AI proposes. The verifier proves. Every paise is
explained — or honestly escalated."**

### Non-negotiable principles

1. **Integer paise everywhere.** No float ever touches money. Hand-written decimal-string parser
   (Indian comma grouping `1,23,456.78` accepted; >2 decimals rejected, never rounded). JSON money
   fields validated with `Number.isInteger`.
2. **Zero-residual, no tolerance.** Accepted matches close at exactly 0 paise, always — including
   AI-assisted ones. There is no tolerance constant anywhere in the codebase.
3. **AI authority boundary.** The model can only emit typed hypotheses from an allowlist. A
   verified hypothesis does NOT create a match — it adds a candidate edge, and the normal global
   matcher + uniqueness check re-run and decide (this prevents the AI path from bypassing
   ambiguity detection). The model never computes, never sets status, never touches a row.
4. **Determinism.** Same inputs → byte-identical run artifact (fixed seeds, sorted iteration,
   pinned model replay cache, injected clock — `Date.now()` forbidden in core). Row-order shuffle
   test must produce identical output.
5. **Completeness invariant.** After a run, every input row and every bank line is in exactly one
   terminal state. Nothing is silently dropped; the run artifact partition-counts must sum to the
   input counts. This is a test.
6. **Deterministic/AI boundary rule** (defends "you sandbagged the baseline"): anything expressible
   as a total function with tests (case/space normalization, known prefixes, bounded truncation)
   belongs to the deterministic engine; only open-text interpretation (narration semantics, unknown
   column mapping) is AI scope.

## 2. Stack and repo layout

TypeScript strict, Node 20+, pnpm workspace, Vitest, Zod. **No server, no database.** MIT license.

```
packages/core/        pure TS library — ingest, money, normalize, group, match, verify,
                      investigate (AI adapter), exceptions, audit. NO I/O, NO Date.now, NO fetch
                      (model client injected). No import path to truth manifest (enforced by test).
packages/cli/         commands: generate, run, eval, report. All file I/O lives here.
packages/generator/   synthetic world + corruption layer + truth manifest writer.
packages/eval/        ONLY reader of truth manifests. Metrics + report emitter.
apps/web/             Vite React SPA, client-side only. Consumes a run artifact JSON.
data/fixtures/        verbatim official-doc sample responses (recon, payment entity).
data/dev/  data/heldout/   generated batches. Held-out frozen by SHA-256 committed in eval report.
docs/                 00-DOMAIN, 01-BUILD-BRIEF, ARCHITECTURE, METHODOLOGY, QUESTIONS, DECISIONS.
```

Run artifact = one JSON: inputs (hashes), config, per-settlement evidence (equation, rows, state),
exceptions, hypotheses+verdicts, audit events, metrics. The UI renders artifacts; the CLI produces
them. This decoupling is the UI risk-containment: if the SPA slips, CLI + a static HTML report is
the pre-agreed fallback and the video still works.

## 3. Pipeline (stages and exact algorithms)

**S1 Ingest/validate** — Zod schemas tolerant of nullable/extra fields (recon `payment_id` null on
payments; `credit_type` absent on adjustments; `notes` object|string|null). Money → integer paise.
Currency must be INR (else INVALID_INPUT exception, planted). Timestamps: epoch ints; ALL date
logic in Asia/Kolkata via one tested `epochToISTDate()` — never machine-local. Every raw row gets
SHA-256 hash; duplicate hashes within a source → dedupe + DUPLICATE_* exception. Malformed money →
reject row into INVALID_INPUT, never guess. Pagination unsupported → explicit error.

**S2 Settlement grouping** — group recon rows by `settlement_id`;
`calculated = Σ(credit − debit)`. Three-level conservation:
- L1 row: per-type sanity (payment rows credit>0/debit=0; refunds/disputes debit>0; adjustments
  either). Generator-world invariant `credit = amount − fee` for payments is checked and flagged
  as INVALID_INPUT if broken [S — our synthetic world's rule, warn-only on foreign data].
- L2 group: if a settlement entity amount is provided, it must equal calculated (else exception).
- L3 bank: bank credit must equal calculated exactly (residual 0).

**S3 Exact bank matching (staged commitment)** — normalized-exact UTR equality (trim/case only)
AND exact amount+currency ⇒ commit EXACT_MATCH. UTR matches but amount differs ⇒
**SHORT_CREDIT / EXCESS_CREDIT** exception with ₹ impact (the most money-critical class — "bank
credited ₹3,898.02 against ₹3,898.52"). Committed pairs leave the pool.

**S4 Global fallback matching** — for survivors: candidate edges under HARD constraints (exact
amount+currency, posting window = `[settled_at_IST, settled_at_IST + POSTING_WINDOW_DAYS]`,
calendar days, config constant, default 3 — no working-day/holiday logic in V1). Conservative UTR
normalization (documented total functions: case, spaces, known bank prefixes, bounded truncation
≥10 chars) may ADD edges. Then **maximum bipartite matching** (simple augmenting paths; n ≤ ~40).

**S5 Uniqueness/ambiguity** — for each matched edge: remove it, re-run matching; if an equal-size
matching exists assigning that bank line differently ⇒ both parties AMBIGUOUS (never guess).
Unmatched leftovers ⇒ MISSING_BANK_ENTRY (settlement with no credit — the "did the money actually
arrive" headline) or UNKNOWN_BANK_CREDIT (credit with no settlement).

**S6 Merchant-ledger cross-check** — by reference: set-difference both directions
(MISSING_MERCHANT_LEDGER_RECORD / MISSING_RAZORPAY_ROW) + exact amount equality
(LEDGER_AMOUNT_MISMATCH). Cross-cycle refund needs NO special solver logic: the refund debit is a
member of this cycle's settlement via its settlement_id; the evidence view links its `payment_id`
to the prior-settled payment — it's an explanation beat, not an algorithm.

**S7 AI investigation** — only for unresolved cases. See §5.

**S8 Human review** — single action: mark-resolved-with-note ⇒ MANUALLY_RESOLVED + audit event.

Terminal states: `EXACT_MATCH · VERIFIED_ASSISTED_MATCH · AMBIGUOUS · UNMATCHED · INVALID_INPUT ·
MANUALLY_RESOLVED`.

## 4. Exception taxonomy (final)

`SHORT_CREDIT` `EXCESS_CREDIT` `MISSING_BANK_ENTRY` `UNKNOWN_BANK_CREDIT` `DUPLICATE_BANK_ENTRY`
`DUPLICATE_IMPORT` `GROUP_SUM_MISMATCH` `MISSING_RAZORPAY_ROW` `MISSING_MERCHANT_LEDGER_RECORD`
`LEDGER_AMOUNT_MISMATCH` `CURRENCY_MISMATCH` `MALFORMED_AMOUNT` `AMBIGUOUS_CANDIDATES`
`UTR_CONFLICT` `HYPOTHESIS_REJECTED` `INSUFFICIENT_EVIDENCE`
Every exception carries: evidence rows (hashes), exact arithmetic, ₹ impact, suggested next action,
state history.

## 5. AI layer contract

- Provider-neutral adapter; three modes: **`replay`** (default — committed response cache keyed by
  SHA-256(model, prompt); cache miss = hard error, no silent live call), **`live`** (dev + final
  held-out run only), **`off`** (outage demo: deterministic results unchanged, cases stay queued).
- Key fallback chain if billing fails (real Indian-card risk): Anthropic → OpenAI → **Gemini free
  tier** (no billing needed — the safety net). Keys only in `.env.local`; `.env.example` committed.
- Strict JSON out (Codex's §11 schema, `schema_version: "1"`); allowlisted `hypothesis_type`;
  `requested_tests` from a registry of deterministic verifiers only: `NORMALIZED_UTR_MATCH`,
  `EXACT_AMOUNT_MATCH`, `POSTING_WINDOW_MATCH`, `DUPLICATE_HASH_MATCH`, `LEDGER_PRESENCE_CHECK`.
  All requested tests pass ⇒ hypothesis is VERIFIED ⇒ **adds a candidate edge only** ⇒ S4/S5
  re-run decide. Any failure ⇒ HYPOTHESIS_REJECTED with the failing arithmetic shown.
- Caps: ≤2 calls per exception, token+time limits, malformed JSON ignored (counted), timeout ⇒
  deterministic state unchanged. Candidate IDs not present in the input universe are discarded
  (invented-ID test). Narration is DATA: prompt-injection fixture must remain inert.
- Because replay cache is committed: **judges run the full demo with zero API keys.**

## 6. Synthetic generator

Layered: ground-truth world (merchant ledger → settlement groups → bank credits) → projection into
official-shaped files → independent corruption layer → truth manifest (eval-only). Volumes: ≥500
recon rows, 15–30 settlements, 20–40 bank lines, ≥20 planted exceptions across dev/demo/held-out;
held-out uses a **different seed AND different corruption-mix frequencies**.

**P0 cases (demo-critical, build first):** clean matches (bulk) · full+partial refund · cross-cycle
refund · SHORT_CREDIT (one-paise AND ₹0.50 variants) · MISSING_BANK_ENTRY · duplicate bank entry ·
same-amount-same-day ambiguity pair · case/space UTR variant · truncated/prefixed UTR · missing UTR
with narration containing embedded reference · prompt-injection narration · fee/tax golden case ·
adjustment credit+debit · currency mismatch · malformed amount · Indian comma format.
**P1 (metrics breadth):** duplicate import · delayed weekend posting · UTR normalization collision
· missing merchant record both directions · ledger amount mismatch · sign confusion.
**P2 (only if green):** transfers · second bank format · partial settlement carry-over.
The pitch needs P0 only. Do not let P1/P2 block the milestone.

## 7. Evaluation protocol (pre-registered — write `eval/METRICS.md` BEFORE the held-out run)

Configs: **baseline** (raw exact UTR only) vs **deterministic** (S1–S6) vs **hybrid** (+S7 replay).
Formulas fixed in advance: settlement-level exact-match rate; auto-resolution coverage; **false
automatic match rate** (headline: of auto-accepted matches, fraction disagreeing with truth —
target 0, claim only if measured 0); abstention correctness (of AMBIGUOUS/UNMATCHED, fraction truth
says were genuinely undecidable vs solver misses); exception precision/recall by category;
unexplained paise; rows/sec; p50/p95 runtime; model calls, latency, cost, malformed rate;
hybrid-with-`off` must equal deterministic (identity check).
Pre-registered prediction: deterministic ≈ hybrid except on messy-evidence cases, where hybrid adds
+N settlements (that is the designed value of AI, stated up front, nobody panics at eval time).
**Freeze rules:** held-out SHA-256 committed before first hybrid run; results reported as-is;
re-rolling the dataset after freeze is forbidden; post-freeze bug ⇒ fix, re-run, report BOTH runs
in an appendix. Eval is the only truth-manifest reader — enforced by a dependency test in CI.

## 8. Tests (must-have set)

Golden fee/tax (fee+tax double-count yields plausible wrong residual; only fee closes to 0) ·
paise parser (commas, precision rejection) · official fixtures parse (incl. inconsistent `notes`) ·
IST date conversion · shuffle-invariance · duplicate-import idempotence · conservation L1/L2/L3 ·
one-paise stays exception · ambiguity always abstains · uniqueness check correctness · completeness
invariant · replay determinism (byte-identical artifacts) · malformed/timeout/invented-ID/injection
AI cases (canned) · no-truth-import dependency test · source-row immutability · manual-resolution
audit event · CSV formula-escape on export.

## 9. UI (P1, not P0)

Two views, client-side, artifact-driven: **Run+Evidence** (load three files or a bundled artifact,
run in-browser via core with bundled replay cache, expand any bank credit → full paise equation,
rows, UTR evidence, ledger refs, residual 0) and **Exceptions** (queue: reason, evidence,
hypothesis, verdict, mark-resolved-with-note). Eval output = generated static report, not a view.
Audit report downloadable. Fallback if slipping: CLI + static HTML report (pre-agreed, not a
failure).

## 10. Deliverables and definition of done

- Public GitHub repo (name `vouch`), MIT, README quickstart: **fresh clone → 3 commands → full
  offline demo, zero API keys** (`pnpm i && pnpm demo` running CLI on the sealed batch with replay
  cache). Verified on a fresh clone before submit.
- `ARCHITECTURE.md` (diagram, authority boundary, why-no-tolerance, why-membership-is-given),
  eval report with dataset hashes + honest limitations, `METHODOLOGY.md` (honest AI-assisted build
  story: two frontier models adversarially cross-reviewing, all corrections verified against
  official docs — for an AI-Builder hiring filter this is a strength, not a confession),
  `QUESTIONS.md` (running panel-prep: every hard question + Vinay's own-words answer),
  `DECISIONS.md` (dated log; the fee/tax and membership corrections are entries 1 and 2).
- 5-minute video per Codex §18 script; sealed-batch hash shown on screen matching the committed
  hash; rough cut Sep 2 evening, final Sep 3.
- Submit internal deadline **Sep 4 evening**.

## 11. Calendar, gates, cut order

> **Outcome note (2026-09-04):** This calendar records the original plan, not completed claims.
> The held-out milestone was deferred because the one-shot harness was not completed before the
> deadline. Vouch reports the committed synthetic development benchmark honestly and makes no
> held-out or production-accuracy claim.

- **Aug 25 eve**: repo init+push, workspace scaffold, money module + golden fee/tax test green.
- **Aug 26**: schemas+fixtures, ingest, generator v1 (clean world + manifest).
- **Aug 27**: grouping + conservation, exact-UTR matching, evidence assembly, CLI artifact.
- **Aug 28**: global matcher + uniqueness, generator v2 (P0 cases). **GATE (72h): seeded 100+ row
  batch → clean rows EXACT_MATCH at residual 0, planted ambiguity → AMBIGUOUS, one-paise →
  exception, zero crashes.** Miss ⇒ cut degraded-subset mode AND web UI same day.
- **Aug 29**: ledger cross-check, exception queue, eval baseline+deterministic.
- **Aug 30**: AI adapter, verifier registry, replay cache, canned adversarial tests.
- **Aug 31**: live model on dev set, prompt tuning, hybrid eval, held-out generated+frozen (hash).
- **Sep 1**: web UI on artifact; audit export.
- **Sep 2**: **noon freeze** → held-out run → report → rough video cut → README/ARCHITECTURE.
- **Sep 3**: final video, docs, METHODOLOGY/QUESTIONS, fresh-clone reproduce test.
- **Sep 4**: buffer only; submit evening. Sep 5: margin, nothing planned.

Cut order when (not if) something slips: degraded-subset mode → web UI (→ static report) → P2
cases → P1 tail. NEVER cut: golden tests, held-out eval, audit trail, video, docs.
Nightly: Vinay explain-back; gaps become next-morning teaching blocks; QUESTIONS.md grows daily.

## 12. Don'ts

No DB, no server, no auth, no deploy dependency for the demo. No `Date.now()`/`Math.random()` in
core (inject clock/seed). No float money, no rounding helpers. No tolerance constants. No live
model calls in demo path. No new Razorpay claims outside 00-DOMAIN.md. No re-rolling frozen
datasets. No "production-ready/bank-grade" language anywhere — synthetic
benchmark, labelled as such.
