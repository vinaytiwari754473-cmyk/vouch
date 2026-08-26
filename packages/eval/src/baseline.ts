import { toPaiseBigInt } from "./money.js";
import type { PaiseValue } from "./types.js";

export interface BaselineSettlement {
  readonly settlementId: string;
  /** Deliberately raw: the baseline performs no trim, case folding, or extraction. */
  readonly rawUtr: string | null;
  readonly calculatedPaise: PaiseValue;
  readonly currency: string;
}

export interface BaselineBankRow {
  readonly bankRowId: string;
  /** Deliberately raw: the baseline performs no trim, case folding, or extraction. */
  readonly rawUtr: string | null;
  readonly creditPaise: PaiseValue;
  readonly currency: string;
}

export interface BaselinePair {
  readonly settlementId: string;
  readonly bankRowId: string;
}

export interface BaselineMatchResult {
  readonly matches: readonly BaselinePair[];
  readonly ambiguousSettlementIds: readonly string[];
  readonly ambiguousBankRowIds: readonly string[];
  readonly unmatchedSettlementIds: readonly string[];
  readonly unmatchedBankRowIds: readonly string[];
}

/**
 * Honest baseline: literal non-empty UTR equality plus exact amount and currency.
 * A pair is committed only when both endpoints have exactly one candidate.
 */
export function matchLiteralUtrBaseline(
  settlements: readonly BaselineSettlement[],
  bankRows: readonly BaselineBankRow[]
): BaselineMatchResult {
  assertUniqueIds(settlements.map((item) => item.settlementId), "settlementId");
  assertUniqueIds(bankRows.map((item) => item.bankRowId), "bankRowId");

  const settlementCandidates = new Map<string, string[]>();
  const bankCandidates = new Map<string, string[]>();

  for (const settlement of settlements) {
    settlementCandidates.set(settlement.settlementId, []);
  }
  for (const bankRow of bankRows) {
    bankCandidates.set(bankRow.bankRowId, []);
  }

  for (const settlement of settlements) {
    if (settlement.rawUtr === null || settlement.rawUtr.length === 0) {
      continue;
    }
    const settlementAmount = toPaiseBigInt(
      settlement.calculatedPaise,
      `settlement ${settlement.settlementId} amount`
    );

    for (const bankRow of bankRows) {
      if (
        bankRow.rawUtr !== settlement.rawUtr ||
        bankRow.currency !== settlement.currency ||
        toPaiseBigInt(bankRow.creditPaise, `bank row ${bankRow.bankRowId} amount`) !==
          settlementAmount
      ) {
        continue;
      }

      settlementCandidates.get(settlement.settlementId)?.push(bankRow.bankRowId);
      bankCandidates.get(bankRow.bankRowId)?.push(settlement.settlementId);
    }
  }

  const matches: BaselinePair[] = [];
  for (const settlement of settlements) {
    const candidates = settlementCandidates.get(settlement.settlementId) ?? [];
    const bankRowId = candidates[0];
    if (candidates.length !== 1 || bankRowId === undefined) {
      continue;
    }
    if ((bankCandidates.get(bankRowId) ?? []).length !== 1) {
      continue;
    }
    matches.push({ settlementId: settlement.settlementId, bankRowId });
  }

  const matchedSettlements = new Set(matches.map((pair) => pair.settlementId));
  const matchedBanks = new Set(matches.map((pair) => pair.bankRowId));

  return {
    matches: sortPairs(matches),
    ambiguousSettlementIds: settlements
      .filter((item) => !matchedSettlements.has(item.settlementId))
      .filter((item) => (settlementCandidates.get(item.settlementId) ?? []).length > 0)
      .map((item) => item.settlementId)
      .sort(),
    ambiguousBankRowIds: bankRows
      .filter((item) => !matchedBanks.has(item.bankRowId))
      .filter((item) => (bankCandidates.get(item.bankRowId) ?? []).length > 0)
      .map((item) => item.bankRowId)
      .sort(),
    unmatchedSettlementIds: settlements
      .filter((item) => (settlementCandidates.get(item.settlementId) ?? []).length === 0)
      .map((item) => item.settlementId)
      .sort(),
    unmatchedBankRowIds: bankRows
      .filter((item) => (bankCandidates.get(item.bankRowId) ?? []).length === 0)
      .map((item) => item.bankRowId)
      .sort()
  };
}

function sortPairs(pairs: readonly BaselinePair[]): BaselinePair[] {
  return [...pairs].sort(
    (left, right) =>
      left.settlementId.localeCompare(right.settlementId) ||
      left.bankRowId.localeCompare(right.bankRowId)
  );
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id.length === 0) {
      throw new TypeError(`${label} cannot be empty`);
    }
    if (seen.has(id)) {
      throw new TypeError(`duplicate ${label}: ${id}`);
    }
    seen.add(id);
  }
}
