# Threat model

## Protected claim

Vouch protects the integrity of an automatic three-source settlement verification. The primary harm
is a false green verdict: accepting the wrong bank credit, overlooking missing cash, or presenting an
incomplete ledger as fully proved.

## Threats and controls

| Threat | Control | Failure behavior |
| --- | --- | --- |
| Paise lost through floating point | safe integers, decimal parser, checked sums | invalid input |
| GST subtracted twice | bank equation uses recon `credit − debit`; golden regression | invariant/test failure |
| Duplicate UTR or bank credit | exact graph must be one-to-one | ambiguity/conflict |
| Greedy local pairing | global maximum matching plus forced-edge test | ambiguity |
| Amount/date coincidence | fallback requires identity evidence | unmatched/review |
| AI invents an ID | scoped ID and evidence-hash validation | hypothesis rejected |
| Prompt injection in narration | narration is quoted data; literal-span verifier | hypothesis rejected |
| AI adds a competing edge | rebuild complete unresolved graph | former match may be revoked |
| Duplicate-looking real credits | preserve every physical occurrence | ambiguity |
| Repeated file upload | complete-file receipt hash | duplicate import |
| Truth leaks into solver | package boundary and static import test | test failure |
| Row order changes outcome | canonical occurrence identity and stable sorts | determinism test failure |
| CSV formula injection | prefix dangerous exported cells with apostrophe | safe export |
| Live model/network outage or malformed response | bounded timeout and strict response verification | no new AI result; replay must be selected explicitly |
| API key exposed to visitors | server-only runtime secret, header to fixed Google endpoint | no key in bundles, traces, URLs or Git |
| Public visitors exhaust inference allowance | separate high-entropy demo code, exact origin, atomic durable 50-attempt allowance | unauthenticated or over-limit request rejected before model call |
| Concurrent model requests across server isolates | conditional D1 reservation with cooldown and expiring lease | busy request rejected; missing protection fails closed |
| Browser sends private data or arbitrary prompts to model | endpoint accepts only an empty request and uses bundled public sample | non-empty/custom input rejected |
| Tampered imported artifact | recompute source/input/audit/artifact hashes, references, equations and summary | import rejected; current desk retained |
| Capture provenance altered | canonical hashes bind request, raw response, parsed hypotheses and verifier verdicts | capture/replay review fails |
| Self-hash mistaken for authorship | UI says internally consistent, never authenticated or signed | no identity claim |

## Explicit non-goals

Vouch does not move money, initiate refunds, mutate Razorpay records, make accounting entries,
predict real-world settlement policy, or assert fraud. A manual decision is an auditable human action,
not retroactive proof that the system was certain.

The demo access code is a shared bearer capability, not named-user authentication: anyone it is
shared with can consume the remaining allowance. It is kept only in browser memory; rotating the
server secret revokes the old code. Provider quotas and billing controls remain separate. The total
50-attempt allowance is durable across deploys, does not reset daily, and counts failed/uncertain
attempts conservatively. It limits requests, not a guaranteed currency amount. Source-data upload
verification stays AI-off and separate from this endpoint.
