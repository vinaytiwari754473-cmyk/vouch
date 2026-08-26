# Vouch synthetic-benchmark metric preregistration

Status: **must be frozen before any held-out bundle is generated, inspected, or scored**.

This document fixes the evaluation units, denominators, formulas, comparison configurations, and
reporting rules in advance. A post-freeze correction creates a new version and keeps the original
run in the report appendix. It never replaces or silently edits the first result.

## Scope and non-claims

The evaluation is a sealed **synthetic stress benchmark**. Its aggregate rates describe only the
committed generated cases. The corruption mix is not an estimate of real merchant prevalence, the
results are not production accuracy, and associated rupee amounts are not merchant savings or
financial loss.

Settlement membership is supplied by Razorpay-shaped `settlement_id` fields. Vouch does not score
transaction-membership discovery as an achievement. The scored tasks are bank-to-settlement
verification, merchant-ledger cross-checking, safe abstention, and exception detection.

Manual resolutions are excluded from every automatic metric and reported as a separate count.

## Frozen configurations

All configurations receive the same public inputs and use the same validated settlement groups.

1. **Baseline** — non-empty literal raw UTR equality, exact integer amount, exact currency, and
   one-to-one evidence. It performs no trimming, case folding, extraction, fuzzy matching, or AI.
   Duplicate candidate endpoints are not committed.
2. **Deterministic** — the frozen deterministic ingest, verification, candidate, global matching,
   uniqueness, and ledger rules.
3. **Hybrid** — deterministic plus the frozen AI hypothesis path. Code-selected mandatory tests
   verify every candidate before the global matcher and uniqueness test rerun.
4. **Off ablation** — the hybrid application with the model disabled. Its canonical decision
   projection must be byte-identical to deterministic output.

The official hybrid run pins one provider, exact model ID, prompt hash, schema, decoding settings,
and eligibility rule. Provider fallback is not allowed during the official run. A provider failure
is reported as an outage.

## Independent truth model

For every settlement `s`, the truth manifest contains:

```text
true_bank(s)       = bank row ID or null
expected_paise(s)  = independent oracle settlement amount, or null only when INVALID
evidence_class(s)  = UNIQUE | AMBIGUOUS | ABSENT | INVALID
ledger_truth(s)    = VERIFIED | EXCEPTION | NOT_APPLICABLE
```

`AMBIGUOUS` is determined from the evidence visible in the public inputs. It remains ambiguous even
when the generator knows the latent real-world pairing. Accidentally selecting that latent pair is
therefore a false automatic verification, not a lucky success.

An automatically verified decision is correct only when all of these are true:

- truth evidence class is `UNIQUE`;
- the predicted bank row equals `true_bank(s)`;
- the evaluator independently recomputes `truth_bank_credit - expected_paise(s)` as exactly zero;
- the artifact residual equals that independently-computed zero;
- no hard invariant failed;
- the merchant-ledger result matches `ledger_truth(s)`; and
- `ledger_truth(s)` is not `EXCEPTION`.

`EXACT_MATCH` and `VERIFIED_ASSISTED_MATCH` are automatic statuses. `AMBIGUOUS`, `UNMATCHED`, and
`MANUALLY_RESOLVED` are deferred statuses for automatic-evaluation purposes. Manual resolutions are
also reported as their own count and are never automatic.

Every truth settlement must have exactly one predicted terminal decision. Extra and missing
decisions fail scoring instead of disappearing from a denominator.

## Primary ratios

Let:

- `A` = all automatically verified decisions;
- `C` = correct decisions in `A` under the complete definition above;
- `V` = all non-`INVALID` truth settlements;
- `U` = truth settlements that are `UNIQUE`, have a bank row, and have ledger truth `VERIFIED` or
  `NOT_APPLICABLE`;
- `D` = all predicted deferred decisions;
- `D_safe` = decisions in `D` whose truth is not in `U`.

The report prints every numerator and denominator; a zero denominator is `N/A`, never `0%`.

```text
false automatic verification rate = (|A| - |C|) / |A|
automatic verification precision  = |C| / |A|
unique-case recall                 = |C| / |U|
automatic coverage                 = automatic decisions on V / |V|
safe-abstention precision          = |D_safe| / |D|
false-abstention rate              = deferred decisions on U / |U|
ambiguity precision                = predicted AMBIGUOUS and truth AMBIGUOUS
                                     / predicted AMBIGUOUS
ambiguity recall                   = predicted AMBIGUOUS and truth AMBIGUOUS
                                     / truth AMBIGUOUS
missing-bank precision             = predicted UNMATCHED and truth ABSENT
                                     / predicted UNMATCHED
missing-bank recall                = predicted UNMATCHED and truth ABSENT
                                     / truth ABSENT
```

