import { join } from "node:path";

import type { JsonObject, RunInput } from "@vouch/core";

import { parseCsvObjects } from "./csv.js";
import { readOptionalUtf8File, readUtf8File, sha256Text } from "./files.js";
import { parseJson, requireRecord, requireRecordArray } from "./json.js";

export interface LoadedPublicInputs {
  readonly input: RunInput;
  readonly datasetId: string | null;
  readonly inputBundleSha256: string;
  readonly componentSha256: {
    readonly razorpayReconJson: string;
    readonly bankStatementCsv: string;
    readonly merchantLedgerCsv: string;
  };
  readonly warnings: readonly string[];
}

export async function loadPublicInputs(directory: string): Promise<LoadedPublicInputs> {
  const reconPath = join(directory, "razorpay-recon.json");
  const bankPath = join(directory, "bank-statement.csv");
  const merchantPath = join(directory, "merchant-ledger.csv");
  const [reconText, bankText, merchantText] = await Promise.all([
    readUtf8File(reconPath, "Razorpay recon input"),
    readUtf8File(bankPath, "bank statement input"),
    readUtf8File(merchantPath, "merchant ledger input")
  ]);

  const reconCollection = requireRecord(parseJson(reconText, reconPath), "Razorpay recon collection");
  const reconRows = requireRecordArray(reconCollection.items, "Razorpay recon items");
  if (reconRows.length > 10_000) throw new Error("Razorpay recon input exceeds the 10,000-row limit");

  const bankParsed = parseCsvObjects(bankText, bankPath);
  const merchantParsed = parseCsvObjects(merchantText, merchantPath);
  if (bankParsed.records.length > 10_000 || merchantParsed.records.length > 10_000) {
    throw new Error("CSV input exceeds the 10,000-row-per-source limit");
  }

  const bankRows = bankParsed.records.map(normalizeBankRecord);
  const merchantRows = merchantParsed.records.map(normalizeMerchantRecord);
  const settlementEntities = await loadOptionalSettlementEntities(directory);
  const componentSha256 = {
    razorpayReconJson: sha256Text(reconText),
    bankStatementCsv: sha256Text(bankText),
    merchantLedgerCsv: sha256Text(merchantText)
  };
  const inputBundleSha256 = sha256Text(
    JSON.stringify({
      bank_statement_csv: componentSha256.bankStatementCsv,
      merchant_ledger_csv: componentSha256.merchantLedgerCsv,
      razorpay_recon_json: componentSha256.razorpayReconJson
    })
  );
  const manifestResult = await loadAndVerifyPublicManifest(directory, componentSha256);

  return {
    input: {
      reconRows: reconRows as JsonObject[],
      bankRows,
      merchantRows,
      ...(settlementEntities.length === 0 ? {} : { settlementEntities })
    },
    datasetId: manifestResult.datasetId,
    inputBundleSha256,
    componentSha256,
    warnings: manifestResult.warnings
  };
}

function normalizeBankRecord(record: Readonly<Record<string, string>>): JsonObject {
  const bankRowReference = record.bank_row_ref ?? record.bank_row_id;
  return {
    ...record,
    ...(bankRowReference === undefined ? {} : { bank_row_ref: bankRowReference })
  };
}

function normalizeMerchantRecord(record: Readonly<Record<string, string>>): JsonObject {
  const recordId = record.record_id ?? record.ledger_row_id;
  const entityReference = record.entity_ref ?? record.razorpay_ref;
  const paymentReference = record.payment_ref ?? null;
  const orderReference = record.order_ref ?? record.order_id ?? null;
  return {
    ...record,
    ...(recordId === undefined ? {} : { record_id: recordId }),
    entity_ref: entityReference ?? null,
    payment_ref: paymentReference,
    order_ref: orderReference
  };
}

async function loadOptionalSettlementEntities(directory: string): Promise<JsonObject[]> {
  const path = join(directory, "settlements.json");
  const text = await readOptionalUtf8File(path);
  if (text === null) return [];
  const parsed = parseJson(text, path);
  if (Array.isArray(parsed)) return requireRecordArray(parsed, "settlement entities") as JsonObject[];
  const collection = requireRecord(parsed, "settlement entity collection");
  return requireRecordArray(collection.items, "settlement entity items") as JsonObject[];
}

async function loadAndVerifyPublicManifest(
  directory: string,
  actual: LoadedPublicInputs["componentSha256"]
): Promise<{ datasetId: string | null; warnings: readonly string[] }> {
  const path = join(directory, "manifest.json");
  const text = await readOptionalUtf8File(path);
  if (text === null) {
    return { datasetId: null, warnings: [`No public manifest found at ${path}; component hashes were not cross-checked.`] };
  }
  const manifest = requireRecord(parseJson(text, path), "public manifest");
  const hashes = requireRecord(manifest.sha256, "public manifest sha256");
  const expected = {
    razorpayReconJson: hashes.razorpay_recon_json,
    bankStatementCsv: hashes.bank_statement_csv,
    merchantLedgerCsv: hashes.merchant_ledger_csv
  };
  for (const key of Object.keys(actual) as (keyof typeof actual)[]) {
    if (typeof expected[key] !== "string") {
      throw new Error(`public manifest is missing ${key}`);
    }
    if (expected[key] !== actual[key]) {
      throw new Error(`public input hash mismatch for ${key}`);
    }
  }
  return {
    datasetId: typeof manifest.dataset_id === "string" ? manifest.dataset_id : null,
    warnings: []
  };
}
