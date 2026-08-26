export type Brand<T, Name extends string> = T & {
  readonly __brand: Name;
};

export type Paise = Brand<number, "Paise">;
export type SignedPaise = Brand<number, "SignedPaise">;
export type EpochSeconds = Brand<number, "EpochSeconds">;
export type ISTDate = Brand<string, "ISTDate">;
export type Sha256 = Brand<string, "Sha256">;
export type RowId = Brand<string, "RowId">;
export type SettlementId = Brand<string, "SettlementId">;
export type BankEntryId = Brand<string, "BankEntryId">;
export type CaseId = Brand<string, "CaseId">;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type TerminalState =
  | "EXACT_MATCH"
  | "VERIFIED_ASSISTED_MATCH"
  | "AMBIGUOUS"
  | "UNMATCHED"
  | "INVALID_INPUT"
  | "MANUALLY_RESOLVED";

export type BankStatus =
  | "EXACT_UTR_MATCH"
  | "DETERMINISTIC_MATCH"
  | "AI_VERIFIED_MATCH"
  | "AMOUNT_MISMATCH"
  | "AMBIGUOUS"
  | "MISSING"
  | "UNKNOWN_CREDIT"
  | "OUT_OF_SCOPE"
  | "INVALID";

export type LedgerStatus =
  | "VERIFIED"
  | "MISSING_MERCHANT_RECORD"
  | "MISSING_RAZORPAY_ROW"
  | "AMOUNT_MISMATCH"
  | "AMBIGUOUS_REFERENCE"
  | "NOT_APPLICABLE"
  | "INVALID";

export type ReviewStatus = "NOT_REQUIRED" | "PENDING" | "RESOLVED";

export type ExceptionCode =
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

export type SuggestedAction =
  | "CHECK_BANK"
  | "CHECK_RAZORPAY"
  | "CHECK_MERCHANT_LEDGER"
  | "REVIEW_CANDIDATES"
  | "CORRECT_INPUT";

export interface RunInput {
  readonly reconRows: readonly JsonObject[];
  readonly bankRows: readonly JsonObject[];
  readonly merchantRows: readonly JsonObject[];
  readonly settlementEntities?: readonly JsonObject[];
}

export interface RunConfig {
  readonly schemaVersion: "1";
  readonly mode: "baseline" | "deterministic" | "hybrid";
  readonly aiMode: "off" | "replay" | "live";
  readonly inputProfile: "synthetic-v1" | "foreign";
  readonly postingWindowDays: number;
  readonly minimumTruncatedUtrLength: number;
  readonly knownUtrPrefixes: readonly string[];
  readonly runAtEpochSeconds: EpochSeconds;
}

export interface SourceRow<T> {
  readonly rowId: RowId;
  readonly source: "RAZORPAY" | "BANK" | "MERCHANT" | "SETTLEMENT";
  readonly contentHash: Sha256;
  readonly duplicateOrdinal: number;
  readonly raw: JsonObject;
  readonly value: T;
}

export interface ReconRow {
  readonly entityId: string;
  readonly type: "payment" | "refund" | "transfer" | "adjustment";
  readonly credit: Paise;
  readonly debit: Paise;
  readonly amount: Paise;
  readonly currency: "INR";
  readonly fee: Paise;
  readonly tax: Paise;
  readonly onHold: boolean | null;
  readonly settled: boolean | null;
  readonly createdAt: EpochSeconds;
  readonly settledAt: EpochSeconds;
  readonly postedAt: EpochSeconds | null;
  readonly settlementId: SettlementId;
  readonly settlementUtr: string | null;
  readonly paymentId: string | null;
  readonly orderId: string | null;
  readonly notes: Readonly<Record<string, unknown>> | string | null;
  readonly description: string | null;
}

export interface BankEntry {
  readonly bankEntryId: BankEntryId;
  readonly direction: "CREDIT" | "DEBIT";
  readonly amount: Paise;
  readonly currency: "INR";
  readonly postingDate: ISTDate;
  readonly utr: string | null;
  readonly narration: string;
}

