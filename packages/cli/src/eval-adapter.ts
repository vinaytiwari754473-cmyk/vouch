import {
  caseIdForBank,
  parseMoneyInput,
  type EvidenceRow,
  type ExceptionRecord,
  type JsonObject,
  type RunArtifact
} from "@vouch/core";
import type {
  DecisionStatus,
  EvaluationArtifact,
  EvaluationTruth,
  ExceptionInstance,
  LedgerStatus as EvalLedgerStatus,
  TruthBankRow
} from "@vouch/eval";

export interface GeneratorTruthShape {
  readonly schema_version: "vouch-truth/v1";
  readonly dataset_id: string;
  readonly settlement_truth: readonly {
    readonly settlement_id: string;
    readonly calculated_paise: number;
    readonly true_bank_row_ids: readonly string[];
    readonly expected_deterministic_outcome: "AUTO_MATCH" | "ABSTAIN" | "EXCEPTION";
    readonly expected_hybrid_outcome: "AUTO_MATCH" | "ABSTAIN" | "EXCEPTION";
    readonly tags: readonly string[];
  }[];
  readonly bank_row_truth: readonly {
    readonly bank_row_id: string;
    readonly true_settlement_id: string | null;
    readonly expected_amount_paise: number | null;
  }[];
  readonly expected_exceptions: readonly {
    readonly type: string;
    readonly impact_paise: number | null;
    readonly settlement_ids: readonly string[];
    readonly bank_row_ids: readonly string[];
    readonly recon_entity_ids: readonly string[];
    readonly merchant_row_ids: readonly string[];
  }[];
}

export function adaptGeneratorTruth(
  truth: GeneratorTruthShape,
  publicBankRows: readonly JsonObject[]
): EvaluationTruth {
  const expectedBySettlement = new Map<string, Set<string>>();
  for (const exception of truth.expected_exceptions) {
    for (const settlementId of exception.settlement_ids) {
      const categories = expectedBySettlement.get(settlementId) ?? new Set<string>();
      categories.add(exception.type);
      expectedBySettlement.set(settlementId, categories);
    }
  }
  const bankPublic = new Map<string, JsonObject>();
  for (const row of publicBankRows) {
    const id = stringField(row, "bank_row_ref") ?? stringField(row, "bank_row_id");
    if (id !== null) bankPublic.set(id, row);
  }
  const bankRows: TruthBankRow[] = truth.bank_row_truth.map((item) => {
    const row = bankPublic.get(item.bank_row_id);
    let creditPaise = "0";
    if (row !== undefined) {
      try {
        creditPaise = String(parseMoneyInput(row.amount, `bank ${item.bank_row_id} amount`));
      } catch {
        creditPaise = "0";
      }
    }
    return { bankRowId: item.bank_row_id, creditPaise };
  });

  const settlements = truth.settlement_truth.map((item) => {
    const categories = expectedBySettlement.get(item.settlement_id) ?? new Set<string>();
    const ledgerException =
      categories.has("MISSING_MERCHANT_LEDGER_RECORD") ||
      categories.has("LEDGER_AMOUNT_MISMATCH");
    const linkedDiscrepancy =
      categories.has("SHORT_CREDIT") || categories.has("EXCESS_CREDIT") || ledgerException;
    const evidenceClass =
      item.expected_hybrid_outcome === "AUTO_MATCH"
        ? "UNIQUE"
        : item.expected_hybrid_outcome === "ABSTAIN"
          ? "AMBIGUOUS"
          : linkedDiscrepancy
            ? "UNIQUE"
            : "ABSENT";
    const candidateBank = item.true_bank_row_ids[0] ?? null;
    return {
      settlementId: item.settlement_id,
      trueBankRowId: evidenceClass === "ABSENT" ? null : candidateBank,
      expectedSettlementPaise: String(item.calculated_paise),
      evidenceClass,
      ledgerTruth: ledgerException ? "EXCEPTION" : "VERIFIED"
    } as const;
  });

  return {
    schemaVersion: "1",
    datasetId: truth.dataset_id,
    settlements,
    bankRows,
    exceptions: truth.expected_exceptions.map(adaptTruthException),
    aiEligibleSettlementIds: truth.settlement_truth
      .filter(
        (item) =>
          item.expected_deterministic_outcome !== "AUTO_MATCH" &&
          item.expected_hybrid_outcome === "AUTO_MATCH"
      )
      .map((item) => item.settlement_id)
      .sort()
  };
}

