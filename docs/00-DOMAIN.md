# 00 — Domain facts (authoritative) — v2, corrected & frozen 2026-08-25

Everything downstream cites this file. Facts and field names appear here once; other files point here.
v1 was corrected after an external Codex review; both load-bearing corrections were verified against
official Razorpay docs on 2026-08-25 before acceptance.

Status per fact: **[V]** verified against official docs · **[S]** synthetic stress assumption, ours,
never claim as a Razorpay/bank fact.

## 1. Money is integer paise, never float

`amount: 50000` means ₹500.00. **[V]**

All arithmetic is integer paise. Parse decimal strings directly to int (`"1,234.56"` → `123456`);
no floats anywhere in the money path; convert to rupees only at display. Indian comma grouping
(`1,23,456.78`) must parse. Malformed precision (`"12.345"`) is rejected, never rounded.

## 2. Fee and tax semantics — THE founding-bug fact

Per the official payment entity docs **[V]**, quoted verbatim:
- `fee` — "Fee (including GST) charged by Razorpay."
- `tax` — "GST charged for the payment."

Therefore `total_deduction = fee` and `base_fee = fee − tax`. **Never subtract `fee + tax` — that
double-counts GST.** `tax` is informational decomposition only.

This must exist as a golden test: a fixture where `fee + tax` yields a plausible non-zero residual
and only `fee` closes to zero.

Refunds do NOT reverse the original payment's fee/tax. **[V]**

## 3. The recon API contract (verified 2026-08-25)

`GET /v1/settlements/recon/combined?year&month&day` returns per-row **[V]**:

`entity_id`, `type` (payment | refund | transfer | adjustment), `debit`, `credit`, `amount`,
`currency`, `fee`, `tax`, `on_hold`, `settled`, `created_at`, `settled_at`, `posted_at`,
`settlement_id`, `settlement_utr`, `payment_id`, `order_id`, `order_receipt`, `method`,
`card_network`, `card_issuer`, `card_type`, `dispute_id`, `credit_type`, `description`, `notes`.

**Membership is given, not hidden**: every row carries `settlement_id` + `settlement_utr`. The
product is therefore three-source *verification*, not subset *discovery*. Subset reconstruction
exists only as a clearly-labelled degraded-data fallback (missing settlement_id), bounded,
uniqueness-checked, refuse-if-ambiguous.

Schema tolerance is mandatory: `payment_id` is null for payments and populated for refunds/
transfers; `credit_type` is absent on adjustment rows; `notes` appears as object, strings, or null
in Razorpay's own samples. Parser accepts nullable/extra fields; rejects only what breaks money
semantics. Pagination: explicitly rejected with a clear error (documented non-goal).

`created_at` / `settled_at` are Unix epoch integers. **[V]**

## 4. The settlement equation and zero-residual principle

A settlement is one bank credit standing for many signed ledger events. For a settlement group:

```
calculated_settlement_paise = Σ (row.credit − row.debit)      over rows with that settlement_id
residual                    = bank_credit_paise − calculated_settlement_paise
```

**When authoritative records are complete, residual is exactly zero. Any non-zero residual is an
exception — there is no default tolerance anywhere in the system.** Tolerance-like reasoning exists
only inside hypothesis verification (e.g. testing a proposed fee policy with exact per-transaction
rounding), never in match acceptance.

## 5. UTR

The UTR (`settlement_utr`) is the unique reference linking a settlement to the bank transfer, and
the strongest join key to a bank statement line. **[V]** It is the *strongest* evidence, not
officially the *only* evidence — amount, currency, and posting-date window corroborate.

Truncated / prefixed / case-mangled / narration-buried UTRs are **[S]** — realistic corruptions our
generator injects deliberately. Present as synthetic stress cases, never as verified bank behaviour.

## 6. Settlement timing

Domestic default is normally T+2 working days, merchant-configurable; instant settlement (T+0)
exists. **[V]** Never hard-code T+2. Consequences that shape the matcher:
- A refund against a previously-settled payment appears as a debit in a **later** settlement
  (cross-cycle refund) — candidate windows must span cycles. **[V]**
- Partial settlements exist. **[V]**
- A `settlement.processed` state means Razorpay processed the transfer — it does not by itself
  prove the bank credited the merchant. That gap is exactly what the bank statement verifies.
- Weekend/holiday posting delay is **[S]** in our data.

## 7. The three sources

1. **Razorpay recon rows** — official shape per §3 (authoritative for membership and fees).
2. **Bank statement CSV** — posting date, direction, amount, narration, UTR-if-present, row ref.
   Limited documented format set; no universal-bank claim.
3. **Merchant ledger export** — merchant ref, order/payment/refund ref, type, expected amount,
   currency, created date, status. Deliberately minimal; it exists to make verification
   *independent* (otherwise we check Razorpay against Razorpay) and to enable
   MISSING_RAZORPAY_ROW / MISSING_MERCHANT_LEDGER_RECORD exceptions.

## 8. Removed from V1 (unverified or out of scope)

- **Rolling reserve** (percentage withheld and later released): NOT found in official docs; distinct
  documented concepts (merchant-funded Reserve Balance, settlement holds, Route transfer holds)
  must not be conflated with it. Excluded from claims AND from the synthetic dataset.
- Real bank integration, real merchant data, moving money, journals, tax, forecasting, ERP,
  universal bank formats, unrestricted subset solving, universal fee discovery, production
  accuracy/compliance claims.

## 9. Truthfulness rules (pitch-binding)

Test Mode is simulated — no real bank settlement proof exists or is claimed. All bank statements
and batches are labelled **synthetic**; metrics are labelled synthetic-benchmark, never production
accuracy or "merchant savings". The false-automatic-match rate is reported as measured on the
frozen held-out set; zero is claimed only if measured zero.
