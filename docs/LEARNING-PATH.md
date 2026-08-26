# Learning path after the build

This path assumes 5–8 focused hours per day and starts with understanding the submitted product—not
rewriting it blindly.

## Week 1 — Own the idea

1. Explain the ₹3,898.52 golden case on paper, including why `tax` is not subtracted again.
2. Learn TypeScript objects, unions, functions and safe integers using `packages/core` examples.
3. Trace one exact match, one ₹0.50 short credit and one ambiguity through the code and tests.
4. Draw the three status dimensions and explain why bank-exact is not always overall-verified.
5. Rehearse the demo without reading the script; write down every question you cannot answer.

## Week 2 — Own the implementation

1. Learn Vitest by changing a fixture and predicting which test fails.
2. Implement one harmless new exception fixture and its expected outcome.
3. Learn bipartite matching with small hand-drawn graphs: unique chain, 2×2 ambiguity and competing
   settlements for one bank line.
4. Read the AI schema and explain every reason a hypothesis can be rejected.
5. Run generate, demo, eval and build from a fresh clone.

## Months 1–3 — Foundations

- JavaScript and strict TypeScript; arrays, maps, sets, errors and pure functions.
- Git, commits, branches and code review.
- HTTP/JSON/CSV basics and schema validation.
- Testing: unit, property, golden and adversarial tests.
- Money/accounting basics: gross, fees, tax component, credit, debit, refund and settlement.

## Months 4–6 — Engineering depth

- Algorithms: graphs, matching, complexity and deterministic ordering.
- Security: prompt injection, formula injection, unsafe parsing and audit logs.
- React state, accessibility, responsive CSS and information design.
- Benchmark design, data leakage and confidence intervals.

## Months 7–12 — Product depth

- Interview merchants and validate exception categories without exposing sensitive data.
- Add safe adapters for real exports and pagination.
- Design manual-resolution permissions and audit retention.
- Run privacy/security review, then pilot read-only workflows.
- Learn deployment, observability and incident response before any production financial use.

The goal is not memorizing the code. It is reaching the point where you can defend every green state,
every abstention and every product tradeoff in your own words.
