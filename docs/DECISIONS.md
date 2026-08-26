# Safety decisions

These implementation hardenings clarify the locked brief where a literal reading could weaken the
product's claim. They do not change the product idea.

## D-001 — Safe integers, checked operations

All JSON paise values use `Number.isSafeInteger`, and every addition/subtraction is checked. Decimal
strings are parsed through `BigInt` and range-checked before conversion. `Number.isInteger` alone is
insufficient above JavaScript's exact integer range.

## D-002 — Never deduplicate by financial content alone

Every physical occurrence is retained. Idempotency applies only to a repeated complete-file hash or
the same stable provider/bank record ID. Two distinct occurrences with identical visible content may
be two real credits and therefore remain evidence—often ambiguous evidence.

## D-003 — Exact UTR still requires one-to-one uniqueness

Trimmed, ASCII-case-normalized UTR equality is strong evidence, but duplicates on either side prevent
automatic commitment. Exact UTR with unequal money becomes a quarantined discrepancy.

## D-004 — Accept only globally forced edges

A chosen maximum matching is not proof. For a component with maximum cardinality `k`, edge `e` is
accepted only when `maximumMatchingSize(G − e) < k`. Every other maximum-compatible edge remains
ambiguous, including cases where one endpoint can be unmatched in an alternative optimum.

## D-005 — Preserve three status dimensions

`bank_status`, `ledger_status` and `review_status` are independent. Overall `VERIFIED` requires an
exact or verifier-assisted zero-residual bank pair plus all in-scope merchant checks. “Bank matched”
is never silently promoted to “three-source proved.”

## D-006 — AI must identify verifiable source evidence

For the MVP, an auto-resolution-capable AI proposal is limited to a literal narration span plus an
allowlisted UTR transformation. Code confirms the span exists, applies the transform itself, checks
group UTR consistency, amount, INR and posting window, then reruns global uniqueness. Compatibility
without identity evidence remains a human suggestion.

## D-007 — Artifacts and measurements are separate

Canonical decisions contain no runtime, live latency, current timestamps or provider cost.
Performance and live-capture provenance use a separate envelope so same inputs can remain
byte-identical while measured runs remain truthful.

## D-008 — MVP bank input is settlement-credit scoped

The supported bank CSV contains candidate settlement credits. Ordinary account debits are out of the
declared export scope rather than mislabeled invalid. Expanding to complete statements requires an
explicit `OUT_OF_SCOPE` coverage state before schema freeze.

## D-009 — Freeze before held-out generation

Solver, corruption distribution, metric formulas, AI eligibility, prompt/schema, provider/model and
evaluator freeze together. Only then is held-out data generated and run once without inspection in
the middle. A later bug correction preserves both reports.
