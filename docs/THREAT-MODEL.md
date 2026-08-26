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
| Live model/network outage | committed replay default; miss remains unresolved | one case escalated |

## Explicit non-goals

Vouch does not move money, initiate refunds, mutate Razorpay records, make accounting entries,
predict real-world settlement policy, or assert fraud. A manual decision is an auditable human action,
not retroactive proof that the system was certain.
