import { z } from "zod";
import { canonicalJson, compareCodeUnits } from "./canonical";
import { epochSeconds, parseISTDate } from "./date";
import { MoneyError, paiseFromInteger, parseMoneyInput } from "./money";
import { sha256Hex } from "./sha256";
import type {
  BankEntry,
  ExceptionCode,
  InputSummary,
  JsonObject,
  MerchantRecord,
  ReconRow,
  SettlementEntity,
  SettlementId,
  SourceRow,
} from "./types";

type SourceKind = SourceRow<unknown>["source"];

export interface RejectedRow {
  readonly row: SourceRow<null>;
  readonly code: ExceptionCode;
  readonly message: string;
}

export interface IngestedInput {
  readonly recon: readonly SourceRow<ReconRow>[];
  readonly bank: readonly SourceRow<BankEntry>[];
  readonly merchant: readonly SourceRow<MerchantRecord>[];
  readonly settlements: readonly SourceRow<SettlementEntity>[];
  readonly rejected: readonly RejectedRow[];
  readonly summaries: readonly InputSummary[];
  readonly allRows: readonly SourceRow<unknown>[];
}

class RowValidationError extends Error {
  public constructor(
    public readonly code: ExceptionCode,
    message: string,
  ) {
    super(message);
    this.name = "RowValidationError";
  }
}

const nullableString = z.string().nullable().optional();
const nullableBoolean = z.boolean().nullable().optional();

const reconSchema = z
  .object({
    entity_id: z.string().min(1),
    type: z.enum(["payment", "refund", "transfer", "adjustment"]),
    credit: z.unknown(),
    debit: z.unknown(),
    amount: z.unknown(),
    currency: z.string(),
    fee: z.unknown(),
    tax: z.unknown(),
    on_hold: nullableBoolean,
    settled: nullableBoolean,
    created_at: z.unknown(),
    settled_at: z.unknown(),
    posted_at: z.unknown().nullable().optional(),
    settlement_id: z.string().min(1),
    settlement_utr: nullableString,
    payment_id: nullableString,
    order_id: nullableString,
    notes: z.union([z.record(z.string(), z.unknown()), z.string(), z.null()]).optional(),
    description: nullableString,
  })
  .passthrough();

const bankSchema = z
  .object({
    bank_row_ref: z.string().min(1),
    posting_date: z.string(),
    direction: z.string(),
    amount: z.unknown(),
    currency: z.string(),
    utr: nullableString,
    narration: z.string().optional(),
  })
  .passthrough();

const merchantSchema = z
  .object({
    record_id: z.string().min(1),
    type: z.string(),
    entity_ref: nullableString,
    payment_ref: nullableString,
    order_ref: nullableString,
    expected_amount: z.unknown(),
    currency: z.string(),
    created_date: z.string(),
    status: z.string(),
  })
  .passthrough();

const settlementSchema = z
  .object({
    settlement_id: z.string().min(1),
    amount: z.unknown(),
    currency: z.string(),
  })
  .passthrough();

function requiredINR(value: string): "INR" {
  if (value.trim().toUpperCase() !== "INR") {
    throw new RowValidationError("CURRENCY_MISMATCH", `unsupported currency ${value}`);
  }
  return "INR";
}

