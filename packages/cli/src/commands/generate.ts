import { resolve } from "node:path";

import { DEFAULT_GENERATOR_CONFIG, generateSyntheticDataset } from "@vouch/generator";

import { stringifyCsv } from "../csv.js";
import { sha256Text, writeUtf8File } from "../files.js";
import { stablePrettyJson } from "../json.js";
import type { GenerateOptions } from "../options.js";

const BANK_HEADERS = [
  "bank_row_id",
  "source_line",
  "posting_date",
  "direction",
  "amount",
  "currency",
  "narration",
  "utr"
] as const;

const MERCHANT_HEADERS = [
  "ledger_row_id",
  "source_line",
  "merchant_ref",
  "order_id",
  "razorpay_ref",
  "type",
  "expected_amount",
  "currency",
  "created_date",
  "status"
] as const;

export interface GenerateCommandResult {
  readonly outputDirectory: string;
  readonly datasetId: string;
  readonly counts: {
    readonly reconRows: number;
    readonly settlementGroups: number;
    readonly bankRows: number;
    readonly merchantRows: number;
  };
  readonly expectedExceptions: number;
}

export async function executeGenerateCommand(
  options: GenerateOptions,
  cwd = process.cwd()
): Promise<GenerateCommandResult> {
  const generated = generateSyntheticDataset({
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    ...(options.datasetId === undefined ? {} : { datasetId: options.datasetId }),
    ...(options.settlementCount === undefined ? {} : { settlementCount: options.settlementCount }),
    ...(options.rowsPerSettlement === undefined ? {} : { rowsPerSettlement: options.rowsPerSettlement })
  });
  const outputDirectory = resolve(cwd, options.outputDirectory);
  const publicDirectory = resolve(outputDirectory, "public");
  const reconJson = stablePrettyJson(generated.publicInputs.razorpayRecon);
  const bankCsv = stringifyCsv(
    BANK_HEADERS,
    generated.publicInputs.bankStatement.map((row) => ({ ...row }))
  );
  const merchantCsv = stringifyCsv(
    MERCHANT_HEADERS,
    generated.publicInputs.merchantLedger.map((row) => ({ ...row }))
  );
  const publicManifest = stablePrettyJson({
    schema_version: "vouch-public-inputs/v1",
    dataset_id: generated.truth.dataset_id,
    source: "synthetic",
    labels: ["SYNTHETIC", "DEVELOPMENT DATASET"],
    counts: generated.truth.public_counts,
    sha256: {
      razorpay_recon_json: sha256Text(reconJson),
      bank_statement_csv: sha256Text(bankCsv),
      merchant_ledger_csv: sha256Text(merchantCsv)
    }
  });

  const writes = [
    writeUtf8File(resolve(publicDirectory, "razorpay-recon.json"), reconJson, options),
    writeUtf8File(resolve(publicDirectory, "bank-statement.csv"), bankCsv, options),
    writeUtf8File(resolve(publicDirectory, "merchant-ledger.csv"), merchantCsv, options),
    writeUtf8File(resolve(publicDirectory, "manifest.json"), publicManifest, options)
  ];
  if (!options.publicOnly) {
    writes.push(
      writeUtf8File(
        resolve(outputDirectory, "truth", "manifest.json"),
        stablePrettyJson(generated.truth),
        options
      )
    );
  }
  await Promise.all(writes);

  return {
    outputDirectory,
    datasetId: generated.truth.dataset_id,
    counts: {
      reconRows: generated.truth.public_counts.recon_rows,
      settlementGroups: generated.truth.public_counts.settlement_groups,
      bankRows: generated.truth.public_counts.bank_rows,
      merchantRows: generated.truth.public_counts.merchant_rows
    },
    expectedExceptions: generated.truth.expected_exceptions.length
  };
}

export const GENERATOR_DEFAULTS = DEFAULT_GENERATOR_CONFIG;
