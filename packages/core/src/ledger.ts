import { compareCodeUnits } from "./canonical";
import type { SettlementGroup } from "./group";
import type {
  ExceptionCode,
  LedgerStatus,
  MerchantRecord,
  ReconRow,
  SettlementId,
  SourceRow,
} from "./types";

export interface LedgerIssue {
  readonly code: ExceptionCode;
  readonly settlementId: SettlementId | null;
  readonly ownerId: string;
  readonly rowIds: readonly SourceRow<unknown>["rowId"][];
  readonly message: string;
}

export interface MerchantCheck {
  readonly row: SourceRow<MerchantRecord>;
  readonly reconRow: SourceRow<ReconRow> | null;
  readonly settlementId: SettlementId | null;
  readonly status: LedgerStatus;
}

export interface LedgerCheckResult {
  readonly merchants: readonly MerchantCheck[];
  readonly groupStatuses: ReadonlyMap<SettlementId, LedgerStatus>;
  readonly merchantRowIdsBySettlement: ReadonlyMap<SettlementId, readonly SourceRow<unknown>["rowId"][]>;
  readonly ledgerPresentSettlementIds: ReadonlySet<SettlementId>;
  readonly issues: readonly LedgerIssue[];
}

function directMerchantKey(record: MerchantRecord): string | null {
  const direct = record.entityRef ?? (record.type === "payment" ? record.paymentRef : null);
  return direct === null ? null : `${record.type}\u0000${direct}`;
}

function directReconKey(record: ReconRow): string {
  return `${record.type}\u0000${record.entityId}`;
}

function statusPriority(status: LedgerStatus): number {
  switch (status) {
    case "INVALID":
      return 6;
    case "AMBIGUOUS_REFERENCE":
      return 5;
    case "AMOUNT_MISMATCH":
      return 4;
    case "MISSING_MERCHANT_RECORD":
    case "MISSING_RAZORPAY_ROW":
      return 3;
    case "VERIFIED":
      return 2;
    case "NOT_APPLICABLE":
      return 1;
  }
}

