# Methodology

## What was built

Vouch is an evidence verifier for a narrow accounting question: does a Razorpay settlement,
the corresponding bank occurrence, and the merchant ledger agree exactly? It does not use a
language model as an accountant. The model may propose a typed claim about a literal source span;
deterministic code independently checks that claim before it can become a candidate graph edge.

The build started from a frozen domain note and brief. The implementation order followed the
authority boundary: exact paise arithmetic, ingestion and row identity, settlement equations,
one-to-one matching, merchant-ledger checks, exception records, the AI verifier, evaluation, and
only then the interface.

## AI-assisted build story

Vinay used Claude and Codex as adversarial collaborators, not as sources of financial truth.
Claude helped challenge and refine the product thesis and build brief. Codex implemented the
repository, generated the sealed synthetic corpus, exercised the invariants, and integrated the
evidence interface. Every accepted behavior is represented in executable code and tests; prose
from either model has no runtime authority.

This process produced concrete corrections:

1. Razorpay `fee` is treated as already including its tax component. Subtracting `fee + tax`
   twice is preserved as a golden negative test because it produces a plausible but wrong result.
2. Settlement membership is supplied by the recon evidence. The solver never invents membership
   by choosing the rows that make an amount close.
3. Global matching replaced greedy selection. An edge is automatic only when removing it reduces
   maximum matching cardinality.
4. Adjustment rows outside payment/refund ledger verification are still consumed as present
   evidence. A regression test prevents their merchant counterparts from being mislabeled as
   merchant-only exceptions.

## Reproducibility controls

- Money is integer paise; malformed precision is rejected rather than rounded.
- The core receives an injected clock and contains no `Date.now()` or `Math.random()` path.
- Physical input occurrences receive stable identities and every row reaches a terminal outcome.
- Public input components and the combined bundle are SHA-256 identified.
- The replay cache is selected only by the exact public-input bundle hash. A miss or malformed
  cache safely falls back to deterministic evidence.
- Optional live capture records the exact public request, adapter and provider separately, response
  identifiers, timing/usage, raw and parsed response hashes, verifier verdicts and a self-hash. Its
  replay candidate remains inert until explicit human review and promotion.
- Canonical decision artifacts are byte-stable across repeated runs and input shuffles.
- Truth stays in `data/dev/truth` and is read only by the evaluation boundary.
- The Evidence Desk runs the same browser-safe artifact consistency validator before rendering the
  sealed demo or any local import. “Internally consistent” is not presented as a signature.

## Evaluation discipline

The metric definitions in `eval/METRICS.md` were fixed independently of the solver result. The
current corpus is explicitly a **synthetic development benchmark**, not held-out data and not a
claim about real merchant prevalence. Three frozen configurations are compared:

- baseline: literal, exact UTR identity only;
- deterministic: allowlisted deterministic evidence plus globally forced matching;
- hybrid: deterministic plus a committed model-response replay whose claims must pass code
  verification.

All numerator/denominator pairs are retained. Zero false automatic decisions is reported as an
observed `0/10`, alongside its Wilson upper bound, rather than as proof that future error is
impossible. Performance is recorded in a separate provenance envelope so wall-clock timing never
changes the decision artifact.

## Known limitations

The data is synthetic and intentionally fault-dense. The current benchmark contains 24 settlement
groups, so confidence intervals remain wide. Hybrid adds one correct automatic decision over the
deterministic configuration; it does not establish general model lift. Exception scoring is strict
at the planted-instance identity level: one evidence situation can legitimately emit both a root
exception and a downstream consequence, so category taxonomy still has room to improve. Vouch
does not claim production readiness, bank certification, fraud detection, payout coverage, or
support for every bank export.
