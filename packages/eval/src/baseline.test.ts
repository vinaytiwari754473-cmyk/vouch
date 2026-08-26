import { describe, expect, it } from "vitest";

import { matchLiteralUtrBaseline } from "./baseline.js";

describe("literal UTR baseline", () => {
  it("matches only literal UTR, exact amount/currency, and mutual degree one", () => {
    const result = matchLiteralUtrBaseline(
      [
        { settlementId: "s1", rawUtr: "UTR-1", calculatedPaise: "10000", currency: "INR" },
        { settlementId: "s2", rawUtr: "UTR-2", calculatedPaise: "20000", currency: "INR" },
        { settlementId: "s3", rawUtr: "UTR-3", calculatedPaise: "30000", currency: "INR" }
      ],
      [
        { bankRowId: "b1", rawUtr: "UTR-1", creditPaise: 10_000, currency: "INR" },
        { bankRowId: "b2", rawUtr: "utr-2", creditPaise: "20000", currency: "INR" },
        { bankRowId: "b3", rawUtr: "UTR-3", creditPaise: "30000", currency: "USD" }
      ]
    );

    expect(result.matches).toEqual([{ settlementId: "s1", bankRowId: "b1" }]);
    expect(result.unmatchedSettlementIds).toEqual(["s2", "s3"]);
    expect(result.unmatchedBankRowIds).toEqual(["b2", "b3"]);
  });

  it("refuses duplicate exact candidates rather than committing by row order", () => {
    const result = matchLiteralUtrBaseline(
      [{ settlementId: "s1", rawUtr: "SAME", calculatedPaise: "5000", currency: "INR" }],
      [
        { bankRowId: "b1", rawUtr: "SAME", creditPaise: "5000", currency: "INR" },
        { bankRowId: "b2", rawUtr: "SAME", creditPaise: "5000", currency: "INR" }
      ]
    );

    expect(result.matches).toEqual([]);
    expect(result.ambiguousSettlementIds).toEqual(["s1"]);
    expect(result.ambiguousBankRowIds).toEqual(["b1", "b2"]);
  });

  it("does not trim, fold case, or match empty UTRs", () => {
    const result = matchLiteralUtrBaseline(
      [
        { settlementId: "s1", rawUtr: " ABC ", calculatedPaise: "100", currency: "INR" },
        { settlementId: "s2", rawUtr: "", calculatedPaise: "200", currency: "INR" }
      ],
      [
        { bankRowId: "b1", rawUtr: "ABC", creditPaise: "100", currency: "INR" },
        { bankRowId: "b2", rawUtr: "", creditPaise: "200", currency: "INR" }
      ]
    );

    expect(result.matches).toEqual([]);
    expect(result.unmatchedSettlementIds).toEqual(["s1", "s2"]);
  });

  it("rejects duplicate IDs and unsafe integer paise", () => {
    expect(() =>
      matchLiteralUtrBaseline(
        [
          { settlementId: "s1", rawUtr: "A", calculatedPaise: "1", currency: "INR" },
          { settlementId: "s1", rawUtr: "B", calculatedPaise: "2", currency: "INR" }
        ],
        []
      )
    ).toThrow(/duplicate settlementId/);

    expect(() =>
      matchLiteralUtrBaseline(
        [
          {
            settlementId: "s1",
            rawUtr: "A",
            calculatedPaise: Number.MAX_SAFE_INTEGER + 1,
            currency: "INR"
          }
        ],
        [{ bankRowId: "b1", rawUtr: "A", creditPaise: "1", currency: "INR" }]
      )
    ).toThrow(/safe integer/);
  });
});
