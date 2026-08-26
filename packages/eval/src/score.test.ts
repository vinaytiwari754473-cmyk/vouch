import { describe, expect, it } from "vitest";

import { calculateMoneyTotals, compareAiModes, scoreArtifact, scoreExceptions } from "./score.js";
import type { EvaluationArtifact, EvaluationTruth, SettlementDecision } from "./types.js";

const truth: EvaluationTruth = {
  schemaVersion: "1",
  datasetId: "sealed-001",
  settlements: [
    { settlementId: "s1", trueBankRowId: "b1", expectedSettlementPaise: "100", evidenceClass: "UNIQUE", ledgerTruth: "VERIFIED" },
    { settlementId: "s2", trueBankRowId: "b2", expectedSettlementPaise: "200", evidenceClass: "AMBIGUOUS", ledgerTruth: "VERIFIED" },
    { settlementId: "s3", trueBankRowId: null, expectedSettlementPaise: "2500", evidenceClass: "ABSENT", ledgerTruth: "NOT_APPLICABLE" },
    { settlementId: "s4", trueBankRowId: null, expectedSettlementPaise: null, evidenceClass: "INVALID", ledgerTruth: "EXCEPTION" },
    { settlementId: "s5", trueBankRowId: "b3", expectedSettlementPaise: "300", evidenceClass: "UNIQUE", ledgerTruth: "EXCEPTION" },
    { settlementId: "s6", trueBankRowId: "b4", expectedSettlementPaise: "400", evidenceClass: "UNIQUE", ledgerTruth: "VERIFIED" }
  ],
  bankRows: [
    { bankRowId: "b1", creditPaise: "100" },
    { bankRowId: "b2", creditPaise: "200" },
    { bankRowId: "b3", creditPaise: "300" },
    { bankRowId: "b4", creditPaise: "400" }
  ],
  exceptions: [
    { category: "MISSING_BANK_ENTRY", primaryOccurrenceId: "s3", impactPaise: "2500" },
    { category: "LEDGER_AMOUNT_MISMATCH", primaryOccurrenceId: "s5", impactPaise: "300" }
  ],
  aiEligibleSettlementIds: ["s6"]
};

const deterministicDecisions: readonly SettlementDecision[] = [
  { settlementId: "s1", status: "EXACT_MATCH", bankRowId: "b1", ledgerStatus: "VERIFIED", residualPaise: "0" },
  { settlementId: "s2", status: "AMBIGUOUS", bankRowId: null, ledgerStatus: "VERIFIED" },
  { settlementId: "s3", status: "UNMATCHED", bankRowId: null, ledgerStatus: "NOT_APPLICABLE" },
  { settlementId: "s4", status: "INVALID_INPUT", bankRowId: null, ledgerStatus: "INVALID" },
  { settlementId: "s5", status: "EXACT_MATCH", bankRowId: "b3", ledgerStatus: "VERIFIED", residualPaise: "0" },
  { settlementId: "s6", status: "UNMATCHED", bankRowId: null, ledgerStatus: "VERIFIED" }
];

const deterministicArtifact: EvaluationArtifact = {
  schemaVersion: "1",
  datasetId: "sealed-001",
  configId: "deterministic",
  decisions: deterministicDecisions,
  exceptions: [
    { category: "MISSING_BANK_ENTRY", primaryOccurrenceId: "s3", impactPaise: "2500" },
    { category: "UNKNOWN_BANK_CREDIT", primaryOccurrenceId: "bank-extra", impactPaise: "700" }
  ]
};

