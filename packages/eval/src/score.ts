import { absolute, requireNonNegativePaise, toPaiseBigInt } from "./money.js";
import { exactRatio, wilsonUpperBound95 } from "./ratio.js";
import type {
  AiComparison,
  EvaluationArtifact,
  EvaluationScore,
  EvaluationTruth,
  ExceptionCategoryScore,
  ExceptionInstance,
  ExceptionScore,
  MoneyTotals,
  SettlementDecision,
  SettlementOutcome,
  TruthBankRow,
  TruthSettlement
} from "./types.js";

const AUTOMATIC_STATUSES = new Set(["EXACT_MATCH", "VERIFIED_ASSISTED_MATCH"]);
const DEFERRED_STATUSES = new Set(["AMBIGUOUS", "UNMATCHED", "MANUALLY_RESOLVED"]);
const MONEY_CATEGORIES = new Set([
  "SHORT_CREDIT",
  "EXCESS_CREDIT",
  "MISSING_BANK_ENTRY",
  "UNKNOWN_BANK_CREDIT"
]);

export function scoreArtifact(
  artifact: EvaluationArtifact,
  truth: EvaluationTruth
): EvaluationScore {
  const { truthBySettlement, truthBankById, decisionBySettlement } = validateAndIndex(
    artifact,
    truth
  );
  const outcomes: SettlementOutcome[] = [];

  let validSettlementCount = 0;
  let manualResolutionCount = 0;
  let automaticOnValidCount = 0;
  let automaticallyVerifiedCount = 0;
  let correctAutomaticVerificationCount = 0;
  let falseAutomaticVerificationCount = 0;
  let uniquelyFullyVerifiableCount = 0;
  let deferredCount = 0;
  let safeDeferredCount = 0;
  let falseAbstentionCount = 0;
  let predictedAmbiguousCount = 0;
  let correctlyPredictedAmbiguousCount = 0;
  let truthAmbiguousCount = 0;
  let predictedMissingCount = 0;
  let correctlyPredictedMissingCount = 0;
  let truthMissingCount = 0;

  for (const settlementId of [...truthBySettlement.keys()].sort()) {
    const settlementTruth = truthBySettlement.get(settlementId);
    const decision = decisionBySettlement.get(settlementId);
    if (settlementTruth === undefined || decision === undefined) {
      throw new Error(`internal indexing error for settlement ${settlementId}`);
    }

    const automatic = isAutomatic(decision);
    const uniquelyFullyVerifiable = isUniquelyFullyVerifiable(
      settlementTruth,
      truthBankById
    );
    const correctAutomatic =
      automatic && isCorrectAutomatic(decision, settlementTruth, truthBankById);
    const falseAutomatic = automatic && !correctAutomatic;
    const deferred = DEFERRED_STATUSES.has(decision.status);

    if (settlementTruth.evidenceClass !== "INVALID") {
      validSettlementCount += 1;
      if (automatic) {
        automaticOnValidCount += 1;
      }
    }
    if (automatic) {
      automaticallyVerifiedCount += 1;
    }
    if (decision.status === "MANUALLY_RESOLVED") {
      manualResolutionCount += 1;
    }
    if (correctAutomatic) {
      correctAutomaticVerificationCount += 1;
    }
    if (falseAutomatic) {
      falseAutomaticVerificationCount += 1;
    }
    if (uniquelyFullyVerifiable) {
      uniquelyFullyVerifiableCount += 1;
      if (deferred) {
        falseAbstentionCount += 1;
      }
    }
    if (deferred) {
      deferredCount += 1;
      if (!uniquelyFullyVerifiable) {
        safeDeferredCount += 1;
      }
    }
    if (settlementTruth.evidenceClass === "AMBIGUOUS") {
      truthAmbiguousCount += 1;
    }
    if (decision.status === "AMBIGUOUS") {
      predictedAmbiguousCount += 1;
      if (settlementTruth.evidenceClass === "AMBIGUOUS") {
        correctlyPredictedAmbiguousCount += 1;
      }
    }
    if (settlementTruth.evidenceClass === "ABSENT") {
      truthMissingCount += 1;
    }
    if (decision.status === "UNMATCHED") {
      predictedMissingCount += 1;
      if (settlementTruth.evidenceClass === "ABSENT") {
        correctlyPredictedMissingCount += 1;
      }
    }

    outcomes.push({
      settlementId,
      evidenceClass: settlementTruth.evidenceClass,
      predictedStatus: decision.status,
      automatic,
      correctAutomatic,
      falseAutomatic,
      deferred
    });
  }

  return {
    datasetId: truth.datasetId,
    configId: artifact.configId,
    validSettlementCount,
    manualResolutionCount,
    automaticallyVerifiedCount,
    correctAutomaticVerificationCount,
    falseAutomaticVerificationCount,
    falseAutomaticVerificationRate: exactRatio(
      falseAutomaticVerificationCount,
      automaticallyVerifiedCount
    ),
    automaticVerificationPrecision: exactRatio(
      correctAutomaticVerificationCount,
      automaticallyVerifiedCount
    ),
    uniqueCaseRecall: exactRatio(
      correctAutomaticVerificationCount,
      uniquelyFullyVerifiableCount
    ),
    automaticCoverage: exactRatio(automaticOnValidCount, validSettlementCount),
    safeAbstentionPrecision: exactRatio(safeDeferredCount, deferredCount),
    falseAbstentionRate: exactRatio(falseAbstentionCount, uniquelyFullyVerifiableCount),
    ambiguityPrecision: exactRatio(
      correctlyPredictedAmbiguousCount,
      predictedAmbiguousCount
    ),
    ambiguityRecall: exactRatio(correctlyPredictedAmbiguousCount, truthAmbiguousCount),
    missingBankPrecision: exactRatio(correctlyPredictedMissingCount, predictedMissingCount),
    missingBankRecall: exactRatio(correctlyPredictedMissingCount, truthMissingCount),
    falseAutomaticVerificationWilsonUpper95: wilsonUpperBound95(
      falseAutomaticVerificationCount,
      automaticallyVerifiedCount
    ),
    exceptions: scoreExceptions(artifact.exceptions, truth.exceptions),
    money: calculateMoneyTotals(artifact.decisions, artifact.exceptions),
    truthMoney: calculateMoneyTotals([], truth.exceptions),
    outcomes
  };
}

