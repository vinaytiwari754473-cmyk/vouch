# Vouch held-out leakage checklist

This checklist must be completed before the official synthetic benchmark. The held-out bundle is
generated **only after the solver, prompt, generator, evaluator, and metric protocol are frozen**.

## Freeze boundary

- [ ] `eval/METRICS.md` is committed and its SHA-256 recorded.
- [ ] Solver code and every matching/configuration constant are committed.
- [ ] Generator code, corruption classes, and class frequencies are committed.
- [ ] Evaluator code and truth schema are committed.
- [ ] AI eligibility rule is committed.
- [ ] Provider, exact model ID, prompt, response schema, and decoding settings are committed.
- [ ] The freeze commit is clean and recorded before held-out generation.
- [ ] Official evaluation has no dynamic provider fallback.

## Dependency isolation

- [ ] `packages/core` has no imports from `packages/generator`, `packages/eval`, truth manifests, or
      `data/heldout`.
- [ ] `packages/generator` does not import solver matching or normalization helpers.
- [ ] `packages/eval` imports neither core nor generator and accepts structural artifacts only.
- [ ] The core run succeeds with the truth directory physically absent.
- [ ] Changing only the truth manifest leaves the canonical solver artifact byte-identical.
- [ ] Public inputs and model prompts contain no truth-only fields, corruption labels, expected
      statuses, or names such as `correct_*`.

## Metamorphic leakage tests

- [ ] Opaque settlement and bank IDs are bijectively renamed; predictions rename identically and
      scores do not change.
- [ ] Input rows are shuffled; the canonical artifact hash does not change.
- [ ] A truth-only canary field is changed; the solver artifact hash does not change.
- [ ] The model-request snapshot contains public evidence only.
- [ ] Replay keys hash the complete canonical request, including case input and model configuration.
- [ ] Two cases using the same prompt template cannot cross-hit the replay cache.

## One-shot held-out procedure

- [ ] One uninterrupted command generates, runs, captures, scores, and only then reveals results.
- [ ] No held-out input or truth is inspected between generation and scoring.
- [ ] Public input hash, truth hash, bundle hash, and seed commitment are written immediately.
- [ ] Baseline, deterministic, hybrid, and off configurations use the same public input bytes.
- [ ] The official live response is saved verbatim with request hash and model provenance.
- [ ] The committed replay reproduces the live decision projection; timing fields are excluded.
- [ ] `off` and deterministic canonical decision projections have identical hashes.
- [ ] No held-out dataset is regenerated after seeing a result.

## Reporting integrity

- [ ] Every ratio shows numerator and denominator; zero denominator is `N/A`.
- [ ] Observed `0/N` false verifications includes the Wilson 95% upper endpoint.
- [ ] Manual resolutions are excluded from automatic metrics.
- [ ] Exception results are keyed by exact category and occurrence IDs.
- [ ] Short, excess, missing-settlement, and unknown-bank money totals are not netted together.
- [ ] Runtime samples are stored outside canonical artifacts and include machine/runtime metadata.
- [ ] Results are labelled synthetic; aggregate corruption frequencies are not described as real
      merchant prevalence.
- [ ] No accuracy, savings, production, bank-grade, or compliance claim exceeds the measured data.
- [ ] If code changes after freeze, both the original and corrected reports remain published.
