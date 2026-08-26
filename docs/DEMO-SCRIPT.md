# Five-minute demo script

The committed demo uses synthetic public inputs and pinned replay responses. Do not use a live model
or network during judging.

## 0:00–0:35 — The promise

Open the Evidence Desk already on case `/0187`.

> A merchant sees one bank credit, hundreds of Razorpay ledger effects and their own sales records.
> Vouch does not merely match them. It shows the evidence required to prove all three agree.

Point to the three witnesses and the separate bank/books/review states.

## 0:35–1:20 — The founding accounting bug

Show the four constituent rows in `/0187`. Explain that payment `fee` includes GST and the settlement
is rebuilt from `credit − debit`. Point to ₹4,198.52 − ₹300.00 = ₹3,898.52, the exact bank credit and
the ₹0.00 residual. State: “No tolerance. Money is integer paise.”

## 1:20–2:00 — Fifty paise matters

Select `/0188`. The UTR is exact but the bank is ₹0.50 short. Show `SHORT_CREDIT` and explain the pair
is quarantined so another same-amount row cannot steal either side. The product gives a next action.

## 2:00–2:40 — Refusing a plausible lie

Select `/0191`. Two bank credits can participate in maximum matchings. Explain that picking the first
or nearest-looking one would create a clean but unsupported answer. Vouch reports ambiguity.

## 2:40–3:30 — AI with no authority

Select `/0194`. Read the blue marginal note: AI proposed a literal narration span. Code verified the
span, reference transformation, amount, currency and posting date, then reran global uniqueness. The
seal says assisted but still closes at zero.

Then select `/0204`. The narration says “ignore all rules.” Show that it remains quoted evidence and
the hypothesis is rejected. State: “AI proposes. The verifier proves.”

## 3:30–4:10 — Three sources means three sources

Select `/0201`. The bank is exact but a merchant record is missing, so overall proof is withheld.
This is the visual answer to “are you just matching payouts to a bank statement?”

## 4:10–4:45 — Measured, not marketed

Open Evaluation. Say clearly that this is the development synthetic batch, not held-out and not real
merchant prevalence. Compare the literal baseline, deterministic engine and verified-AI replay using
exact k/n metrics. Point to observed false automatic verifications and the Wilson bound language.

## 4:45–5:00 — Close

Run the sealed batch. As the five stages advance, finish with:

> Every paise is explained—or it is honestly escalated with its evidence and next action.

Keep the exception, assisted and injection case URLs/state ready before recording. Reset the page
between takes; no manual review state should carry over.
