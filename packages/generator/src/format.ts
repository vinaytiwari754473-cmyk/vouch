import type { BankStatementRow, MerchantLedgerRow } from "./types.ts";

export function paiseToDecimal(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new Error("Money must be a non-negative safe integer number of paise");
  }
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  return `${rupees}.${String(remainder).padStart(2, "0")}`;
}

export function paiseToIndianDecimal(paise: number): string {
  const decimal = paiseToDecimal(paise);
  const [rupees = "0", fraction = "00"] = decimal.split(".");
  if (rupees.length <= 3) {
    return `${rupees}.${fraction}`;
  }
  const tail = rupees.slice(-3);
  const head = rupees.slice(0, -3);
  const groupedHead = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${groupedHead},${tail}.${fraction}`;
}

function escapeFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | null): string {
  const raw = escapeFormula(value === null ? "" : String(value));
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function renderCsv<Row extends object>(
  rows: readonly Row[],
  headers: readonly (keyof Row)[],
): string {
  const lines = [headers.map((header) => csvCell(String(header))).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header] as string | number | null)).join(","));
  }
  return `${lines.join("\n")}\n`;
}

const BANK_HEADERS: readonly (keyof BankStatementRow)[] = [
  "bank_row_id",
  "source_line",
  "posting_date",
  "direction",
  "amount",
  "currency",
  "narration",
  "utr",
];

const LEDGER_HEADERS: readonly (keyof MerchantLedgerRow)[] = [
  "ledger_row_id",
  "source_line",
  "merchant_ref",
  "order_id",
  "razorpay_ref",
  "type",
  "expected_amount",
  "currency",
  "created_date",
  "status",
];

export function bankRowsToCsv(rows: readonly BankStatementRow[]): string {
  return renderCsv(rows, BANK_HEADERS);
}

export function merchantRowsToCsv(rows: readonly MerchantLedgerRow[]): string {
  return renderCsv(rows, LEDGER_HEADERS);
}
