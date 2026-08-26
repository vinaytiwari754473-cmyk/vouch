export type PaiseValue = string | number | bigint;

export type EvidenceClass = "UNIQUE" | "AMBIGUOUS" | "ABSENT" | "INVALID";
export type LedgerTruth = "VERIFIED" | "EXCEPTION" | "NOT_APPLICABLE";
export type LedgerStatus =
  | "VERIFIED"
  | "MISSING"
  | "MISMATCH"
  | "NOT_APPLICABLE"
  | "INVALID";

export type DecisionStatus =
  | "EXACT_MATCH"
  | "VERIFIED_ASSISTED_MATCH"
  | "AMBIGUOUS"
  | "UNMATCHED"
  | "INVALID_INPUT"
  | "MANUALLY_RESOLVED";

export interface ExceptionInstance {
  readonly category: string;
  readonly primaryOccurrenceId: string;
  readonly relatedOccurrenceId?: string;
  /** Non-negative amount associated with this exception. It is not necessarily financial loss. */
  readonly impactPaise?: PaiseValue;
}

export interface TruthSettlement {
  readonly settlementId: string;
  readonly trueBankRowId: string | null;
  /** Independent oracle amount. Null is permitted only for INVALID truth cases. */
  readonly expectedSettlementPaise: PaiseValue | null;
  /** Whether the public evidence admits one, many, zero, or no valid decisions. */
  readonly evidenceClass: EvidenceClass;
  readonly ledgerTruth: LedgerTruth;
}

export interface TruthBankRow {
  readonly bankRowId: string;
  readonly creditPaise: PaiseValue;
}

export interface EvaluationTruth {
  readonly schemaVersion: "1";
  readonly datasetId: string;
  readonly settlements: readonly TruthSettlement[];
  readonly bankRows: readonly TruthBankRow[];
  readonly exceptions: readonly ExceptionInstance[];
  /** Frozen before the held-out run; never inferred from solver output. */
  readonly aiEligibleSettlementIds: readonly string[];
}

export interface SettlementDecision {
  readonly settlementId: string;
  readonly status: DecisionStatus;
  readonly bankRowId: string | null;
  readonly ledgerStatus: LedgerStatus;
  /** Required and exactly zero for an automatic verification. */
  readonly residualPaise?: PaiseValue;
  readonly hardInvariantFailures?: readonly string[];
}

export interface EvaluationArtifact {
  readonly schemaVersion: "1";
  readonly datasetId: string;
  readonly configId: string;
  readonly decisions: readonly SettlementDecision[];
  readonly exceptions: readonly ExceptionInstance[];
}

export interface ExactRatio {
  readonly numerator: number;
  readonly denominator: number;
  /** Null means the ratio is undefined because its denominator is zero. */
  readonly value: number | null;
}

export interface ExceptionCategoryScore {
  readonly category: string;
  readonly truePositiveCount: number;
  readonly falsePositiveCount: number;
  readonly falseNegativeCount: number;
  readonly precision: ExactRatio;
  readonly recall: ExactRatio;
}

export interface ExceptionScore {
  readonly truePositiveCount: number;
  readonly falsePositiveCount: number;
  readonly falseNegativeCount: number;
  readonly precision: ExactRatio;
  readonly recall: ExactRatio;
  readonly byCategory: readonly ExceptionCategoryScore[];
}

export interface MoneyTotals {
  readonly acceptedAbsoluteResidualPaise: string;
  readonly shortCreditPaise: string;
  readonly excessCreditPaise: string;
  readonly missingSettlementPaise: string;
  readonly unknownBankCreditPaise: string;
}

export interface SettlementOutcome {
  readonly settlementId: string;
  readonly evidenceClass: EvidenceClass;
  readonly predictedStatus: DecisionStatus;
  readonly automatic: boolean;
  readonly correctAutomatic: boolean;
  readonly falseAutomatic: boolean;
  readonly deferred: boolean;
}

export interface EvaluationScore {
  readonly datasetId: string;
  readonly configId: string;
  readonly validSettlementCount: number;
  readonly manualResolutionCount: number;
  readonly automaticallyVerifiedCount: number;
  readonly correctAutomaticVerificationCount: number;
  readonly falseAutomaticVerificationCount: number;
  readonly falseAutomaticVerificationRate: ExactRatio;
  readonly automaticVerificationPrecision: ExactRatio;
  readonly uniqueCaseRecall: ExactRatio;
  readonly automaticCoverage: ExactRatio;
  readonly safeAbstentionPrecision: ExactRatio;
  readonly falseAbstentionRate: ExactRatio;
  readonly ambiguityPrecision: ExactRatio;
  readonly ambiguityRecall: ExactRatio;
  readonly missingBankPrecision: ExactRatio;
  readonly missingBankRecall: ExactRatio;
  /** Wilson two-sided 95% interval's upper endpoint. Null for denominator zero. */
  readonly falseAutomaticVerificationWilsonUpper95: number | null;
  readonly exceptions: ExceptionScore;
  /** Totals emitted by the evaluated artifact. */
  readonly money: MoneyTotals;
  /** Independently-derived totals from truth exceptions for side-by-side reporting. */
  readonly truthMoney: MoneyTotals;
  readonly outcomes: readonly SettlementOutcome[];
}

export interface AiComparison {
  readonly eligibleSettlementCount: number;
  readonly deterministicCorrectCount: number;
  readonly hybridCorrectCount: number;
  readonly resolutionLift: {
    readonly deltaCorrect: number;
    readonly denominator: number;
    readonly value: number | null;
  };
  readonly newFalseAutomaticVerificationCount: number;
  readonly newFalseAutomaticSettlementIds: readonly string[];
  readonly removedFalseAutomaticVerificationCount: number;
  readonly netFalseAutomaticVerificationDelta: number;
}

export interface HeldoutProvenance {
  readonly datasetId: string;
  readonly generatedAtIso: string;
  readonly evaluationFreezeCommit: string;
  readonly generatorCommit: string;
  readonly solverCommit: string;
  readonly evaluatorCommit: string;
  readonly metricsSha256: string;
  readonly promptSha256: string;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly modelConfigSha256: string;
  readonly seedCommitmentSha256: string;
}

export interface HeldoutHashes {
  readonly publicInputsSha256: string;
  readonly truthManifestSha256: string;
  readonly bundleSha256: string;
}

export interface HeldoutBundle<TPublicInputs, TTruthManifest> {
  readonly schemaVersion: "1";
  readonly publicInputs: TPublicInputs;
  readonly truthManifest: TTruthManifest;
  readonly provenance: HeldoutProvenance;
  readonly hashes: HeldoutHashes;
}

export interface PerformanceEnvironment {
  readonly label: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly cpu?: string;
}

export interface PerformanceEnvelope {
  readonly schemaVersion: "1";
  readonly canonicalArtifactSha256: string;
  readonly recordedAtIso: string;
  readonly environment: PerformanceEnvironment;
  readonly warmupRuns: number;
  readonly measuredRuns: number;
  readonly rowCount: number;
  readonly runtimesMs: readonly number[];
  readonly medianRuntimeMs: number;
  readonly p95RuntimeMs: number;
  readonly medianRowsPerSecond: number;
}