describe("artifact scoring", () => {
  it("uses exact, inspectable denominators for safety, coverage, and abstention", () => {
    const score = scoreArtifact(deterministicArtifact, truth);

    expect(score.validSettlementCount).toBe(5);
    expect(score.manualResolutionCount).toBe(0);
    expect(score.automaticallyVerifiedCount).toBe(2);
    expect(score.correctAutomaticVerificationCount).toBe(1);
    expect(score.falseAutomaticVerificationCount).toBe(1);
    expect(score.falseAutomaticVerificationRate).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(score.automaticVerificationPrecision).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(score.uniqueCaseRecall).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(score.automaticCoverage).toEqual({ numerator: 2, denominator: 5, value: 0.4 });
    expect(score.safeAbstentionPrecision).toEqual({ numerator: 2, denominator: 3, value: 2 / 3 });
    expect(score.falseAbstentionRate).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(score.ambiguityPrecision).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(score.ambiguityRecall).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(score.missingBankPrecision).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(score.missingBankRecall).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(score.money.missingSettlementPaise).toBe("2500");
    expect(score.money.unknownBankCreditPaise).toBe("700");
    expect(score.truthMoney.missingSettlementPaise).toBe("2500");
    expect(score.truthMoney.unknownBankCreditPaise).toBe("0");
  });

  it("does not call a bank pair fully verified when the merchant ledger truth fails", () => {
    const score = scoreArtifact(deterministicArtifact, truth);
    const ledgerFailure = score.outcomes.find((item) => item.settlementId === "s5");

    expect(ledgerFailure?.automatic).toBe(true);
    expect(ledgerFailure?.correctAutomatic).toBe(false);
    expect(ledgerFailure?.falseAutomatic).toBe(true);
  });

  it("recomputes zero-paise closure from independent truth instead of trusting the artifact", () => {
    const discrepancyTruth: EvaluationTruth = {
      schemaVersion: "1",
      datasetId: "short-credit",
      settlements: [
        {
          settlementId: "s",
          trueBankRowId: "b",
          expectedSettlementPaise: "100",
          evidenceClass: "UNIQUE",
          ledgerTruth: "VERIFIED"
        }
      ],
      bankRows: [{ bankRowId: "b", creditPaise: "99" }],
      exceptions: [
        {
          category: "SHORT_CREDIT",
          primaryOccurrenceId: "s",
          relatedOccurrenceId: "b",
          impactPaise: "1"
        }
      ],
      aiEligibleSettlementIds: []
    };
    const score = scoreArtifact(
      {
        schemaVersion: "1",
        datasetId: "short-credit",
        configId: "dishonest-artifact",
        decisions: [
          {
            settlementId: "s",
            status: "EXACT_MATCH",
            bankRowId: "b",
            ledgerStatus: "VERIFIED",
            residualPaise: "0"
          }
        ],
        exceptions: []
      },
      discrepancyTruth
    );

    expect(score.correctAutomaticVerificationCount).toBe(0);
    expect(score.falseAutomaticVerificationCount).toBe(1);
    expect(score.uniqueCaseRecall).toEqual({ numerator: 0, denominator: 0, value: null });
  });

  it("scores exception instances by exact category and occurrence IDs", () => {
    const score = scoreExceptions(deterministicArtifact.exceptions, truth.exceptions);

    expect(score.truePositiveCount).toBe(1);
    expect(score.falsePositiveCount).toBe(1);
    expect(score.falseNegativeCount).toBe(1);
    expect(score.precision).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(score.recall).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
  });

  it("keeps discrepancy money categories separate and never nets residual signs", () => {
    const totals = calculateMoneyTotals(
      [
        { settlementId: "a", status: "EXACT_MATCH", bankRowId: "x", ledgerStatus: "VERIFIED", residualPaise: "-5" },
        { settlementId: "b", status: "VERIFIED_ASSISTED_MATCH", bankRowId: "y", ledgerStatus: "VERIFIED", residualPaise: "7" }
      ],
      [
        { category: "SHORT_CREDIT", primaryOccurrenceId: "a", impactPaise: "50" },
        { category: "EXCESS_CREDIT", primaryOccurrenceId: "b", impactPaise: "75" },
        { category: "MISSING_BANK_ENTRY", primaryOccurrenceId: "c", impactPaise: "1000" },
        { category: "UNKNOWN_BANK_CREDIT", primaryOccurrenceId: "d", impactPaise: "900" }
      ]
    );

    expect(totals).toEqual({
      acceptedAbsoluteResidualPaise: "12",
      shortCreditPaise: "50",
      excessCreditPaise: "75",
      missingSettlementPaise: "1000",
      unknownBankCreditPaise: "900"
    });
  });

  it("computes AI lift only over frozen eligible IDs and exposes newly false matches", () => {
    const deterministic = scoreArtifact(deterministicArtifact, truth);
    const hybrid = scoreArtifact(
      {
        ...deterministicArtifact,
        configId: "hybrid",
        decisions: deterministicDecisions.map((decision) => {
          if (decision.settlementId === "s6") {
            return {
              settlementId: "s6",
              status: "VERIFIED_ASSISTED_MATCH" as const,
              bankRowId: "b4",
              ledgerStatus: "VERIFIED" as const,
              residualPaise: "0"
            };
          }
          if (decision.settlementId === "s2") {
            return {
              settlementId: "s2",
              status: "VERIFIED_ASSISTED_MATCH" as const,
              bankRowId: "b2",
              ledgerStatus: "VERIFIED" as const,
              residualPaise: "0"
            };
          }
          return decision;
        })
      },
      truth
    );

    const comparison = compareAiModes(deterministic, hybrid, truth);
    expect(comparison.resolutionLift).toEqual({ deltaCorrect: 1, denominator: 1, value: 1 });
    expect(comparison.newFalseAutomaticSettlementIds).toEqual(["s2"]);
    expect(comparison.newFalseAutomaticVerificationCount).toBe(1);
  });

  it("fails closed on incomplete artifacts and duplicate exception keys", () => {
    expect(() =>
      scoreArtifact(
        { ...deterministicArtifact, decisions: deterministicArtifact.decisions.slice(1) },
        truth
      )
    ).toThrow(/missing settlement decision: s1/);

    expect(() =>
      scoreExceptions(
        [
          { category: "X", primaryOccurrenceId: "row" },
          { category: "X", primaryOccurrenceId: "row" }
        ],
        []
      )
    ).toThrow(/duplicate predicted exception/);
  });

  it("reports undefined—not zero—when there are no automatic decisions", () => {
    const oneTruth: EvaluationTruth = {
      schemaVersion: "1",
      datasetId: "none",
      settlements: [
        { settlementId: "s", trueBankRowId: "b", expectedSettlementPaise: "1", evidenceClass: "UNIQUE", ledgerTruth: "VERIFIED" }
      ],
      bankRows: [{ bankRowId: "b", creditPaise: "1" }],
      exceptions: [],
      aiEligibleSettlementIds: []
    };
    const score = scoreArtifact(
      {
        schemaVersion: "1",
        datasetId: "none",
        configId: "off",
        decisions: [
          { settlementId: "s", status: "UNMATCHED", bankRowId: null, ledgerStatus: "VERIFIED" }
        ],
        exceptions: []
      },
      oneTruth
    );

    expect(score.falseAutomaticVerificationRate).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(score.falseAutomaticVerificationWilsonUpper95).toBeNull();
  });

  it("counts manual resolution as human deferral, never automatic success", () => {
    const oneTruth: EvaluationTruth = {
      schemaVersion: "1",
      datasetId: "manual",
      settlements: [
        { settlementId: "s", trueBankRowId: "b", expectedSettlementPaise: "1", evidenceClass: "UNIQUE", ledgerTruth: "VERIFIED" }
      ],
      bankRows: [{ bankRowId: "b", creditPaise: "1" }],
      exceptions: [],
      aiEligibleSettlementIds: []
    };
    const score = scoreArtifact(
      {
        schemaVersion: "1",
        datasetId: "manual",
        configId: "reviewed",
        decisions: [
          { settlementId: "s", status: "MANUALLY_RESOLVED", bankRowId: "b", ledgerStatus: "VERIFIED" }
        ],
        exceptions: []
      },
      oneTruth
    );

    expect(score.manualResolutionCount).toBe(1);
    expect(score.automaticallyVerifiedCount).toBe(0);
    expect(score.falseAbstentionRate).toEqual({ numerator: 1, denominator: 1, value: 1 });
  });
});