export interface MerchantRecord {
  readonly recordId: string;
  readonly type: "payment" | "refund" | "transfer" | "adjustment";
  readonly entityRef: string | null;
  readonly paymentRef: string | null;
  readonly orderRef: string | null;
  readonly expectedAmount: Paise;
  readonly currency: "INR";
  readonly createdDate: ISTDate;
  readonly status: string;
}

export interface SettlementEntity {
  readonly settlementId: SettlementId;
  readonly amount: Paise;
  readonly currency: "INR";
}

export interface ArithmeticTerm {
  readonly rowId: RowId;
  readonly entityId: string;
  readonly creditPaise: Paise;
  readonly debitPaise: Paise;
  readonly contributionPaise: SignedPaise;
}

export interface Equation {
  readonly expectedPaise: Paise;
  readonly actualPaise: Paise;
  readonly residualPaise: SignedPaise;
  readonly terms: readonly ArithmeticTerm[];
}

export type CandidateEvidence =
  | "EXACT_UTR"
  | "SPACE_CASE_UTR"
  | "PREFIX_STRIP"
  | "TRUNCATED_UTR"
  | "NARRATION_TOKEN"
  | "AI_HYPOTHESIS";

export interface CandidateEdge {
  readonly settlementId: SettlementId;
  readonly bankEntryId: BankEntryId;
  readonly evidence: readonly CandidateEvidence[];
  readonly hypothesisIds: readonly string[];
}

export interface StateTransition {
  readonly atEpochSeconds: EpochSeconds;
  readonly from: TerminalState | null;
  readonly to: TerminalState;
  readonly reason: string;
  readonly actor: "SYSTEM" | "HUMAN";
}

export interface ExceptionRecord {
  readonly exceptionId: string;
  readonly code: ExceptionCode;
  readonly caseId: CaseId;
  readonly evidenceRowIds: readonly RowId[];
  readonly equation: Equation | null;
  readonly impactPaise: SignedPaise | null;
  readonly suggestedAction: SuggestedAction;
  readonly message: string;
  readonly stateHistory: readonly StateTransition[];
}

export interface SettlementDecision {
  readonly caseId: CaseId;
  readonly settlementId: SettlementId;
  readonly settlementUtr: string | null;
  readonly bankEntryId: BankEntryId | null;
  readonly bankStatus: BankStatus;
  readonly ledgerStatus: LedgerStatus;
  readonly reviewStatus: ReviewStatus;
  readonly overallStatus: TerminalState;
  readonly equation: Equation | null;
  readonly reconRowIds: readonly RowId[];
  readonly merchantRowIds: readonly RowId[];
  readonly candidateBankEntryIds: readonly BankEntryId[];
  readonly evidence: readonly CandidateEvidence[];
  readonly warnings: readonly string[];
  readonly exceptionIds: readonly string[];
  readonly stateHistory: readonly StateTransition[];
}

export interface BankDecision {
  readonly bankEntryId: BankEntryId;
  readonly rowId: RowId;
  readonly settlementId: SettlementId | null;
  readonly bankStatus: BankStatus;
  readonly reviewStatus: ReviewStatus;
  readonly overallStatus: TerminalState;
  readonly exceptionIds: readonly string[];
}

export interface LedgerDecision {
  readonly recordId: string;
  readonly rowId: RowId;
  readonly reconRowId: RowId | null;
  readonly settlementId: SettlementId | null;
  readonly ledgerStatus: LedgerStatus;
  readonly reviewStatus: ReviewStatus;
  readonly overallStatus: TerminalState;
  readonly exceptionIds: readonly string[];
}

export interface RowOutcome {
  readonly rowId: RowId;
  readonly source: SourceRow<unknown>["source"];
  readonly ownerId: string;
  readonly overallStatus: TerminalState;
  readonly exceptionIds: readonly string[];
}

/** Immutable source evidence retained so the UI/report can prove every decision. */
export interface EvidenceRow {
  readonly rowId: RowId;
  readonly source: SourceRow<unknown>["source"];
  readonly contentHash: Sha256;
  readonly duplicateOrdinal: number;
  readonly raw: JsonObject;
}

