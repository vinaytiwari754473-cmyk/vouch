import { describe, expect, it } from "vitest";

import { generateSyntheticDataset } from "./generate.ts";
import { createRngStreams, RNG_STREAM_NAMES, SeededIntegerRng } from "./prng.ts";

describe("SeededIntegerRng", () => {
  it("is deterministic and keeps named streams independent", () => {
    const first = new SeededIntegerRng("seed", "money");
    const second = new SeededIntegerRng("seed", "money");
    expect(Array.from({ length: 12 }, () => first.nextUint32())).toEqual(
      Array.from({ length: 12 }, () => second.nextUint32()),
    );

    const streams = createRngStreams("seed");
    const firstValues = RNG_STREAM_NAMES.map((name) => streams[name].nextUint32());
    expect(new Set(firstValues).size).toBe(RNG_STREAM_NAMES.length);
  });
});

describe("generateSyntheticDataset", () => {
  it("is byte-deterministic for one seed and changes with a different seed", () => {
    const first = generateSyntheticDataset();
    const second = generateSyntheticDataset();
    const alternate = generateSyntheticDataset({
      seed: "vouch-dev-seed-alternate",
      datasetId: "vouch-dev-alternate",
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.publicInputs.razorpayRecon.items[0]?.entity_id).not.toBe(
      alternate.publicInputs.razorpayRecon.items[0]?.entity_id,
    );
  });

  it("meets the locked dataset volume and structural requirements", () => {
    const { publicInputs, truth } = generateSyntheticDataset();
    const settlementIds = new Set(
      publicInputs.razorpayRecon.items.map((row) => row.settlement_id),
    );

    expect(publicInputs.razorpayRecon.items.length).toBeGreaterThanOrEqual(500);
    expect(settlementIds.size).toBe(24);
    expect(publicInputs.bankStatement.length).toBeGreaterThanOrEqual(20);
    expect(publicInputs.bankStatement.length).toBeLessThanOrEqual(40);
    expect(truth.expected_exceptions.length).toBeGreaterThanOrEqual(20);
    expect(truth.public_counts).toEqual({
      recon_rows: publicInputs.razorpayRecon.items.length,
      settlement_groups: 24,
      bank_rows: publicInputs.bankStatement.length,
      merchant_rows: publicInputs.merchantLedger.length,
    });
    expect(truth.bank_row_truth).toHaveLength(publicInputs.bankStatement.length);
    expect(
      truth.bank_row_truth.every((truthRow) =>
        publicInputs.bankStatement.some((row) => row.bank_row_id === truthRow.bank_row_id),
      ),
    ).toBe(true);
  });

  it("keeps every recon money field in safe integer paise", () => {
    const rows = generateSyntheticDataset().publicInputs.razorpayRecon.items;
    for (const row of rows) {
      for (const value of [row.debit, row.credit, row.amount, row.fee, row.tax]) {
        expect(Number.isSafeInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("contains the golden fee/tax witness and does not double-subtract GST", () => {
    const { publicInputs, truth } = generateSyntheticDataset();
    const golden = truth.golden_fee_tax;
    const row = publicInputs.razorpayRecon.items.find(
      (item) => item.entity_id === golden.entity_id,
    );

    expect(row).toBeDefined();
    expect(golden.fee_including_tax_paise).toBe(
      golden.base_fee_paise + golden.tax_paise,
    );
    expect(golden.correct_credit_paise).toBe(
      golden.gross_paise - golden.fee_including_tax_paise,
    );
    expect(golden.incorrect_double_subtract_credit_paise).toBe(
      golden.correct_credit_paise - golden.tax_paise,
    );
    expect(row?.credit).toBe(golden.correct_credit_paise);
  });

  it("contains the required corruption plan, including a genuine K2,2", () => {
    const { publicInputs, truth } = generateSyntheticDataset();
    const requiredTags = [
      "CASE_SPACE_UTR_VARIANT",
      "KNOWN_PREFIX_UTR_VARIANT",
      "MISSING_UTR_NARRATION_EVIDENCE",
      "K2_2_AMBIGUITY",
      "EXACT_UTR_DUPLICATE",
      "PROMPT_INJECTION_NARRATION",
      "DUPLICATE_STABLE_RECON_ID",
      "DUPLICATE_STABLE_LEDGER_ID",
      "PARTIAL_REFUND",
    ];
    for (const tag of requiredTags) {
      expect(truth.feature_tags).toContain(tag);
    }

    const ambiguousSettlements = truth.settlement_truth.filter((row) =>
      row.tags.includes("K2_2_AMBIGUITY"),
    );
    expect(ambiguousSettlements).toHaveLength(2);
    expect(ambiguousSettlements[0]?.calculated_paise).toBe(
      ambiguousSettlements[1]?.calculated_paise,
    );

    const ambiguousBankRows = truth.bank_row_truth
      .filter((row) => row.tags.includes("K2_2_AMBIGUITY"))
      .map((truthRow) =>
        publicInputs.bankStatement.find((row) => row.bank_row_id === truthRow.bank_row_id),
      );
    expect(ambiguousBankRows).toHaveLength(2);
    expect(ambiguousBankRows.every((row) => row?.utr === "1234567890")).toBe(true);
    expect(
      ambiguousSettlements.every((row) => row.settlement_utr.endsWith("1234567890")),
    ).toBe(true);
    expect(ambiguousBankRows[0]?.amount).toBe(ambiguousBankRows[1]?.amount);
    expect(ambiguousBankRows[0]?.posting_date).toBe(ambiguousBankRows[1]?.posting_date);

    const shortImpacts = truth.expected_exceptions
      .filter((row) => row.type === "SHORT_CREDIT")
      .map((row) => row.impact_paise);
    expect(shortImpacts).toEqual(expect.arrayContaining([-1, -50]));
    expect(truth.expected_exceptions.some((row) => row.type === "EXCESS_CREDIT")).toBe(true);
    expect(truth.expected_exceptions.some((row) => row.type === "MISSING_BANK_ENTRY")).toBe(true);
    expect(truth.expected_exceptions.some((row) => row.type === "UNKNOWN_BANK_CREDIT")).toBe(true);
  });

  it("keeps truth in a sibling artifact instead of embedding it in public inputs", () => {
    const generated = generateSyntheticDataset();
    expect(Object.keys(generated.publicInputs).sort()).toEqual([
      "bankStatement",
      "merchantLedger",
      "razorpayRecon",
    ]);
    const publicJson = JSON.stringify(generated.publicInputs);
    expect(publicJson).not.toContain("expected_exceptions");
    expect(publicJson).not.toContain("automatic_match_allowed");
    expect(publicJson).not.toContain("golden_fee_tax");
  });

  it("uses opaque stable ids and includes exact duplicate ids only where planted", () => {
    const { publicInputs } = generateSyntheticDataset();
    const settlementIds = [
      ...new Set(publicInputs.razorpayRecon.items.map((row) => row.settlement_id)),
    ];
    expect(settlementIds.every((id) => /^setl_[a-z0-9]{14}$/.test(id))).toBe(true);
    expect(settlementIds.some((id) => /setl_0{2,}/.test(id))).toBe(false);

    const reconCounts = new Map<string, number>();
    for (const row of publicInputs.razorpayRecon.items) {
      reconCounts.set(row.entity_id, (reconCounts.get(row.entity_id) ?? 0) + 1);
    }
    expect([...reconCounts.values()].filter((count) => count > 1)).toEqual([2]);

    const ledgerCounts = new Map<string, number>();
    for (const row of publicInputs.merchantLedger) {
      ledgerCounts.set(row.ledger_row_id, (ledgerCounts.get(row.ledger_row_id) ?? 0) + 1);
    }
    expect([...ledgerCounts.values()].filter((count) => count > 1)).toEqual([2]);
  });
});