export function adaptRunArtifact(
  artifact: RunArtifact,
  datasetId: string,
  configId = artifact.config.mode
): EvaluationArtifact {
  const sourceRows = new Map(artifact.sourceRows.map((row) => [row.rowId, row]));
  const settlementCases = new Map(
    artifact.settlements.map((settlement) => [settlement.caseId, settlement.settlementId])
  );
  const bankCases = new Map(
    artifact.bankEntries.map((bank) => [caseIdForBank(bank.bankEntryId), bank.bankEntryId])
  );

  return {
    schemaVersion: "1",
    datasetId,
    configId,
    decisions: artifact.settlements.map((settlement) => ({
      settlementId: settlement.settlementId,
      status: settlement.overallStatus as DecisionStatus,
      bankRowId: settlement.bankEntryId,
      ledgerStatus: adaptLedgerStatus(settlement.ledgerStatus),
      ...(settlement.equation === null
        ? {}
        : { residualPaise: String(settlement.equation.residualPaise) }),
      hardInvariantFailures: []
    })),
    exceptions: artifact.exceptions.map((exception) =>
      adaptPredictedException(exception, sourceRows, settlementCases, bankCases)
    )
  };
}

function adaptLedgerStatus(status: RunArtifact["settlements"][number]["ledgerStatus"]): EvalLedgerStatus {
  if (status === "VERIFIED") return "VERIFIED";
  if (status === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (status === "MISSING_MERCHANT_RECORD" || status === "MISSING_RAZORPAY_ROW") return "MISSING";
  if (status === "AMOUNT_MISMATCH" || status === "AMBIGUOUS_REFERENCE") return "MISMATCH";
  return "INVALID";
}

function adaptTruthException(
  exception: GeneratorTruthShape["expected_exceptions"][number]
): ExceptionInstance {
  const primaryOccurrenceId =
    exception.type === "AMBIGUOUS_CANDIDATES" &&
    exception.settlement_ids.length > 1 &&
    exception.bank_row_ids.length === 1
      ? exception.bank_row_ids[0] ?? "unknown"
      : choosePrimary(
          exception.type,
          exception.settlement_ids,
          exception.bank_row_ids,
          exception.recon_entity_ids,
          exception.merchant_row_ids
        );
  return {
    category: exception.type,
    primaryOccurrenceId,
    ...(exception.impact_paise === null
      ? {}
      : { impactPaise: String(Math.abs(exception.impact_paise)) })
  };
}

function adaptPredictedException(
  exception: ExceptionRecord,
  sourceRows: ReadonlyMap<string, EvidenceRow>,
  settlementCases: ReadonlyMap<string, string>,
  bankCases: ReadonlyMap<string, string>
): ExceptionInstance {
  const settlementId = settlementCases.get(exception.caseId);
  const bankId = bankCases.get(exception.caseId);
  const owners = exception.evidenceRowIds
    .map((rowId) => sourceRows.get(rowId))
    .filter((row): row is EvidenceRow => row !== undefined)
    .map(sourceOwner);
  const primaryOccurrenceId =
    settlementId ??
    bankId ??
    choosePrimary(
      exception.code,
      owners.filter((owner) => owner.source === "SETTLEMENT").map((owner) => owner.id),
      owners.filter((owner) => owner.source === "BANK").map((owner) => owner.id),
      owners.filter((owner) => owner.source === "RAZORPAY").map((owner) => owner.id),
      owners.filter((owner) => owner.source === "MERCHANT").map((owner) => owner.id),
      exception.caseId
    );
  return {
    category: exception.code,
    primaryOccurrenceId,
    ...(exception.impactPaise === null
      ? {}
      : { impactPaise: String(Math.abs(exception.impactPaise)) })
  };
}

function sourceOwner(row: EvidenceRow): { source: EvidenceRow["source"]; id: string } {
  const candidates =
    row.source === "BANK"
      ? ["bank_row_ref", "bank_row_id"]
      : row.source === "MERCHANT"
        ? ["record_id", "ledger_row_id"]
        : row.source === "RAZORPAY"
          ? ["entity_id"]
          : ["settlement_id"];
  for (const key of candidates) {
    const value = stringField(row.raw, key);
    if (value !== null) return { source: row.source, id: value };
  }
  return { source: row.source, id: row.rowId };
}

function choosePrimary(
  category: string,
  settlements: readonly string[],
  banks: readonly string[],
  recon: readonly string[],
  merchants: readonly string[],
  fallback = "unknown"
): string {
  const bankFirst = new Set([
    "UNKNOWN_BANK_CREDIT",
    "DUPLICATE_BANK_ENTRY",
    "CURRENCY_MISMATCH",
    "MALFORMED_AMOUNT"
  ]);
  const merchantFirst = new Set(["MISSING_RAZORPAY_ROW", "DUPLICATE_IMPORT"]);
  const groups = bankFirst.has(category)
    ? [banks, settlements, recon, merchants]
    : merchantFirst.has(category)
      ? [merchants, settlements, recon, banks]
      : [settlements, banks, recon, merchants];
  for (const values of groups) {
    const candidate = [...values].sort()[0];
    if (candidate !== undefined) return candidate;
  }
  return fallback;
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