The headline safety metric is **false automatic verification rate**. If it is observed as `0/N`,
the report must show `0/N` plus the upper endpoint of the two-sided Wilson 95% interval. It must not
turn a finite synthetic observation into a universal “zero-risk” claim.

## Exception metrics

Truth and predicted exceptions are multi-label sets keyed exactly by:

```text
(category, primary_occurrence_id, related_occurrence_id_or_null)
```

There is no fuzzy matching of exception labels or entities.

```text
exception precision = |predicted exceptions ∩ truth exceptions| / |predicted exceptions|
exception recall    = |predicted exceptions ∩ truth exceptions| / |truth exceptions|
```

The same formulas are reported per category. A category with truth support and no predictions has
recall zero and precision `N/A`. The report includes exact counts and a micro aggregate. Challenge
results are also shown per corruption category; an unweighted macro challenge score may be shown,
but no frequency-weighted aggregate is described as real-world prevalence.

## Money totals

Positive and negative errors must never cancel. These totals stay separate and are emitted as
decimal integer paise strings:

```text
accepted absolute residual = Σ |accepted bank amount - settlement calculation|
short-credit paise         = Σ SHORT_CREDIT impact
excess-credit paise        = Σ EXCESS_CREDIT impact
missing-settlement paise   = Σ MISSING_BANK_ENTRY impact
unknown-bank-credit paise  = Σ UNKNOWN_BANK_CREDIT impact
```

Accepted absolute residual must be zero. Ledger-associated amounts are control exposure, not cash
loss, and are not added to these totals. Predicted and independent-truth totals are printed side by
side. The five values are never collapsed into “money saved.”

## AI comparison

AI eligibility is a deterministic, committed list or rule frozen before the held-out data exists.
Let `E` be those eligible settlement IDs.

```text
AI resolution lift =
  (correct hybrid resolutions in E - correct deterministic resolutions in E) / |E|

new AI false automatic verifications =
  hybrid false-automatic settlement IDs absent from deterministic false-automatic IDs

net false-verification delta = hybrid false count - deterministic false count
```

All three counts are reported even when lift is positive. Malformed-output rate is invalid-schema
responses divided by completed responses. Timeout rate is timed-out calls divided by attempted
calls. Replay latency and replay cost are `N/A`; latency, token counts, and cost belong to the
original one-shot live capture and retain its provenance.

## Runtime protocol

Performance measurements are stored in a separate envelope keyed to the canonical decision
artifact SHA-256. Timing and current timestamps are never placed in the deterministic artifact.

- Rows = all Razorpay, bank, and merchant-ledger occurrences, including invalid occurrences.
- Five warm-up runs precede thirty measured runs.
- The same frozen machine, Node version, and input bundle are used for every configuration.
- Runtime begins after file bytes are available and includes parse, validation, grouping, matching,
  ledger verification, exception assembly, and canonical decision creation.
- Report median rows/second and nearest-rank p95 runtime.
- Live model latency is separate from core throughput.

The report records OS, architecture, CPU label, Node version, warm-up count, measured count, row
count, raw timing samples, median, and p95.

## Held-out freeze and reporting protocol

Before held-out generation, commit and hash:

- solver and deterministic configuration;
- generator and corruption mix;
- evaluator and this document;
- AI eligibility rule;
- model provider, model ID, prompt, schema, and decoding settings; and
- replay-capture code.

Only after that freeze may one uninterrupted command generate the held-out inputs, execute
baseline/deterministic/hybrid, capture the live model responses, score all outputs, and reveal the
truth report. No person inspects or tunes against held-out inputs or truth between these steps.

The bundle records separate SHA-256 hashes for public inputs and the truth manifest, plus a bundle
hash binding both hashes to provenance. The report includes dataset ID, seed commitment, freeze
commit, generator/solver/evaluator commits, metrics hash, prompt hash, model identity, and model
configuration hash.

If a post-freeze bug is found, preserve the first report, make a new commit, rerun the exact same
bundle, and publish both results with an explanation. Never regenerate the held-out dataset to
improve a score.