export function checkMerchantLedger(
  groups: readonly SettlementGroup[],
  merchantRows: readonly SourceRow<MerchantRecord>[],
): LedgerCheckResult {
  const reconRows = groups.flatMap((group) => group.rows);
  const groupByReconRow = new Map(
    groups.flatMap((group) => group.rows.map((row) => [row.rowId, group.settlementId] as const)),
  );
  const merchantByDirect = new Map<string, SourceRow<MerchantRecord>[]>();
  const merchantsByOrder = new Map<string, SourceRow<MerchantRecord>[]>();
  for (const row of merchantRows) {
    const key = directMerchantKey(row.value);
    if (key !== null) {
      const values = merchantByDirect.get(key) ?? [];
      values.push(row);
      merchantByDirect.set(key, values);
    }
    if (row.value.orderRef !== null) {
      const orderKey = `${row.value.type}\u0000${row.value.orderRef}`;
      const values = merchantsByOrder.get(orderKey) ?? [];
      values.push(row);
      merchantsByOrder.set(orderKey, values);
    }
  }

  const reconByOrder = new Map<string, SourceRow<ReconRow>[]>();
  for (const row of reconRows) {
    if (row.value.orderId === null) continue;
    const key = `${row.value.type}\u0000${row.value.orderId}`;
    const values = reconByOrder.get(key) ?? [];
    values.push(row);
    reconByOrder.set(key, values);
  }

  const issues: LedgerIssue[] = [];
  const matchedMerchantRows = new Set<SourceRow<unknown>["rowId"]>();
  const checksByMerchant = new Map<SourceRow<unknown>["rowId"], MerchantCheck>();
  const reconStatusByGroup = new Map<SettlementId, LedgerStatus[]>();

  for (const recon of [...reconRows].sort((left, right) => compareCodeUnits(left.rowId, right.rowId))) {
    const settlementId = groupByReconRow.get(recon.rowId) ?? null;
    if (settlementId === null) continue;
    const applicable = recon.value.type === "payment" || recon.value.type === "refund";
    if (!applicable) {
      // Non-payment rows are outside the ledger-verification verdict, but an
      // explicitly linked merchant occurrence is still present evidence. Mark it
      // consumed so it cannot later become a false MISSING_RAZORPAY_ROW issue.
      const counterparts = (merchantByDirect.get(directReconKey(recon.value)) ?? []).filter(
        (candidate) => !matchedMerchantRows.has(candidate.rowId),
      );
      for (const counterpart of counterparts) {
        matchedMerchantRows.add(counterpart.rowId);
        checksByMerchant.set(counterpart.rowId, {
          row: counterpart,
          reconRow: recon,
          settlementId,
          status: "NOT_APPLICABLE",
        });
      }
      const statuses = reconStatusByGroup.get(settlementId) ?? [];
      statuses.push("NOT_APPLICABLE");
      reconStatusByGroup.set(settlementId, statuses);
      continue;
    }

    let candidates = merchantByDirect.get(directReconKey(recon.value)) ?? [];
    if (candidates.length === 0 && recon.value.orderId !== null) {
      const orderKey = `${recon.value.type}\u0000${recon.value.orderId}`;
      // An order may supply missing identity; it cannot override a contradictory explicit identity.
      const merchantCandidates = (merchantsByOrder.get(orderKey) ?? []).filter(
        (candidate) => directMerchantKey(candidate.value) === null,
      );
      const reconCandidates = reconByOrder.get(orderKey) ?? [];
      if (merchantCandidates.length === 1 && reconCandidates.length === 1) {
        candidates = merchantCandidates;
      }
    }
    candidates = candidates.filter((candidate) => !matchedMerchantRows.has(candidate.rowId));

    let status: LedgerStatus;
    if (candidates.length === 0) {
      status = "MISSING_MERCHANT_RECORD";
      issues.push({
        code: "MISSING_MERCHANT_LEDGER_RECORD",
        settlementId,
        ownerId: recon.value.entityId,
        rowIds: [recon.rowId],
        message: `No scoped merchant-ledger row references Razorpay ${recon.value.type} ${recon.value.entityId}`,
      });
    } else if (candidates.length > 1) {
      status = "AMBIGUOUS_REFERENCE";
      issues.push({
        code: "INSUFFICIENT_EVIDENCE",
        settlementId,
        ownerId: recon.value.entityId,
        rowIds: [recon.rowId, ...candidates.map((candidate) => candidate.rowId)],
        message: `Multiple merchant-ledger rows can reference ${recon.value.entityId}`,
      });
      for (const candidate of candidates) {
        checksByMerchant.set(candidate.rowId, {
          row: candidate,
          reconRow: recon,
          settlementId,
          status,
        });
        matchedMerchantRows.add(candidate.rowId);
      }
    } else {
      const candidate = candidates[0];
      if (candidate === undefined) throw new Error("ledger candidate invariant failed");
      matchedMerchantRows.add(candidate.rowId);
      const contradictsPayment = recon.value.type === "payment"
        && candidate.value.paymentRef !== null && candidate.value.paymentRef !== recon.value.entityId
        || recon.value.type === 'refund' && recon.value.paymentId !== null
          && candidate.value.paymentRef !== null && candidate.value.paymentRef !== recon.value.paymentId;
      status = contradictsPayment ? "AMBIGUOUS_REFERENCE"
        : candidate.value.expectedAmount === recon.value.amount ? "VERIFIED" : "AMOUNT_MISMATCH";
      checksByMerchant.set(candidate.rowId, {
        row: candidate,
        reconRow: recon,
        settlementId,
        status,
      });
      if (status === "AMOUNT_MISMATCH") {
        issues.push({
          code: "LEDGER_AMOUNT_MISMATCH",
          settlementId,
          ownerId: recon.value.entityId,
          rowIds: [recon.rowId, candidate.rowId],
          message: `Merchant amount ${candidate.value.expectedAmount} does not equal Razorpay amount ${recon.value.amount}`,
        });
      }
      if (status === "AMBIGUOUS_REFERENCE") {
        issues.push({
          code: "INSUFFICIENT_EVIDENCE", settlementId, ownerId: recon.value.entityId,
          rowIds: [recon.rowId, candidate.rowId],
          message: `Merchant record ${candidate.value.recordId} supplies conflicting payment identities`,
        });
      }
    }
    const statuses = reconStatusByGroup.get(settlementId) ?? [];
    statuses.push(status);
    reconStatusByGroup.set(settlementId, statuses);
  }

  for (const merchant of merchantRows) {
    if (checksByMerchant.has(merchant.rowId)) continue;
    checksByMerchant.set(merchant.rowId, {
      row: merchant,
      reconRow: null,
      settlementId: null,
      status: "MISSING_RAZORPAY_ROW",
    });
    issues.push({
      code: "MISSING_RAZORPAY_ROW",
      settlementId: null,
      ownerId: merchant.value.recordId,
      rowIds: [merchant.rowId],
      message: `No scoped Razorpay recon row references merchant record ${merchant.value.recordId}`,
    });
  }

  const groupStatuses = new Map<SettlementId, LedgerStatus>();
  for (const group of groups) {
    const statuses = reconStatusByGroup.get(group.settlementId) ?? ["NOT_APPLICABLE"];
    const status = [...statuses].sort((left, right) => statusPriority(right) - statusPriority(left))[0];
    groupStatuses.set(group.settlementId, status ?? "NOT_APPLICABLE");
  }

  const merchantRowIdsBySettlement = new Map<SettlementId, SourceRow<unknown>["rowId"][]>();
  for (const check of checksByMerchant.values()) {
    if (check.settlementId === null) continue;
    const rows = merchantRowIdsBySettlement.get(check.settlementId) ?? [];
    rows.push(check.row.rowId);
    merchantRowIdsBySettlement.set(check.settlementId, rows);
  }
  for (const [settlementId, rows] of merchantRowIdsBySettlement) {
    merchantRowIdsBySettlement.set(settlementId, rows.sort(compareCodeUnits));
  }

  const ledgerPresentSettlementIds = new Set<SettlementId>();
  for (const [settlementId, status] of groupStatuses) {
    if (status === "VERIFIED" || status === "NOT_APPLICABLE") {
      ledgerPresentSettlementIds.add(settlementId);
    }
  }

  return {
    merchants: [...checksByMerchant.values()].sort((left, right) =>
      compareCodeUnits(left.row.rowId, right.row.rowId),
    ),
    groupStatuses,
    merchantRowIdsBySettlement,
    ledgerPresentSettlementIds,
    issues: issues.sort((left, right) =>
      compareCodeUnits(
        `${left.code}\u0000${left.ownerId}`,
        `${right.code}\u0000${right.ownerId}`,
      ),
    ),
  };
}