export function compareAiModes(
  deterministic: EvaluationScore,
  hybrid: EvaluationScore,
  truth: EvaluationTruth
): AiComparison {
  if (deterministic.datasetId !== truth.datasetId || hybrid.datasetId !== truth.datasetId) {
    throw new TypeError("AI comparison dataset IDs must match the truth dataset ID");
  }

  const truthIds = new Set(truth.settlements.map((settlement) => settlement.settlementId));
  const eligibleIds = uniqueStrings(truth.aiEligibleSettlementIds, "AI-eligible settlement ID");
  for (const settlementId of eligibleIds) {
    if (!truthIds.has(settlementId)) {
      throw new TypeError(`unknown AI-eligible settlement ID: ${settlementId}`);
    }
  }

  const deterministicOutcomes = indexOutcomes(deterministic);
  const hybridOutcomes = indexOutcomes(hybrid);
  const deterministicCorrectCount = eligibleIds.filter(
    (id) => deterministicOutcomes.get(id)?.correctAutomatic === true
  ).length;
  const hybridCorrectCount = eligibleIds.filter(
    (id) => hybridOutcomes.get(id)?.correctAutomatic === true
  ).length;
  const deltaCorrect = hybridCorrectCount - deterministicCorrectCount;

  const deterministicFalse = new Set(
    deterministic.outcomes.filter((item) => item.falseAutomatic).map((item) => item.settlementId)
  );
  const hybridFalse = new Set(
    hybrid.outcomes.filter((item) => item.falseAutomatic).map((item) => item.settlementId)
  );
  const newFalseAutomaticSettlementIds = [...hybridFalse]
    .filter((id) => !deterministicFalse.has(id))
    .sort();
  const removedFalseAutomaticCount = [...deterministicFalse].filter(
    (id) => !hybridFalse.has(id)
  ).length;

  return {
    eligibleSettlementCount: eligibleIds.length,
    deterministicCorrectCount,
    hybridCorrectCount,
    resolutionLift: {
      deltaCorrect,
      denominator: eligibleIds.length,
      value: eligibleIds.length === 0 ? null : deltaCorrect / eligibleIds.length
    },
    newFalseAutomaticVerificationCount: newFalseAutomaticSettlementIds.length,
    newFalseAutomaticSettlementIds,
    removedFalseAutomaticVerificationCount: removedFalseAutomaticCount,
    netFalseAutomaticVerificationDelta:
      hybridFalse.size - deterministicFalse.size
  };
}

