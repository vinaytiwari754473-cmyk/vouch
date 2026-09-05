# September 5 decision: stay with Vouch, Track 4

## Why stay today

The official [Buildathon brief](https://razorpay.com/buildathon/) asks Track 4 builders to close a
finance-operations loop on 50+ synthetic records and demonstrate throughput, accuracy and honest
exceptions. Vouch has a working three-source loop, reproducible evaluation, a public product and
repository, bounded AI evidence, and code-level safety checks. A new track today would discard
tested domain work and leave less time to demonstrate and defend the replacement.

This is a deadline-specific recommendation, not proof that Vouch is the best possible business idea.
Winning depends on judging, other submissions, execution and your explanation. Model access does
not establish an exclusive advantage, and no win probability can be justified from this review.

## Competition changes the pitch

Public projects including [ClosePilot](https://github.com/souvikDevloper/closepilot),
[IniRazor-AI](https://github.com/Iniyan-2005/IniRazor-AI),
[Attest](https://github.com/kunalkumar-13/attest), and
[ReconX](https://github.com/YashwanthKumar-K/ReconX) overlap with reconciliation, safety or auditability.
Do not pitch “AI proposes, rules authorize,” three-source matching, or fail-closed behavior as uniquely ours.
Competitor-reported benchmark sizes and speeds have not been independently reproduced here and are
not comparable across datasets and hardware. Do not attack their claims in the video.

Pitch evidence the reviewer can challenge: a source change produces a fresh, inspectable decision;
bank agreement and merchant-book agreement remain separate; ambiguous assignments do not become
convenient green matches. Then show exactly the one case AI adds and why another is rejected.

## What changed today

- Related malformed source evidence now quarantines its settlement or bank identity instead of
  disappearing before matching. Exact IDs, supported reference variants and narration tokens are checked.
- Conflicting explicit payment/refund identities cannot be rescued by an order-only fallback.
- Explicitly held or unsettled constituent rows withhold closure.
- Multi-candidate AI proposals and merged edge evidence survive artifact validation, while an edge
  cannot claim support from a rejected/unrelated proposal.
- The browser runs the actual core on three local source files and on controlled synthetic source
  edits. It does not reuse AI replay against changed source evidence.
- Merchant checks outside the supported payment/refund scope say NOT_REQUIRED, not VERIFIED.
- Review exposes the full exception register, including source exceptions without settlement cases.
- All benchmark artifacts were regenerated; unchanged automatic coverage and degraded exact
  exception-category scores are both reported in eval/RESULTS.md.

## Freeze after verification

The earlier freeze recommendation was premature: the model capture command was separate from
the interactive workflow. This gap is now addressed by the bounded local live agent and clearly
labelled public replay, documented in [AGENT-WORKFLOW.md](AGENT-WORKFLOW.md). No claim is made
that the public hosting environment runs fresh model inference or that all exceptions are resolved.

Do not add more tracks, a chatbot, cosmetic redesign, live payment actions or a larger synthetic
benchmark today. Record and rehearse [the final video script](VIDEO-RECORDING-SCRIPT.md). Check that the
public repo, site, video link and architecture link open without your account. Check the official
form's current requirements and deadline before final submission. A recorded video/application is
still required; deploying this product does not submit the competition entry.

## Be ready to defend the limits

This is a prototype, not independently audited production financial software. It assumes supplied
evidence, supports a bounded INR schema, does not prove bank-document authenticity, and cannot
establish real merchant prevalence or ROI from synthetic data. Exact UTR anchoring intentionally
differs from fallback posting-window checks. Global matching may become expensive on dense graphs;
browser limits and timeout are safeguards, not large-scale performance proof. Real anonymized input
validation, independent held-out evaluation and analyst workflow testing are the next substantive work.
