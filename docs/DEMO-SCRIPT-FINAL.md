# Submission video — executable evidence, not a dashboard tour

> Superseded after agent integration: use [VIDEO-RECORDING-SCRIPT.md](VIDEO-RECORDING-SCRIPT.md).
> The text below is retained as the earlier Proof Lab-only recording plan.

Target: 4:45–4:55 after rehearsal. Screen actions are not spoken. Use your face for the first
20 seconds and the last 15 seconds; use a legible full-screen product view in between. Plain captions,
clear sound, no loud music. Do not speed up a failing run or cut in a fabricated result.

Before recording: load the public site, close unrelated tabs, confirm the recorded AI run and
Proof Lab both work. Prepare the two AI case IDs below. Do one full practice take. If clicks take
longer than planned, omit the one-paise experiment, not the limitations or the AI verification explanation.

## 0:00–0:25 — Face, then product

> I'm Vinay, and this is Vouch, built for Track Four: AI Finance Controller.
> A payout reference can match while the money is short—or while the merchant's own books disagree.
> Vouch checks three sources: Razorpay reconciliation, the bank statement, and the merchant ledger.
> I won't ask you to trust a green dashboard. I'll change the evidence and show you what happens.

## 0:25–1:05 — Reconstruct the baseline

In Proof Lab, click **Reconcile sample sources**. Leave `setl_950hhkn23ad9sd` selected.

> These are 1,083 synthetic source rows, covering 24 settlements. This button runs the actual
> deterministic engine in my browser. It is not loading saved answers, and AI is off.
> This settlement expects ₹59,567.68. The bank credit agrees, the required merchant records agree,
> and the residual is exactly zero.
> Money is integer paise. The calculation uses Razorpay's credit minus debit; it does not subtract
> tax twice when tax is already included in the fee.

## 1:05–1:50 — Withdraw a proof when the evidence changes

Choose **₹5,000 goes missing**, click **Change source & rerun**. Show the comparison.

> Now I reduce the source bank credit by ₹5,000. The reference is unchanged. The engine reruns
> the whole batch, and this proof is withdrawn. The bank status is an amount mismatch; the books
> still agree. Those are different facts, so Vouch keeps them separate.
> This is a controlled synthetic shortfall, not money I claim to have recovered.

If time permits, choose **Just one paise** and rerun.

> One paise receives the same standard. No rounding away evidence we cannot explain.

## 1:50–2:30 — Cash agreement is not enough

Choose **The books lose a row**, rerun, and show bank/books/verdict.

> Here the original bank credit is restored, but I remove a required merchant record.
> The bank agrees exactly. The books do not. Vouch will not close the overall case.
> It also refuses to guess between competing credits: its matcher accepts only pairs required
> across every maximum assignment of the candidate graph. That is a global test, not a confidence score.

Choose **Restore the source**, rerun. Briefly point to the identical baseline artifact ID.

> Restoring the original source reproduces the same baseline artifact. I'm changing inputs, not verdicts.

## 2:30–3:35 — Show why AI belongs, and where it stops

Click **Open the recorded AI-assisted run**. In Evidence Desk, search `setl_py9hern3hehi91`, select it.

> This separate run uses a pinned AI response, so the demonstration does not depend on a live API.
> One bank narration contains a differently formatted reference. The model proposes a literal source
> span and candidate. It does not calculate money or authorize a match.
> Code checks that the span exists, applies an allowed reference transformation, checks amount,
> currency, date and merchant evidence, then reruns global uniqueness. Only then is this assisted
> match accepted at zero residual.

Search and select `setl_es8pel0wd0skhf`.

> Here a model proposal fails the posting-window test. It stays rejected. Confidence cannot override
> a failed check. The browser experiments never reuse AI responses against changed inputs.

## 3:35–4:20 — Honest evaluation

Open Evaluation. Show the three comparison rows.

> On this deliberately fault-dense development batch, literal reference matching correctly closes
> seven settlements. Deterministic Vouch closes nine. Verified AI adds one: ten correct automatic
> verifications out of ten attempts, covering ten of 24 settlements. All 1,083 rows have an outcome.
> This is not a held-out test or production accuracy. Zero observed false matches does not mean
> zero future risk. The repository also reports imperfect exception classification and the effect
> of our invalid-source safety correction. I have not changed the labels to hide that result.

## 4:20–4:45 — Usable product, inspectable engineering

Open Proof Lab; point to the three file inputs and samples. Do not spend time browsing folders.

> You can run your own three files using the documented schema. They stay in browser memory,
> and the same core calculates the result locally. You can inspect the evidence, review every
> exception—including invalid or orphan rows—and export the complete run.
> The public repository includes the architecture, reproducible demo, adversarial tests and limitations.
> This prototype verifies supplied evidence; it does not authenticate a bank statement or move money.

## 4:45–4:58 — Face / close

> My focus is a finance tool that knows when it has enough evidence—and when it must stop.
> AI proposes. The verifier proves. Every paise is explained—or honestly escalated.
> I'm Vinay. This is Vouch.

## Non-negotiable recording claims

- Say **synthetic development batch**, not held-out or production.
- Say **ten correct out of ten automatic attempts**, not “100% accurate on everything.”
- Say **pinned AI response**, not “live AI,” for the recorded run.
- Say **controlled shortfall**, not recovered/saved money.
- **Verify current artifact** checks internal consistency; **Proof Lab** reruns reconciliation.
- The SHA is a reproducible self-hash, not a bank signature or authenticated source proof.
- No claim that this concept is unique, that judges use AI screening, or that selection is guaranteed.