function nullIfBlank(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function zodMessage(result: z.ZodError): string {
  return result.issues
    .map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`)
    .sort(compareCodeUnits)
    .join("; ");
}

function parseRecon(raw: JsonObject): ReconRow {
  const result = reconSchema.safeParse(raw);
  if (!result.success) {
    throw new RowValidationError("INSUFFICIENT_EVIDENCE", zodMessage(result.error));
  }
  const value = result.data;
  try {
    return {
      entityId: value.entity_id,
      type: value.type,
      credit: paiseFromInteger(value.credit, "recon.credit"),
      debit: paiseFromInteger(value.debit, "recon.debit"),
      amount: paiseFromInteger(value.amount, "recon.amount"),
      currency: requiredINR(value.currency),
      fee: paiseFromInteger(value.fee, "recon.fee"),
      tax: paiseFromInteger(value.tax, "recon.tax"),
      onHold: value.on_hold ?? null,
      settled: value.settled ?? null,
      createdAt: epochSeconds(value.created_at, "recon.created_at"),
      settledAt: epochSeconds(value.settled_at, "recon.settled_at"),
      postedAt:
        value.posted_at === null || value.posted_at === undefined
          ? null
          : epochSeconds(value.posted_at, "recon.posted_at"),
      settlementId: value.settlement_id as SettlementId,
      settlementUtr: nullIfBlank(value.settlement_utr),
      paymentId: nullIfBlank(value.payment_id),
      orderId: nullIfBlank(value.order_id),
      notes: value.notes ?? null,
      description: nullIfBlank(value.description),
    };
  } catch (error) {
    if (error instanceof RowValidationError) throw error;
    if (error instanceof MoneyError) {
      throw new RowValidationError("MALFORMED_AMOUNT", error.message);
    }
    throw error;
  }
}

function parseBank(raw: JsonObject): BankEntry {
  const result = bankSchema.safeParse(raw);
  if (!result.success) {
    throw new RowValidationError("INSUFFICIENT_EVIDENCE", zodMessage(result.error));
  }
  const value = result.data;
  const direction = value.direction.trim().toUpperCase();
  if (direction !== "CREDIT" && direction !== "DEBIT") {
    throw new RowValidationError(
      "INSUFFICIENT_EVIDENCE",
      `bank.direction must be CREDIT or DEBIT, received ${value.direction}`,
    );
  }
  try {
    return {
      bankEntryId: value.bank_row_ref as BankEntry["bankEntryId"],
      direction,
      amount: parseMoneyInput(value.amount, "bank.amount"),
      currency: requiredINR(value.currency),
      postingDate: parseISTDate(value.posting_date, "bank.posting_date"),
      utr: nullIfBlank(value.utr),
      narration: value.narration ?? "",
    };
  } catch (error) {
    if (error instanceof RowValidationError) throw error;
    if (error instanceof MoneyError) {
      throw new RowValidationError("MALFORMED_AMOUNT", error.message);
    }
    throw error;
  }
}

function parseMerchant(raw: JsonObject): MerchantRecord {
  const result = merchantSchema.safeParse(raw);
  if (!result.success) {
    throw new RowValidationError("INSUFFICIENT_EVIDENCE", zodMessage(result.error));
  }
  const value = result.data;
  const type = value.type.trim().toLowerCase();
  if (type !== "payment" && type !== "refund" && type !== "transfer" && type !== "adjustment") {
    throw new RowValidationError(
      "INSUFFICIENT_EVIDENCE",
      `merchant.type is unsupported: ${value.type}`,
    );
  }
  try {
    return {
      recordId: value.record_id,
      type,
      entityRef: nullIfBlank(value.entity_ref),
      paymentRef: nullIfBlank(value.payment_ref),
      orderRef: nullIfBlank(value.order_ref),
      expectedAmount: parseMoneyInput(value.expected_amount, "merchant.expected_amount"),
      currency: requiredINR(value.currency),
      createdDate: parseISTDate(value.created_date, "merchant.created_date"),
      status: value.status,
    };
  } catch (error) {
    if (error instanceof RowValidationError) throw error;
    if (error instanceof MoneyError) {
      throw new RowValidationError("MALFORMED_AMOUNT", error.message);
    }
    throw error;
  }
}

function parseSettlement(raw: JsonObject): SettlementEntity {
  const result = settlementSchema.safeParse(raw);
  if (!result.success) {
    throw new RowValidationError("INSUFFICIENT_EVIDENCE", zodMessage(result.error));
  }
  const value = result.data;
  try {
    return {
      settlementId: value.settlement_id as SettlementId,
      amount: paiseFromInteger(value.amount, "settlement.amount"),
      currency: requiredINR(value.currency),
    };
  } catch (error) {
    if (error instanceof RowValidationError) throw error;
    if (error instanceof MoneyError) {
      throw new RowValidationError("MALFORMED_AMOUNT", error.message);
    }
    throw error;
  }
}

function createRows(
  source: SourceKind,
  rawRows: readonly JsonObject[],
): { rows: SourceRow<null>[]; summary: InputSummary } {
  const records = rawRows.map((raw) => {
    const canonical = canonicalJson(raw);
    const immutableSnapshot = JSON.parse(canonical) as JsonObject;
    return { raw: immutableSnapshot, canonical, hash: sha256Hex(canonical) };
  });
  records.sort((left, right) => {
    const hashOrder = compareCodeUnits(left.hash, right.hash);
    return hashOrder === 0 ? compareCodeUnits(left.canonical, right.canonical) : hashOrder;
  });

  const seen = new Map<string, { canonical: string; count: number }>();
  const rows = records.map((record) => {
    const prior = seen.get(record.hash);
    if (prior !== undefined && prior.canonical !== record.canonical) {
      throw new Error("SHA-256 collision detected while assigning source-row identity");
    }
    const duplicateOrdinal = prior?.count ?? 0;
    seen.set(record.hash, { canonical: record.canonical, count: duplicateOrdinal + 1 });
    return {
      rowId: `${source.toLowerCase()}_${record.hash}_${duplicateOrdinal}` as SourceRow<null>["rowId"],
      source,
      contentHash: record.hash,
      duplicateOrdinal,
      raw: record.raw,
      value: null,
    };
  });

  const logicalHash = sha256Hex(
    canonicalJson(rows.map((row) => row.contentHash)),
  );
  return {
    rows,
    summary: {
      source,
      logicalHash,
      inputRowCount: rows.length,
    },
  };
}

function parseRows<T>(
  rows: readonly SourceRow<null>[],
  parser: (raw: JsonObject) => T,
): { accepted: SourceRow<T>[]; rejected: RejectedRow[] } {
  const accepted: SourceRow<T>[] = [];
  const rejected: RejectedRow[] = [];
  for (const row of rows) {
    try {
      accepted.push({ ...row, value: parser(row.raw) });
    } catch (error) {
      if (error instanceof RowValidationError) {
        rejected.push({ row, code: error.code, message: error.message });
        continue;
      }
      if (error instanceof Error) {
        rejected.push({ row, code: "INSUFFICIENT_EVIDENCE", message: error.message });
        continue;
      }
      rejected.push({ row, code: "INSUFFICIENT_EVIDENCE", message: "unknown validation error" });
    }
  }
  return { accepted, rejected };
}

export function ingestInput(input: {
  readonly reconRows: readonly JsonObject[];
  readonly bankRows: readonly JsonObject[];
  readonly merchantRows: readonly JsonObject[];
  readonly settlementEntities?: readonly JsonObject[];
}): IngestedInput {
  const reconRows = createRows("RAZORPAY", input.reconRows);
  const bankRows = createRows("BANK", input.bankRows);
  const merchantRows = createRows("MERCHANT", input.merchantRows);
  const settlementRows = createRows("SETTLEMENT", input.settlementEntities ?? []);

  const recon = parseRows(reconRows.rows, parseRecon);
  const bank = parseRows(bankRows.rows, parseBank);
  const merchant = parseRows(merchantRows.rows, parseMerchant);
  const settlements = parseRows(settlementRows.rows, parseSettlement);
  const allRows: SourceRow<unknown>[] = [
    ...reconRows.rows,
    ...bankRows.rows,
    ...merchantRows.rows,
    ...settlementRows.rows,
  ];

  return {
    recon: recon.accepted,
    bank: bank.accepted,
    merchant: merchant.accepted,
    settlements: settlements.accepted,
    rejected: [
      ...recon.rejected,
      ...bank.rejected,
      ...merchant.rejected,
      ...settlements.rejected,
    ].sort((left, right) => compareCodeUnits(left.row.rowId, right.row.rowId)),
    summaries: [
      reconRows.summary,
      bankRows.summary,
      merchantRows.summary,
      settlementRows.summary,
    ].sort((left, right) => compareCodeUnits(left.source, right.source)),
    allRows: allRows.sort((left, right) => compareCodeUnits(left.rowId, right.rowId)),
  };
}