export function scoreExceptions(
  predicted: readonly ExceptionInstance[],
  truth: readonly ExceptionInstance[]
): ExceptionScore {
  const predictedByKey = indexExceptions(predicted, "predicted exception");
  const truthByKey = indexExceptions(truth, "truth exception");
  const categories = new Set<string>();
  for (const item of predicted) categories.add(item.category);
  for (const item of truth) categories.add(item.category);

  const truePositiveKeys = [...predictedByKey.keys()].filter((key) => truthByKey.has(key));
  const falsePositiveCount = predictedByKey.size - truePositiveKeys.length;
  const falseNegativeCount = truthByKey.size - truePositiveKeys.length;

  const byCategory: ExceptionCategoryScore[] = [...categories]
    .sort()
    .map((category) => {
      const categoryPredicted = new Set(
        predicted
          .filter((item) => item.category === category)
          .map((item) => exceptionKey(item))
      );
      const categoryTruth = new Set(
        truth.filter((item) => item.category === category).map((item) => exceptionKey(item))
      );
      const truePositiveCount = [...categoryPredicted].filter((key) => categoryTruth.has(key)).length;
      const categoryFalsePositiveCount = categoryPredicted.size - truePositiveCount;
      const categoryFalseNegativeCount = categoryTruth.size - truePositiveCount;

      return {
        category,
        truePositiveCount,
        falsePositiveCount: categoryFalsePositiveCount,
        falseNegativeCount: categoryFalseNegativeCount,
        precision: exactRatio(truePositiveCount, categoryPredicted.size),
        recall: exactRatio(truePositiveCount, categoryTruth.size)
      };
    });

  return {
    truePositiveCount: truePositiveKeys.length,
    falsePositiveCount,
    falseNegativeCount,
    precision: exactRatio(truePositiveKeys.length, predictedByKey.size),
    recall: exactRatio(truePositiveKeys.length, truthByKey.size),
    byCategory
  };
}

export function calculateMoneyTotals(
  decisions: readonly SettlementDecision[],
  exceptions: readonly ExceptionInstance[]
): MoneyTotals {
  let acceptedAbsoluteResidualPaise = 0n;
  let shortCreditPaise = 0n;
  let excessCreditPaise = 0n;
  let missingSettlementPaise = 0n;
  let unknownBankCreditPaise = 0n;

  for (const decision of decisions) {
    if (isAutomatic(decision) && decision.residualPaise !== undefined) {
      acceptedAbsoluteResidualPaise += absolute(
        toPaiseBigInt(decision.residualPaise, `decision ${decision.settlementId} residual`)
      );
    }
  }

  const indexed = indexExceptions(exceptions, "money exception");
  for (const item of indexed.values()) {
    if (!MONEY_CATEGORIES.has(item.category)) {
      continue;
    }
    if (item.impactPaise === undefined) {
      throw new TypeError(`${item.category} requires impactPaise`);
    }
    const impact = requireNonNegativePaise(item.impactPaise, `${item.category} impactPaise`);
    if (item.category === "SHORT_CREDIT") shortCreditPaise += impact;
    if (item.category === "EXCESS_CREDIT") excessCreditPaise += impact;
    if (item.category === "MISSING_BANK_ENTRY") missingSettlementPaise += impact;
    if (item.category === "UNKNOWN_BANK_CREDIT") unknownBankCreditPaise += impact;
  }

  return {
    acceptedAbsoluteResidualPaise: acceptedAbsoluteResidualPaise.toString(),
    shortCreditPaise: shortCreditPaise.toString(),
    excessCreditPaise: excessCreditPaise.toString(),
    missingSettlementPaise: missingSettlementPaise.toString(),
    unknownBankCreditPaise: unknownBankCreditPaise.toString()
  };
}

export function exceptionKey(item: ExceptionInstance): string {
  return JSON.stringify([
    item.category,
    item.primaryOccurrenceId,
    item.relatedOccurrenceId ?? null
  ]);
}

function validateAndIndex(
  artifact: EvaluationArtifact,
  truth: EvaluationTruth
): {
  truthBySettlement: Map<string, TruthSettlement>;
  truthBankById: Map<string, TruthBankRow>;
  decisionBySettlement: Map<string, SettlementDecision>;
} {
  if (artifact.datasetId !== truth.datasetId) {
    throw new TypeError("artifact and truth dataset IDs must match");
  }

  const truthBySettlement = indexByUniqueId(
    truth.settlements,
    (item) => item.settlementId,
    "truth settlement"
  );
  const decisionBySettlement = indexByUniqueId(
    artifact.decisions,
    (item) => item.settlementId,
    "artifact decision"
  );
  const truthBankById = indexByUniqueId(
    truth.bankRows,
    (item) => item.bankRowId,
    "truth bank row"
  );
  const bankIds = new Set(truthBankById.keys());

  for (const bankRow of truth.bankRows) {
    requireNonNegativePaise(bankRow.creditPaise, `truth bank row ${bankRow.bankRowId} credit`);
  }

  for (const settlement of truth.settlements) {
    if (settlement.evidenceClass === "UNIQUE" && settlement.trueBankRowId === null) {
      throw new TypeError(`UNIQUE settlement ${settlement.settlementId} requires trueBankRowId`);
    }
    if (settlement.evidenceClass === "ABSENT" && settlement.trueBankRowId !== null) {
      throw new TypeError(`ABSENT settlement ${settlement.settlementId} cannot have trueBankRowId`);
    }
    if (settlement.trueBankRowId !== null && !bankIds.has(settlement.trueBankRowId)) {
      throw new TypeError(
        `truth settlement ${settlement.settlementId} references unknown bank row ${settlement.trueBankRowId}`
      );
    }
    if (settlement.evidenceClass !== "INVALID" && settlement.expectedSettlementPaise === null) {
      throw new TypeError(
        `non-INVALID settlement ${settlement.settlementId} requires expectedSettlementPaise`
      );
    }
    if (settlement.expectedSettlementPaise !== null) {
      requireNonNegativePaise(
        settlement.expectedSettlementPaise,
        `truth settlement ${settlement.settlementId} expected amount`
      );
    }
  }

  for (const decisionId of decisionBySettlement.keys()) {
    if (!truthBySettlement.has(decisionId)) {
      throw new TypeError(`artifact contains unknown settlement decision: ${decisionId}`);
    }
  }
  for (const truthId of truthBySettlement.keys()) {
    if (!decisionBySettlement.has(truthId)) {
      throw new TypeError(`artifact is missing settlement decision: ${truthId}`);
    }
  }

  uniqueStrings(truth.aiEligibleSettlementIds, "AI-eligible settlement ID");
  indexExceptions(artifact.exceptions, "predicted exception");
  indexExceptions(truth.exceptions, "truth exception");

  return { truthBySettlement, truthBankById, decisionBySettlement };
}

