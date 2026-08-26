export type ReconType = "payment" | "refund" | "transfer" | "adjustment";

/**
 * Deliberately tolerant representation of an item from Razorpay's Combined
 * Settlement Recon collection. Money fields are integer subunits.
 */
export interface RazorpayReconRow {
  entity_id: string;
  type: ReconType;
  debit: number;
  credit: number;
  amount: number;
  currency: string;
  fee: number;
  tax: number;
  on_hold: boolean;
  settled: boolean;
  created_at: number;
  settled_at: number;
  posted_at: number;
  settlement_id: string;
  settlement_utr: string | null;
  payment_id: string | null;
  order_id: string | null;
  order_receipt: string | null;
  method: string | null;
  card_network: string | null;
  card_issuer: string | null;
  card_type: string | null;
  dispute_id: string | null;
  credit_type?: string | null;
  description: string | null;
  notes: unknown;
}

export interface CombinedReconResponse {
  entity: "collection";
  count: number;
  items: RazorpayReconRow[];
}

export interface BankStatementRow {
  bank_row_id: string;
  source_line: number;
  posting_date: string;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  currency: string;
  narration: string;
  utr: string | null;
}

export type MerchantLedgerType = ReconType;

export interface MerchantLedgerRow {
  ledger_row_id: string;
  source_line: number;
  merchant_ref: string;
  order_id: string | null;
  razorpay_ref: string;
  type: MerchantLedgerType;
  expected_amount: string;
  currency: string;
  created_date: string;
  status: "captured" | "processed" | "posted";
}

export interface PublicInputs {
  razorpayRecon: CombinedReconResponse;
  bankStatement: BankStatementRow[];
  merchantLedger: MerchantLedgerRow[];
}

export type ExpectedExceptionType =
  | "SHORT_CREDIT"
  | "EXCESS_CREDIT"
  | "MISSING_BANK_ENTRY"
  | "UNKNOWN_BANK_CREDIT"
  | "DUPLICATE_BANK_ENTRY"
  | "DUPLICATE_IMPORT"
  | "GROUP_SUM_MISMATCH"
  | "MISSING_RAZORPAY_ROW"
  | "MISSING_MERCHANT_LEDGER_RECORD"
  | "LEDGER_AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "MALFORMED_AMOUNT"
  | "AMBIGUOUS_CANDIDATES"
  | "UTR_CONFLICT"
  | "HYPOTHESIS_REJECTED"
  | "INSUFFICIENT_EVIDENCE";

export type BankTruthRole =
  | "SETTLEMENT_CREDIT"
  | "CORRUPTED_SETTLEMENT_CREDIT"
  | "DUPLICATE"
  | "UNKNOWN";

export interface BankRowTruth {
  bank_row_id: string;
  true_settlement_id: string | null;
  role: BankTruthRole;
  expected_amount_paise: number | null;
  automatic_match_allowed: boolean;
  tags: string[];
}

export interface SettlementTruth {
  settlement_id: string;
  settlement_utr: string;
  calculated_paise: number;
  true_bank_row_ids: string[];
  expected_deterministic_outcome: "AUTO_MATCH" | "ABSTAIN" | "EXCEPTION";
  expected_hybrid_outcome: "AUTO_MATCH" | "ABSTAIN" | "EXCEPTION";
  tags: string[];
}

export interface ExpectedException {
  case_id: string;
  type: ExpectedExceptionType;
  impact_paise: number | null;
  settlement_ids: string[];
  bank_row_ids: string[];
  recon_entity_ids: string[];
  merchant_row_ids: string[];
  reason: string;
}

export interface GoldenFeeTaxTruth {
  entity_id: string;
  gross_paise: number;
  base_fee_paise: number;
  tax_paise: number;
  fee_including_tax_paise: number;
  correct_credit_paise: number;
  incorrect_double_subtract_credit_paise: number;
}

export interface TruthManifest {
  schema_version: "vouch-truth/v1";
  dataset_id: string;
  seed: string;
  generated_at_epoch: number;
  rng_streams: string[];
  public_counts: {
    recon_rows: number;
    settlement_groups: number;
    bank_rows: number;
    merchant_rows: number;
  };
  settlement_truth: SettlementTruth[];
  bank_row_truth: BankRowTruth[];
  expected_exceptions: ExpectedException[];
  feature_tags: string[];
  golden_fee_tax: GoldenFeeTaxTruth;
}

export interface GeneratedDataset {
  publicInputs: PublicInputs;
  truth: TruthManifest;
}

export interface GeneratorConfig {
  seed: string;
  datasetId: string;
  settlementCount: number;
  rowsPerSettlement: number;
}
