# Build Challenges & Technical Obstacles — submission draft

The current [official application form](https://docs.google.com/forms/d/e/1FAIpQLScJ9XSqVCB2oaPwEMH0Zk3I1OpILFW1WpWdWweQ2950jdRzlg/viewform?usp=send_form)
requires a written answer about issues encountered and how they were solved. It does not currently
use the phrase “what broke at 2am.” Use the actual development incident below; do not invent a clock
time or claim you implemented the code without AI. Read it, understand it, then put it in your voice.

## Paste-ready answer

The most dangerous bug in Vouch did not crash the app. It could produce a believable green result.

An AI-assisted adversarial review exposed a gap between ingestion and verification. A malformed
source row was retained as an error but excluded from matching. If that rejected row referred to
the same settlement or bank identity, the remaining valid rows could still balance. Zero residual
did not prove that all relevant evidence had been considered.

Working with Codex, I changed the pipeline to retain those identity relationships and block
automatic closure for affected settlements or bank records. Every physical row still receives an
outcome. Importantly, an unrelated malformed row must not block an independent clean settlement.

Regression tests now cover malformed recon, bank, merchant and settlement-entity evidence, plus
the unrelated-row control. The fix also worsened two exact exception-category scores on our
development benchmark. I kept the original labels and reported the regression instead of changing
the evaluation to make the fix look better.

The lesson was specific: accounting for every row is not enough; every relevant row must affect
the decision. AI helped implement and test the correction, but passing code-level checks—not an
AI explanation—is what now governs acceptance.

## Evidence behind the answer

- Fix: [rejected-evidence quarantine commit](https://github.com/vinaytiwari754473-cmyk/vouch/commit/8f6e3834e95fe05c6cad5cbad47e9ced77eee1c2).
- Tests: [related and unrelated malformed evidence](https://github.com/vinaytiwari754473-cmyk/vouch/blob/8f6e3834e95fe05c6cad5cbad47e9ced77eee1c2/packages/core/src/core.test.ts#L169).
- Evaluation: [September 5 correctness refresh](https://github.com/vinaytiwari754473-cmyk/vouch/blob/main/eval/RESULTS.md).
  Exception-instance precision changed from 20/25 to 18/25, recall from 20/26 to 18/26. Automatic
  coverage stayed 10/24. These are development-corpus observations, not production outcomes.
- Current targeted check, run September 5: five selected tests passed (four malformed-source cases
  and one unrelated-record control). The 29 skipped tests in that filtered run were not failures.
  The complete local suite had separately passed 122 tests during Gemini integration.

To reproduce the targeted check from the repository root:

~~~powershell
pnpm exec vitest run packages/core/src/core.test.ts -t 'withholds closure for a malformed|keeps an unrelated malformed record' --reporter=verbose
~~~

## Be ready for these follow-ups

**Why did exact money checks not catch it?** The arithmetic checked the retained valid subset. The
problem was whether that subset represented all relevant evidence. Exact arithmetic does not fix
incomplete evidence selection.

**Why not stop the whole batch whenever any row is bad?** That would block unrelated, independently
provable work. Vouch conservatively links rejected evidence using supported stable identities and
reference evidence, then withholds only affected proofs while retaining the error visibly.

**What did AI do?** Claude helped challenge the brief; Codex implemented and tested the correction.
Do not claim manual coding or unaided discovery. Explain the failure, the boundary and the test
in your own words; that is the part the panel can actually examine.

**Did real merchant money go missing?** No. This was adversarial synthetic testing, not a reported
customer incident or a recovered-money result.

## Secondary incident, if asked about live integration

The local suite passed while real Gemini requests initially failed. Tests of a mocked provider
did not establish live compatibility: an older model returned 404, some request formats returned
400, and one availability check encountered provider overload. Integration was completed with
Gemini 3.5 Flash, a compatible structured-response wire format, bounded output and independent
verification. The actual HTTP run returned two proposals, one verified and one rejected. Failed
attempts never silently substituted replay. This is a useful second story, not a fabricated 2 a.m.
outage or a claim that unit tests prove external-provider availability.