function isAutomatic(decision: SettlementDecision): boolean {
  return AUTOMATIC_STATUSES.has(decision.status);
}

function isUniquelyFullyVerifiable(
  truth: TruthSettlement,
  truthBankById: ReadonlyMap<string, TruthBankRow>
): boolean {
  if (
    truth.evidenceClass !== "UNIQUE" ||
    truth.trueBankRowId === null ||
    truth.expectedSettlementPaise === null ||
    truth.ledgerTruth === "EXCEPTION"
  ) {
    return false;
  }
  const bankRow = truthBankById.get(truth.trueBankRowId);
  if (bankRow === undefined) {
    return false;
  }
  return (
    toPaiseBigInt(bankRow.creditPaise) === toPaiseBigInt(truth.expectedSettlementPaise)
  );
}

function isCorrectAutomatic(
  decision: SettlementDecision,
  truth: TruthSettlement,
  truthBankById: ReadonlyMap<string, TruthBankRow>
): boolean {
  if (
    !isUniquelyFullyVerifiable(truth, truthBankById) ||
    decision.bankRowId !== truth.trueBankRowId ||
    truth.trueBankRowId === null ||
    truth.expectedSettlementPaise === null
  ) {
    return false;
  }
  const truthBank = truthBankById.get(truth.trueBankRowId);
  if (truthBank === undefined) {
    return false;
  }
  const independentResidual =
    toPaiseBigInt(truthBank.creditPaise) - toPaiseBigInt(truth.expectedSettlementPaise);
  if (
    independentResidual !== 0n ||
    decision.residualPaise === undefined ||
    toPaiseBigInt(decision.residualPaise) !== independentResidual
  ) {
    return false;
  }
  if ((decision.hardInvariantFailures?.length ?? 0) !== 0) {
    return false;
  }
  if (truth.ledgerTruth === "VERIFIED") {
    return decision.ledgerStatus === "VERIFIED";
  }
  return decision.ledgerStatus === "NOT_APPLICABLE";
}

function indexExceptions(
  items: readonly ExceptionInstance[],
  label: string
): Map<string, ExceptionInstance> {
  const result = new Map<string, ExceptionInstance>();
  for (const item of items) {
    if (item.category.length === 0 || item.primaryOccurrenceId.length === 0) {
      throw new TypeError(`${label} category and primaryOccurrenceId cannot be empty`);
    }
    const key = exceptionKey(item);
    if (result.has(key)) {
      throw new TypeError(`duplicate ${label}: ${key}`);
    }
    result.set(key, item);
  }
  return result;
}

function indexByUniqueId<T>(
  values: readonly T[],
  idOf: (value: T) => string,
  label: string
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = idOf(value);
    if (id.length === 0) {
      throw new TypeError(`${label} ID cannot be empty`);
    }
    if (result.has(id)) {
      throw new TypeError(`duplicate ${label} ID: ${id}`);
    }
    result.set(id, value);
  }
  return result;
}

function uniqueStrings(values: readonly string[], label: string): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value.length === 0) {
      throw new TypeError(`${label} cannot be empty`);
    }
    if (seen.has(value)) {
      throw new TypeError(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
  return [...seen];
}

function indexOutcomes(score: EvaluationScore): Map<string, SettlementOutcome> {
  return indexByUniqueId(score.outcomes, (item) => item.settlementId, "scored outcome");
}
