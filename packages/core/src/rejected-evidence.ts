import type { IngestedInput } from './ingest';
import { deterministicUtrEvidence } from './utr';
import type { BankEntryId, JsonObject, RowId, RunConfig, SettlementId } from './types';

const text = (row: JsonObject, key: string): string | null =>
  typeof row[key] === 'string' && row[key].length > 0
    ? ['entity_ref', 'payment_ref', 'order_ref'].includes(key) ? row[key].trim() || null : row[key]
    : null;

/** Invalid evidence can still identify the valid records whose proof it contradicts. */
export function rejectedEvidenceTaints(input: IngestedInput, config: RunConfig) {
  const settlements = new Map<SettlementId, Set<RowId>>();
  const banks = new Map<BankEntryId, Set<RowId>>();
  const mark = (id: SettlementId, rowId: RowId) => {
    const rows = settlements.get(id) ?? new Set<RowId>();
    rows.add(rowId);
    settlements.set(id, rows);
  };
  for (const { row } of input.rejected) {
    const raw = row.raw;
    if (row.source === 'RAZORPAY' || row.source === 'SETTLEMENT') {
      const id = text(raw, 'settlement_id');
      if (id !== null) mark(id as SettlementId, row.rowId);
      if (row.source === 'RAZORPAY') {
        const entity = text(raw, 'entity_id');
        for (const accepted of input.recon) {
          if (entity !== null && accepted.value.entityId === entity) mark(accepted.value.settlementId, row.rowId);
        }
      }
    }
    if (row.source === 'BANK') {
      const bankId = text(raw, 'bank_row_ref');
      if (bankId !== null) {
        const ids = banks.get(bankId as BankEntryId) ?? new Set<RowId>();
        ids.add(row.rowId);
        banks.set(bankId as BankEntryId, ids);
      }
      for (const accepted of input.recon) {
        const evidence = deterministicUtrEvidence(accepted.value.settlementUtr, text(raw, 'utr'), text(raw, 'narration') ?? '', {
          knownPrefixes: config.knownUtrPrefixes, minimumTruncatedLength: config.minimumTruncatedUtrLength,
        });
        if (evidence.length > 0) mark(accepted.value.settlementId, row.rowId);
      }
    }
    if (row.source === 'MERCHANT') {
      // Expand a rejected stable ID to its valid siblings before resolving identities.
      const related = [raw, ...input.merchant
        .filter((accepted) => accepted.value.recordId === text(raw, 'record_id'))
        .map((accepted) => accepted.raw)];
      for (const evidence of related) {
        for (const accepted of input.recon) {
          const value = accepted.value;
          const direct = text(evidence, 'entity_ref');
          const payment = text(evidence, 'payment_ref');
          const order = text(evidence, 'order_ref');
          if ((direct !== null && direct === value.entityId)
            || (payment !== null && payment === value.entityId && value.type === 'payment')
            || (order !== null && order === value.orderId)) mark(value.settlementId, row.rowId);
        }
      }
    }
  }
  return { settlements, banks };
}
