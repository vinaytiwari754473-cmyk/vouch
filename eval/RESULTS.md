# Development benchmark results

Status: **synthetic development benchmark; not held-out; not real merchant prevalence**.

- Dataset: `vouch-dev-2026-08-v1`
- Seed: `vouch-dev-seed-2026-08-25-v1`
- Public-input bundle SHA-256:
  `7070d07f2bd54f40ae377470f12005c0dc30c5d51805e6c5671144d2a2b761ad`
- Rows: 529 recon + 25 bank + 529 merchant = 1,083 physical occurrences
- Settlement groups: 24

| Configuration | Automatic coverage | Automatic precision | False automatic | Unique-case recall | Safe-abstention precision |
|---|---:|---:|---:|---:|---:|
| Literal UTR baseline | 7/24 | 7/7 | 0/7 | 7/11 | 13/17 |
| Vouch deterministic | 9/24 | 9/9 | 0/9 | 9/11 | 13/15 |
| Vouch + verified replay | 10/24 | 10/10 | 0/10 | 10/11 | 13/14 |

For the hybrid `0/10` false-automatic observation, the two-sided Wilson 95% upper endpoint is
`27.75%`. This wide interval reflects the small development sample; the result is evidence from
this committed corpus, not a universal zero-risk claim.

Hybrid ambiguity precision and recall are both `3/3`. Hybrid exception-instance precision is
`20/25`; recall is `20/26`. Every accepted equation has an absolute residual of `0` paise. The
hybrid run is complete: `1,083/1,083` physical source rows have a terminal outcome.

The verified replay adds `1/1` correct AI-eligible resolution and adds `0` false automatic
verifications. A second replay claim cites a valid UTR but fails the posting window and is rejected.

Local performance envelope (not part of the canonical decision artifact): 5 warmups followed by
30 measured hybrid runs, median 359.49 ms, p95 462.56 ms, median 3,012.61 rows/second. Machine and
runtime details are in `data/dev/output/performance.json`.

## Limitations

The small, intentionally fault-dense corpus produces wide confidence intervals; observed `0/10`
does not imply zero future error. Exception scoring uses exact category and occurrence identity.
Some evidence situations produce both a planted root cause and a defensible downstream exception,
which lowers strict instance precision. The corpus is development data and must not be described as
held-out. A future held-out freeze must be committed before its first hybrid evaluation and reported
without re-rolling.
