import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bankRowsToCsv, merchantRowsToCsv } from "./format.ts";
import { generateSyntheticDataset } from "./generate.ts";

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(packageDirectory, "../../data/dev");
const publicDirectory = resolve(dataDirectory, "public");
const truthDirectory = resolve(dataDirectory, "truth");

const generated = generateSyntheticDataset();
const reconJson = stableJson(generated.publicInputs.razorpayRecon);
const bankCsv = bankRowsToCsv(generated.publicInputs.bankStatement);
const merchantCsv = merchantRowsToCsv(generated.publicInputs.merchantLedger);
const truthJson = stableJson(generated.truth);

await mkdir(publicDirectory, { recursive: true });
await mkdir(truthDirectory, { recursive: true });

await Promise.all([
  writeFile(resolve(publicDirectory, "razorpay-recon.json"), reconJson, "utf8"),
  writeFile(resolve(publicDirectory, "bank-statement.csv"), bankCsv, "utf8"),
  writeFile(resolve(publicDirectory, "merchant-ledger.csv"), merchantCsv, "utf8"),
  writeFile(resolve(truthDirectory, "manifest.json"), truthJson, "utf8"),
  writeFile(
    resolve(publicDirectory, "manifest.json"),
    stableJson({
      schema_version: "vouch-public-inputs/v1",
      dataset_id: generated.truth.dataset_id,
      source: "synthetic",
      labels: ["SYNTHETIC", "DEVELOPMENT DATASET"],
      counts: generated.truth.public_counts,
      sha256: {
        razorpay_recon_json: sha256(reconJson),
        bank_statement_csv: sha256(bankCsv),
        merchant_ledger_csv: sha256(merchantCsv),
      },
    }),
    "utf8",
  ),
]);

process.stdout.write(
  `${JSON.stringify({
    output: dataDirectory,
    counts: generated.truth.public_counts,
    expected_exceptions: generated.truth.expected_exceptions.length,
  })}\n`,
);
