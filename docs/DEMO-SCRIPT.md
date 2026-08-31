# Five-minute demo script

The committed demo uses synthetic public inputs and pinned replay responses. Do not use a live model
or network during judging. Search by the real artifact IDs below; the Evidence Desk renders all 24
recorded settlement decisions rather than a hand-written showcase.

## 0:00–0:35 — The promise

Open the Evidence Desk on `setl_950hhkn23ad9sd`.

> A merchant sees one bank credit, many Razorpay ledger effects and their own sales records.
> Vouch does not merely match them. It shows the evidence required to prove all three agree.

Point to the three witnesses and the separate bank/books/review states.

## 0:35–1:20 — The founding accounting bug

Show the 22 retained constituent rows for `setl_950hhkn23ad9sd`. Explain that payment `fee` already
includes its tax component, while the settlement equation uses the authoritative integer-paise
`credit − debit` contribution from every row. Point to the calculated and observed ₹59,567.68 and
the ₹0.00 residual. State: “No tolerance. Money is integer paise.”

The smaller ₹3,898.52 example is a golden unit-test fixture for the fee/tax rule; it is not a case in
this sealed 24-settlement artifact.

## 1:20–2:00 — Fifty paise matters

Select `setl_hr5zo1vtwfkt8e`. Its exact UTR identifies the transfer, but the observed bank credit is
₹0.50 short. Show `SHORT_CREDIT` and explain that the pair is quarantined so another row cannot steal
either side. The product gives a next action instead of rounding the gap away.

## 2:00–2:40 — Refusing a plausible lie

Select `setl_7htrgwjj4mavxy`. Two bank credits survive in globally optimal matchings. Explain that
picking the first or nearest-looking one would create a clean but unsupported answer. Vouch reports
ambiguity.

## 2:40–3:30 — AI with no authority

Select `setl_py9hern3hehi91`. The blue marginal note shows an AI-proposed source narration and every
recorded deterministic test. Code verified the literal span, normalized reference, exact amount,
currency, posting date and ledger presence, then reran global uniqueness. The assisted proof still
closes at zero paise.

Then select `setl_es8pel0wd0skhf`. Its model proposal is rejected because the posting-window test
fails; the settlement stays missing and open. State: “AI proposes. The verifier proves.”

The separate hostile narration `bank_pusxvnnwsq03k5` is retained as inert source data and classified
`UNKNOWN_BANK_CREDIT`; do not claim that it created the rejected settlement hypothesis.

## 3:30–4:10 — Three sources means three sources

Select `setl_3ydj1b58mz7vv9`. Its bank pair closes exactly, but one merchant record is missing, so the
overall proof is withheld. This is the visual answer to “are you just matching payouts to a bank
statement?”

## 4:10–4:45 — Measured, not marketed

Open Evaluation. Say clearly that this is the development synthetic batch, not held-out and not real
merchant prevalence. Compare the literal baseline, deterministic engine and verified-AI replay using
exact k/n metrics. Say the measured result, not a rounded percentage: hybrid automated 10 cases, all
10 were correct, unique-case recall was 10/11, and every accepted residual was exactly zero paise.

## 4:45–5:00 — Close

Click **Verify current artifact**. It reloads the sealed JSON and checks source identities, hashes,
the complete row-outcome partition, references, equations, audit events, summary and artifact ID; it
does not pretend to rerun the solver in the browser. Finish with:

> AI proposes. The verifier proves. Every paise is explained—or honestly escalated.

Keep the exception, assisted and ambiguity case IDs ready before recording. Reset the page between
takes; no local imported artifact should carry over.