export interface AuditEvent {
  readonly auditId: string;
  readonly sequence: number;
  readonly atEpochSeconds: EpochSeconds;
  readonly type:
    | "INPUT_REJECTED"
    | "EXCEPTION_RAISED"
    | "MATCH_ACCEPTED"
    | "MATCH_ABSTAINED"
    | "HYPOTHESIS_VERIFIED"
    | "HYPOTHESIS_REJECTED"
    | "MANUAL_RESOLUTION";
  readonly subjectId: string;
  readonly detail: string;
}

export type HypothesisType =
  | "UTR_FORMAT_VARIANT"
  | "COLUMN_SCHEMA_MAPPING"
  | "CROSS_CYCLE_REFUND"
  | "DUPLICATE_BANK_ENTRY"
  | "MISSING_BANK_ENTRY"
  | "MISSING_RAZORPAY_ROW"
  | "MISSING_MERCHANT_LEDGER_RECORD"
  | "FEE_SEMANTICS_MISMATCH"
  | "DELAYED_BANK_POSTING"
  | "UNEXPLAINED_ADJUSTMENT"
  | "INSUFFICIENT_EVIDENCE";

export type RequestedTest =
  | "NORMALIZED_UTR_MATCH"
  | "EXACT_AMOUNT_MATCH"
  | "POSTING_WINDOW_MATCH"
  | "DUPLICATE_HASH_MATCH"
  | "LEDGER_PRESENCE_CHECK";

export interface LiteralSpan {
  readonly evidence_row_id: string;
  readonly field: "narration" | "utr";
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface AiHypothesis {
  readonly schema_version: "1";
  readonly hypothesis_id: string;
  readonly subject_bank_entry_id: string;
  readonly hypothesis_type: HypothesisType;
  readonly candidate_ids: readonly string[];
  readonly evidence_row_ids: readonly string[];
  readonly confidence: number;
  readonly requested_tests: readonly RequestedTest[];
  readonly literal_spans: readonly LiteralSpan[];
}

export interface HypothesisTestResult {
  readonly name: RequestedTest | "LITERAL_SPAN" | "CANDIDATE_EXISTS" | "CURRENCY_MATCH";
  readonly passed: boolean;
  readonly detail: string;
}

export interface HypothesisVerdict {
  readonly hypothesisId: string;
  readonly subjectBankEntryId: BankEntryId | null;
  readonly candidateSettlementId: SettlementId | null;
  readonly status: "VERIFIED" | "REJECTED";
  readonly reason: string;
  readonly tests: readonly HypothesisTestResult[];
  readonly addedEdge: CandidateEdge | null;
}

export interface InputSummary {
  readonly source: SourceRow<unknown>["source"];
  readonly logicalHash: Sha256;
  readonly inputRowCount: number;
}

export interface RunSummary {
  readonly inputRows: number;
  readonly rowOutcomes: number;
  readonly settlements: number;
  readonly exactMatches: number;
  readonly assistedMatches: number;
  readonly ambiguous: number;
  readonly unmatched: number;
  readonly invalid: number;
  readonly manual: number;
  readonly acceptedResidualPaise: SignedPaise;
  readonly complete: boolean;
}

export interface RunArtifact {
  readonly schemaVersion: "vouch.run/1";
  readonly artifactId: string;
  readonly runAtEpochSeconds: EpochSeconds;
  readonly config: RunConfig;
  readonly inputs: readonly InputSummary[];
  readonly sourceRows: readonly EvidenceRow[];
  readonly settlements: readonly SettlementDecision[];
  readonly bankEntries: readonly BankDecision[];
  readonly ledger: readonly LedgerDecision[];
  readonly rowOutcomes: readonly RowOutcome[];
  readonly exceptions: readonly ExceptionRecord[];
  readonly hypotheses: readonly HypothesisVerdict[];
  readonly candidateEdges: readonly CandidateEdge[];
  readonly auditEvents: readonly AuditEvent[];
  readonly summary: RunSummary;
}

export interface ManualResolutionCommand {
  readonly caseId: CaseId;
  readonly note: string;
  readonly actor: string;
  readonly atEpochSeconds: EpochSeconds;
}
