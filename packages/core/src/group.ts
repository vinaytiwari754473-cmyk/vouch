import { compareCodeUnits } from "./canonical";
import { epochToISTDate } from "./date";
import {
  checkedNonNegative,
  checkedSubtract,
  checkedSum,
  MoneyError,
} from "./money";
import { exactUtrKey } from "./utr";
import type {
  ArithmeticTerm,
  ExceptionCode,
  ISTDate,
  Paise,
  ReconRow,
  RunConfig,
  SettlementEntity,
  SettlementId,
  SourceRow,
} from "./types";

export interface GroupIssue {
  readonly code: ExceptionCode;
  readonly ownerId: string;
  readonly rowIds: readonly SourceRow<unknown>["rowId"][];
  readonly message: string;
}

export interface SettlementGroup {
  readonly settlementId: SettlementId;
  readonly settlementUtr: string | null;
  readonly settledDate: ISTDate | null;
  readonly calculatedPaise: Paise;
  readonly entityAmountPaise: Paise | null;
  readonly rows: readonly SourceRow<ReconRow>[];
  readonly terms: readonly ArithmeticTerm[];
  readonly valid: boolean;
  readonly issues: readonly GroupIssue[];
  readonly warnings: readonly string[];
}

function syntheticRowViolation(row: ReconRow): string | null {
  if (row.tax > row.fee) return "tax component exceeds fee including GST";
  if (row.type === "payment") {
    if (row.credit <= 0 || row.debit !== 0) return "payment must have positive credit and zero debit";
    if (row.credit !== row.amount - row.fee) {
      return "synthetic payment must satisfy credit = amount - fee; tax is not subtracted again";
    }
  }
  if (row.type === "refund") {
    if (row.credit !== 0 || row.debit <= 0) return "refund must have positive debit and zero credit";
    if (row.debit !== row.amount) return "synthetic refund debit must equal refund amount";
  }
  if (row.type === "transfer" && (row.credit !== 0 || row.debit <= 0)) {
    return "synthetic transfer must have positive debit and zero credit";
  }
  if (row.type === "adjustment") {
    const positiveSides = Number(row.credit > 0) + Number(row.debit > 0);
    if (positiveSides !== 1) return "adjustment must affect exactly one side";
  }
  return null;
}

export function groupSettlements(
  reconRows: readonly SourceRow<ReconRow>[],
  settlementEntities: readonly SourceRow<SettlementEntity>[],
  config: RunConfig,
): readonly SettlementGroup[] {
  const entityById = new Map<SettlementId, SourceRow<SettlementEntity>>();
  for (const entity of settlementEntities) entityById.set(entity.value.settlementId, entity);

  const rowsBySettlement = new Map<SettlementId, SourceRow<ReconRow>[]>();
  for (const row of reconRows) {
    const group = rowsBySettlement.get(row.value.settlementId) ?? [];
    group.push(row);
    rowsBySettlement.set(row.value.settlementId, group);
  }

  const output: SettlementGroup[] = [];
  for (const settlementId of [...rowsBySettlement.keys()].sort(compareCodeUnits)) {
    const rows = (rowsBySettlement.get(settlementId) ?? []).sort((left, right) =>
      compareCodeUnits(left.rowId, right.rowId),
    );
    const issues: GroupIssue[] = [];
    const warnings: string[] = [];
    const rowIds = rows.map((row) => row.rowId);

    const distinctUtrs = new Map<string, string>();
    for (const row of rows) {
      const key = exactUtrKey(row.value.settlementUtr);
      if (key !== null) distinctUtrs.set(key, row.value.settlementUtr ?? key);
    }
    if (distinctUtrs.size > 1) {
      issues.push({
        code: "UTR_CONFLICT",
        ownerId: settlementId,
        rowIds,
        message: `Settlement ${settlementId} contains multiple UTR values`,
      });
    }
    const settlementUtr = [...distinctUtrs.values()].sort(compareCodeUnits)[0] ?? null;

    const settledDates = [...new Set(rows.map((row) => epochToISTDate(row.value.settledAt)))].sort(
      compareCodeUnits,
    );
    if (settledDates.length !== 1) {
      issues.push({
        code: "INSUFFICIENT_EVIDENCE",
        ownerId: settlementId,
        rowIds,
        message: `Settlement ${settlementId} does not have one authoritative settled date`,
      });
    }

    const terms: ArithmeticTerm[] = [];
    let calculatedPaise = 0 as Paise;
    try {
      for (const row of rows) {
        terms.push({
          rowId: row.rowId,
          entityId: row.value.entityId,
          creditPaise: row.value.credit,
          debitPaise: row.value.debit,
          contributionPaise: checkedSubtract(
            row.value.credit,
            row.value.debit,
            `contribution for ${row.value.entityId}`,
          ),
        });
      }
      calculatedPaise = checkedNonNegative(
        checkedSum(terms.map((term) => term.contributionPaise), `settlement ${settlementId}`),
        `settlement ${settlementId}`,
      );
      if (calculatedPaise === 0) {
        issues.push({
          code: "GROUP_SUM_MISMATCH",
          ownerId: settlementId,
          rowIds,
          message: `Settlement ${settlementId} has no positive bank-credit amount`,
        });
      }
    } catch (error) {
      issues.push({
        code: "GROUP_SUM_MISMATCH",
        ownerId: settlementId,
        rowIds,
        message: error instanceof MoneyError ? error.message : "settlement arithmetic failed",
      });
    }

    for (const row of rows) {
      const violation = syntheticRowViolation(row.value);
      if (violation === null) continue;
      const detail = `${row.value.entityId}: ${violation}`;
      if (config.inputProfile === "synthetic-v1") {
        issues.push({
          code: "INSUFFICIENT_EVIDENCE",
          ownerId: settlementId,
          rowIds: [row.rowId],
          message: detail,
        });
      } else {
        warnings.push(detail);
      }
    }

    const entity = entityById.get(settlementId)?.value ?? null;
    if (entity !== null && entity.amount !== calculatedPaise) {
      issues.push({
        code: "GROUP_SUM_MISMATCH",
        ownerId: settlementId,
        rowIds,
        message: `Settlement entity amount ${entity.amount} does not equal Σ(credit-debit) ${calculatedPaise}`,
      });
    }

    output.push({
      settlementId,
      settlementUtr,
      settledDate: settledDates.length === 1 ? (settledDates[0] ?? null) : null,
      calculatedPaise,
      entityAmountPaise: entity?.amount ?? null,
      rows,
      terms,
      valid: issues.length === 0,
      issues: issues.sort((left, right) =>
        compareCodeUnits(`${left.code}\u0000${left.message}`, `${right.code}\u0000${right.message}`),
      ),
      warnings: warnings.sort(compareCodeUnits),
    });
  }
  return output;
}
