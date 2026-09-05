# Architecture

## Trust boundary

```text
Razorpay recon ─┐
Bank credits ───┼─> validate + retain occurrences ─> settlement equations
Merchant books ─┘                                      │
                                                       v
                                             deterministic edges
                                                       │
Unresolved evidence ─> typed AI proposal ─> code verifier adds candidate edge
                                                       │
                                                       v
                                      global maximum-matching uniqueness
                                                       │
                                      ┌────────────────┴───────────────┐
                                      v                                v
                             forced + zero residual             honest exception
                                      │                                │
                                      └────────> canonical artifact <──┘
                                                       │
                                                       v
                                                evidence-desk UI
```

The model is outside the authority boundary. It cannot write a row, calculate money, choose a
candidate, change a status or bypass ambiguity. Its response is untrusted structured input.

## Package boundaries

### `@vouch/core`

Pure TypeScript. Accepts already-loaded values and injected configuration. It may hash canonical
values, parse money, calculate IST dates, group recon rows, build candidate graphs, test forced
edges, cross-check merchant rows, verify typed AI hypotheses and emit a canonical run artifact.

It may not import filesystem modules, environment variables, model SDKs, the generator, evaluator,
truth manifests or held-out data. It may not call `fetch`, `Date.now()` or `Math.random()`.

### `@vouch/generator`

Builds an opaque seeded merchant world, projects official-shaped public sources, then applies an
independent corruption plan. Separate RNG streams govern the world and corruption placement. Truth
is written separately and is never embedded in public IDs or fields.

### `@vouch/eval`

The sole truth reader. It verifies public-input hashes before scoring. Metrics use exact ratio
objects. Runtime and provider provenance are stored outside the canonical decision artifact.

### `@vouch/cli`

Owns filesystem and terminal I/O. It creates datasets, parses files, invokes the core and emits
reports. An explicit capture command can call one frozen model through an isolated adapter and write
a separate self-hashed provenance envelope; it never mutates the committed replay automatically.

### `@vouch/web`

A client-side evidence desk and executable Proof Lab. Financial decisions still live only in
`@vouch/core`: the browser invokes that same engine in a disposable Web Worker for raw source files
or explicit synthetic source edits. It never patches decision statuses. Runs are deterministic/AI-off,
limited to 5,000 total rows and 250 settlements, with a 15-second worker timeout. Original sample
evidence is cloned, not mutated; changed sources never reuse a pinned AI response. Source files remain
in browser memory and are not uploaded by this flow. There is no persistence or direct bank connection.

Before displaying any result, the desk validates source hashes and row
identities, input summaries, references, equations, audit hashes, the recalculated run summary and
artifact ID before projecting every recorded decision. A valid local import replaces the whole desk;
an invalid import leaves the previous artifact untouched. It exports the current canonical JSON and
a formula-safe review queue. The committed replay demo works offline.

## Reconciliation stages

1. Validate each physical occurrence independently. Invalid rows receive a terminal outcome. A
   rejected row's stable IDs and allowlisted reference evidence also quarantine related accepted
   records; invalid evidence must not disappear from a related proof. Explicit hold/unsettled flags
   and contradictory merchant references withhold automatic closure.
2. Group recon rows by non-null settlement ID and sum checked `credit − debit` contributions.
3. Quarantine exact-UTR amount discrepancies; commit exact pairs only when both sides are one-to-one.
4. Build deterministic fallback edges from exact money/currency/date and allowlisted reference evidence.
5. For every connected graph component, find its maximum cardinality `k`. An edge is forced only if
   removing it lowers the component maximum below `k`.
6. Cross-check merchant rows using typed entity identity and recon gross amount.
7. For unresolved cases only, verify typed AI evidence and rerun the entire unresolved graph.
8. Assert completeness, one-to-one use, zero accepted residuals and stable ordering; then seal JSON.

## Deterministic identity

Canonical JSON recursively sorts keys and rejects undefined values, non-finite numbers and negative
zero. Logical input hashes sort occurrence content hashes while preserving multiplicity, so shuffling
rows does not change the artifact. A byte/file hash may exist in an upload receipt but never replaces
the order-independent logical hash.

The artifact ID is a self-hash, not a digital signature. Passing validation means the artifact is
internally consistent; it does not authenticate who produced it. Model/runtime/cost/raw-response
provenance stays outside `RunArtifact` so the financial decision artifact remains deterministic.
