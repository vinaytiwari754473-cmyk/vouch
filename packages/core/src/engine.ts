import { verifyAiHypotheses } from "./ai";
import { canonicalJson, compareCodeUnits } from "./canonical";
import { epochSeconds, isWithinPostingWindow } from "./date";
import {
  findVisibleBankDuplicates,
  quarantineStableDuplicates,
  type DuplicateIssue,
} from "./duplicates";
import { groupSettlements, type GroupIssue, type SettlementGroup } from "./group";
import { ingestInput, type RejectedRow } from "./ingest";
import { checkMerchantLedger, type LedgerIssue } from "./ledger";
import { analyzeMatching } from "./matching";
import { checkedSubtract, checkedSum, signedPaiseFromInteger } from "./money";
import { sha256Hex } from "./sha256";
import { rejectedEvidenceTaints } from "./rejected-evidence";
import { deterministicUtrEvidence, exactUtrKey } from "./utr";
import type {
  AiHypothesis,
  AuditEvent,
  BankDecision,
  BankEntry,
  BankEntryId,
  BankStatus,
  CandidateEdge,
  CandidateEvidence,
  CaseId,
  EpochSeconds,
  Equation,
  ExceptionCode,
  ExceptionRecord,
  HypothesisVerdict,
  LedgerDecision,
  LedgerStatus,
  ManualResolutionCommand,
  Paise,
  ReviewStatus,
  RowId,
  RowOutcome,
  RunArtifact,
  RunConfig,
  RunInput,
  RunSummary,
  SettlementDecision,
  SettlementId,
  SignedPaise,
  SourceRow,
  SuggestedAction,
  TerminalState,
} from "./types";

export const DEFAULT_RUN_CONFIG: RunConfig = Object.freeze({
  schemaVersion: "1",
  mode: "deterministic",
  aiMode: "off",
  inputProfile: "synthetic-v1",
  postingWindowDays: 3,
  minimumTruncatedUtrLength: 10,
  knownUtrPrefixes: Object.freeze([]),
  runAtEpochSeconds: 0 as EpochSeconds,
});

interface GroupBankWork {
  bankEntryId: BankEntryId | null;
  bankStatus: BankStatus;
  equation: Equation | null;
  evidence: readonly CandidateEvidence[];
  candidateBankEntryIds: readonly BankEntryId[];
}

interface BankWork {
  settlementId: SettlementId | null;
  bankStatus: BankStatus;
}

interface ExceptionStore {
  readonly values: Map<string, ExceptionRecord>;
  add(input: {
    code: ExceptionCode;
    caseId: CaseId;
    evidenceRowIds: readonly RowId[];
    equation?: Equation | null;
    impactPaise?: SignedPaise | null;
    message: string;
    action?: SuggestedAction;
    terminal?: TerminalState;
  }): string;
}

function normalizeConfig(input: Partial<RunConfig> | undefined): RunConfig {
  const config: RunConfig = {
    schemaVersion: input?.schemaVersion ?? DEFAULT_RUN_CONFIG.schemaVersion,
    mode: input?.mode ?? DEFAULT_RUN_CONFIG.mode,
    aiMode: input?.aiMode ?? DEFAULT_RUN_CONFIG.aiMode,
    inputProfile: input?.inputProfile ?? DEFAULT_RUN_CONFIG.inputProfile,
    postingWindowDays: input?.postingWindowDays ?? DEFAULT_RUN_CONFIG.postingWindowDays,
    minimumTruncatedUtrLength:
      input?.minimumTruncatedUtrLength ?? DEFAULT_RUN_CONFIG.minimumTruncatedUtrLength,
    knownUtrPrefixes: [...new Set(
      [...(input?.knownUtrPrefixes ?? DEFAULT_RUN_CONFIG.knownUtrPrefixes)]
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value.length > 0),
    )].sort(compareCodeUnits),
    runAtEpochSeconds: epochSeconds(
      input?.runAtEpochSeconds ?? DEFAULT_RUN_CONFIG.runAtEpochSeconds,
      "config.runAtEpochSeconds",
    ),
  };
  if (!Number.isSafeInteger(config.postingWindowDays) || config.postingWindowDays < 0 || config.postingWindowDays > 31) {
    throw new Error("postingWindowDays must be a safe integer between 0 and 31");
  }
  if (
    !Number.isSafeInteger(config.minimumTruncatedUtrLength) ||
    config.minimumTruncatedUtrLength < 10 ||
    config.minimumTruncatedUtrLength > 64
  ) {
    throw new Error("minimumTruncatedUtrLength must be a safe integer between 10 and 64");
  }
  if (config.mode !== "hybrid" && config.aiMode !== "off") {
    throw new Error("aiMode can be enabled only when mode is hybrid");
  }
  return config;
}

export function caseIdForSettlement(settlementId: SettlementId | string): CaseId {
  return `case_settlement_${sha256Hex(String(settlementId)).slice(0, 16)}` as CaseId;
}

export function caseIdForBank(bankEntryId: BankEntryId | string): CaseId {
  return `case_bank_${sha256Hex(String(bankEntryId)).slice(0, 16)}` as CaseId;
}

function caseIdForInput(rowId: RowId): CaseId {
  return `case_input_${sha256Hex(String(rowId)).slice(0, 16)}` as CaseId;
}

function defaultAction(code: ExceptionCode): SuggestedAction {
  switch (code) {
    case "SHORT_CREDIT":
    case "EXCESS_CREDIT":
    case "MISSING_BANK_ENTRY":
    case "UNKNOWN_BANK_CREDIT":
    case "DUPLICATE_BANK_ENTRY":
      return "CHECK_BANK";
    case "MISSING_RAZORPAY_ROW":
    case "MISSING_MERCHANT_LEDGER_RECORD":
    case "LEDGER_AMOUNT_MISMATCH":
      return "CHECK_MERCHANT_LEDGER";
    case "AMBIGUOUS_CANDIDATES":
    case "UTR_CONFLICT":
    case "HYPOTHESIS_REJECTED":
      return "REVIEW_CANDIDATES";
    case "DUPLICATE_IMPORT":
    case "GROUP_SUM_MISMATCH":
    case "CURRENCY_MISMATCH":
    case "MALFORMED_AMOUNT":
    case "INSUFFICIENT_EVIDENCE":
      return "CORRECT_INPUT";
  }
}

function defaultExceptionState(code: ExceptionCode): TerminalState {
  if (
    code === "DUPLICATE_IMPORT" ||
    code === "GROUP_SUM_MISMATCH" ||
    code === "CURRENCY_MISMATCH" ||
    code === "MALFORMED_AMOUNT" ||
    code === "INSUFFICIENT_EVIDENCE"
  ) {
    return "INVALID_INPUT";
  }
  if (code === "AMBIGUOUS_CANDIDATES" || code === "UTR_CONFLICT") return "AMBIGUOUS";
  return "UNMATCHED";
}

function createExceptionStore(runAt: EpochSeconds): ExceptionStore {
  const values = new Map<string, ExceptionRecord>();
  return {
    values,
    add(input) {
      const evidenceRowIds = [...new Set(input.evidenceRowIds)].sort(compareCodeUnits);
      const terminal = input.terminal ?? defaultExceptionState(input.code);
      const identity = canonicalJson({
        caseId: input.caseId,
        code: input.code,
        equation: input.equation ?? null,
        evidenceRowIds,
        impactPaise: input.impactPaise ?? null,
        message: input.message,
      });
      const exceptionId = `exc_${sha256Hex(identity).slice(0, 20)}`;
      values.set(exceptionId, {
        exceptionId,
        code: input.code,
        caseId: input.caseId,
        evidenceRowIds,
        equation: input.equation ?? null,
        impactPaise: input.impactPaise ?? null,
        suggestedAction: input.action ?? defaultAction(input.code),
        message: input.message,
        stateHistory: [
          {
            atEpochSeconds: runAt,
            from: null,
            to: terminal,
            reason: input.code,
            actor: "SYSTEM",
          },
        ],
      });
      return exceptionId;
    },
  };
}

function equationFor(group: SettlementGroup, actual: Paise): Equation {
  return {
    expectedPaise: group.calculatedPaise,
    actualPaise: actual,
    residualPaise: checkedSubtract(actual, group.calculatedPaise, `residual for ${group.settlementId}`),
    terms: group.terms,
  };
}

function equationForUnknownBank(actual: Paise): Equation {
  return {
    expectedPaise: 0 as Paise,
    actualPaise: actual,
    residualPaise: actual as number as SignedPaise,
    terms: [],
  };
}

function addRejectedInputException(store: ExceptionStore, rejected: RejectedRow): void {
  store.add({
    code: rejected.code,
    caseId: caseIdForInput(rejected.row.rowId),
    evidenceRowIds: [rejected.row.rowId],
    message: rejected.message,
    terminal: "INVALID_INPUT",
  });
}

function addDuplicateIssue(store: ExceptionStore, issue: DuplicateIssue): void {
  const bankOwned = issue.code === "DUPLICATE_BANK_ENTRY";
  store.add({
    code: issue.code,
    caseId: bankOwned ? caseIdForBank(issue.ownerId) : (`case_duplicate_${sha256Hex(issue.ownerId).slice(0, 16)}` as CaseId),
    evidenceRowIds: issue.rowIds,
    message: issue.message,
    terminal: bankOwned ? "AMBIGUOUS" : "INVALID_INPUT",
  });
}

function addGroupIssue(store: ExceptionStore, issue: GroupIssue): void {
  store.add({
    code: issue.code,
    caseId: caseIdForSettlement(issue.ownerId),
    evidenceRowIds: issue.rowIds,
    message: issue.message,
    terminal: "INVALID_INPUT",
  });
}

function addLedgerIssue(store: ExceptionStore, issue: LedgerIssue): void {
  store.add({
    code: issue.code,
    caseId:
      issue.settlementId === null
        ? (`case_ledger_${sha256Hex(issue.ownerId).slice(0, 16)}` as CaseId)
        : caseIdForSettlement(issue.settlementId),
    evidenceRowIds: issue.rowIds,
    message: issue.message,
    terminal:
      issue.code === "INSUFFICIENT_EVIDENCE" ? "AMBIGUOUS" : "UNMATCHED",
  });
}

function edgeKey(settlementId: SettlementId | string, bankEntryId: BankEntryId | string): string {
  return `${settlementId}\u0000${bankEntryId}`;
}

function mergeEdges(edges: readonly CandidateEdge[]): readonly CandidateEdge[] {
  const grouped = new Map<string, CandidateEdge[]>();
  for (const edge of edges) {
    const key = edgeKey(edge.settlementId, edge.bankEntryId);
    const values = grouped.get(key) ?? [];
    values.push(edge);
    grouped.set(key, values);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([, values]) => {
      const first = values[0];
      if (first === undefined) throw new Error("candidate-edge invariant failed");
      return {
        settlementId: first.settlementId,
        bankEntryId: first.bankEntryId,
        evidence: [...new Set(values.flatMap((value) => value.evidence))].sort(compareCodeUnits),
        hypothesisIds: [...new Set(values.flatMap((value) => value.hypothesisIds))].sort(compareCodeUnits),
      };
    });
}

function exactKey(value: string | null, mode: RunConfig["mode"]): string | null {
  if (value === null || value.length === 0) return null;
  return mode === "baseline" ? value : exactUtrKey(value);
}

function eligibleCreditBanks(rows: readonly SourceRow<BankEntry>[]): SourceRow<BankEntry>[] {
  return rows
    .filter((row) => row.value.direction === "CREDIT")
    .sort((left, right) => compareCodeUnits(left.value.bankEntryId, right.value.bankEntryId));
}

function ledgerAllowsAutomatic(status: LedgerStatus): boolean {
  return status === "VERIFIED" || status === "NOT_APPLICABLE";
}

function overallForSettlement(
  bankStatus: BankStatus,
  ledgerStatus: LedgerStatus,
): TerminalState {
  if (bankStatus === "INVALID" || ledgerStatus === "INVALID") return "INVALID_INPUT";
  if (bankStatus === "AMBIGUOUS" || ledgerStatus === "AMBIGUOUS_REFERENCE") return "AMBIGUOUS";
  if (!ledgerAllowsAutomatic(ledgerStatus)) return "UNMATCHED";
  if (bankStatus === "AI_VERIFIED_MATCH") return "VERIFIED_ASSISTED_MATCH";
  if (bankStatus === "EXACT_UTR_MATCH" || bankStatus === "DETERMINISTIC_MATCH") return "EXACT_MATCH";
  return "UNMATCHED";
}

function reviewFor(status: TerminalState, bankStatus?: BankStatus): ReviewStatus {
  if (bankStatus === "OUT_OF_SCOPE") return "NOT_REQUIRED";
  return status === "EXACT_MATCH" || status === "VERIFIED_ASSISTED_MATCH"
    ? "NOT_REQUIRED"
    : "PENDING";
}

function idsForRows(
  exceptions: readonly ExceptionRecord[],
  rowIds: readonly RowId[],
  caseId?: CaseId,
): string[] {
  const wanted = new Set(rowIds);
  return exceptions
    .filter(
      (exception) =>
        exception.caseId === caseId || exception.evidenceRowIds.some((rowId) => wanted.has(rowId)),
    )
    .map((exception) => exception.exceptionId)
    .sort(compareCodeUnits);
}

function makeAuditEvents(
  runAt: EpochSeconds,
  exceptions: readonly ExceptionRecord[],
  settlements: readonly SettlementDecision[],
  hypotheses: readonly HypothesisVerdict[],
): readonly AuditEvent[] {
  const drafts: Omit<AuditEvent, "auditId" | "sequence">[] = [];
  for (const exception of exceptions) {
    drafts.push({
      atEpochSeconds: runAt,
      type:
        exception.stateHistory[0]?.to === "INVALID_INPUT"
          ? "INPUT_REJECTED"
          : "EXCEPTION_RAISED",
      subjectId: exception.caseId,
      detail: `${exception.code}: ${exception.message}`,
    });
  }
  for (const hypothesis of hypotheses) {
    drafts.push({
      atEpochSeconds: runAt,
      type: hypothesis.status === "VERIFIED" ? "HYPOTHESIS_VERIFIED" : "HYPOTHESIS_REJECTED",
      subjectId: hypothesis.hypothesisId,
      detail: hypothesis.reason,
    });
  }
  for (const settlement of settlements) {
    drafts.push({
      atEpochSeconds: runAt,
      type:
        settlement.overallStatus === "EXACT_MATCH" ||
        settlement.overallStatus === "VERIFIED_ASSISTED_MATCH"
          ? "MATCH_ACCEPTED"
          : "MATCH_ABSTAINED",
      subjectId: settlement.caseId,
      detail: `${settlement.bankStatus}/${settlement.ledgerStatus}/${settlement.overallStatus}`,
    });
  }
  drafts.sort((left, right) =>
    compareCodeUnits(
      `${left.type}\u0000${left.subjectId}\u0000${left.detail}`,
      `${right.type}\u0000${right.subjectId}\u0000${right.detail}`,
    ),
  );
  return drafts.map((draft, sequence) => {
    const withoutId = { ...draft, sequence };
    return {
      ...withoutId,
      auditId: `audit_${sha256Hex(canonicalJson(withoutId)).slice(0, 20)}`,
    };
  });
}

function summarize(
  inputRows: number,
  rowOutcomes: readonly RowOutcome[],
  settlements: readonly SettlementDecision[],
): RunSummary {
  const acceptedResidual = checkedSum(
    settlements
      .filter(
        (item) =>
          item.overallStatus === "EXACT_MATCH" ||
          item.overallStatus === "VERIFIED_ASSISTED_MATCH",
      )
      .map((item) => item.equation?.residualPaise ?? (0 as SignedPaise)),
    "accepted residual",
  );
  return {
    inputRows,
    rowOutcomes: rowOutcomes.length,
    settlements: settlements.length,
    exactMatches: settlements.filter((item) => item.overallStatus === "EXACT_MATCH").length,
    assistedMatches: settlements.filter((item) => item.overallStatus === "VERIFIED_ASSISTED_MATCH").length,
    ambiguous: settlements.filter((item) => item.overallStatus === "AMBIGUOUS").length,
    unmatched: settlements.filter((item) => item.overallStatus === "UNMATCHED").length,
    invalid: settlements.filter((item) => item.overallStatus === "INVALID_INPUT").length,
    manual: settlements.filter((item) => item.overallStatus === "MANUALLY_RESOLVED").length,
    acceptedResidualPaise: acceptedResidual,
    complete: inputRows === rowOutcomes.length,
  };
}

function withArtifactId(input: Omit<RunArtifact, "artifactId">): RunArtifact {
  const artifactId = `run_${sha256Hex(canonicalJson(input)).slice(0, 24)}`;
  return { ...input, artifactId };
}

export function runVouch(
  input: RunInput,
  configInput?: Partial<RunConfig>,
  rawHypotheses: readonly unknown[] = [],
): RunArtifact {
  const config = normalizeConfig(configInput);
  const ingested = ingestInput(input);
  const exceptions = createExceptionStore(config.runAtEpochSeconds);
  const invalidRowIds = new Set<RowId>();

  for (const rejected of ingested.rejected) {
    invalidRowIds.add(rejected.row.rowId);
    addRejectedInputException(exceptions, rejected);
  }

  const reconDuplicates = quarantineStableDuplicates(
    ingested.recon,
    (row) => `${row.value.type}\u0000${row.value.entityId}`,
    "DUPLICATE_IMPORT",
  );
  const bankDuplicates = quarantineStableDuplicates(
    ingested.bank,
    (row) => row.value.bankEntryId,
    "DUPLICATE_BANK_ENTRY",
  );
  const merchantDuplicates = quarantineStableDuplicates(
    ingested.merchant,
    (row) => row.value.recordId,
    "DUPLICATE_IMPORT",
  );
  const settlementDuplicates = quarantineStableDuplicates(
    ingested.settlements,
    (row) => row.value.settlementId,
    "DUPLICATE_IMPORT",
  );
  for (const result of [reconDuplicates, bankDuplicates, merchantDuplicates, settlementDuplicates]) {
    for (const row of result.quarantined) invalidRowIds.add(row.rowId);
    for (const issue of result.issues) addDuplicateIssue(exceptions, issue);
  }
  for (const issue of findVisibleBankDuplicates(bankDuplicates.active)) {
    addDuplicateIssue(exceptions, issue);
  }

  const initiallyGrouped = groupSettlements(
    reconDuplicates.active,
    settlementDuplicates.active,
    config,
  );
  const rejectedTaints = rejectedEvidenceTaints(ingested, config);
  const taintedSettlementIds = new Set<SettlementId>(rejectedTaints.settlements.keys());
  for (const bank of bankDuplicates.active) {
    const rejectedIds = rejectedTaints.banks.get(bank.value.bankEntryId);
    if (rejectedIds === undefined) continue;
    invalidRowIds.add(bank.rowId);
    exceptions.add({
      code: "INSUFFICIENT_EVIDENCE",
      caseId: caseIdForBank(bank.value.bankEntryId),
      evidenceRowIds: [bank.rowId, ...rejectedIds],
      message: `Bank record ${bank.value.bankEntryId} has a rejected occurrence with the same identity`,
      terminal: "INVALID_INPUT",
    });
  }
  for (const issue of reconDuplicates.issues.filter((item) => item.conflicting)) {
    const affectedRows = reconDuplicates.quarantined.filter((row) => issue.rowIds.includes(row.rowId));
    for (const row of affectedRows) taintedSettlementIds.add(row.value.settlementId);
  }
  for (const issue of settlementDuplicates.issues.filter((item) => item.conflicting)) {
    const affectedRows = settlementDuplicates.quarantined.filter((row) => issue.rowIds.includes(row.rowId));
    for (const row of affectedRows) taintedSettlementIds.add(row.value.settlementId);
  }
  const groups: readonly SettlementGroup[] = initiallyGrouped.map((group) => {
    if (!taintedSettlementIds.has(group.settlementId)) return group;
    const issue: GroupIssue = {
      code: "INSUFFICIENT_EVIDENCE",
      ownerId: group.settlementId,
      rowIds: [...group.rows.map((row) => row.rowId), ...(rejectedTaints.settlements.get(group.settlementId) ?? [])],
      message: `Settlement ${group.settlementId} depends on rejected or conflicting source evidence`,
    };
    return {
      ...group,
      valid: false,
      issues: [...group.issues, issue].sort((left, right) =>
        compareCodeUnits(`${left.code}\u0000${left.message}`, `${right.code}\u0000${right.message}`),
      ),
    };
  });
  const groupById = new Map(groups.map((group) => [group.settlementId, group]));
  for (const group of groups) {
    for (const issue of group.issues) addGroupIssue(exceptions, issue);
    if (!group.valid) for (const row of group.rows) invalidRowIds.add(row.rowId);
  }
  for (const entity of settlementDuplicates.active) {
    if (groupById.has(entity.value.settlementId)) continue;
    invalidRowIds.add(entity.rowId);
    exceptions.add({
      code: "INSUFFICIENT_EVIDENCE",
      caseId: caseIdForSettlement(entity.value.settlementId),
      evidenceRowIds: [entity.rowId],
      message: `Settlement entity ${entity.value.settlementId} has no recon rows`,
      terminal: "INVALID_INPUT",
    });
  }

  const ledgerCheck = checkMerchantLedger(groups, merchantDuplicates.active);
  for (const issue of ledgerCheck.issues) addLedgerIssue(exceptions, issue);

  const groupWork = new Map<SettlementId, GroupBankWork>();
  for (const group of groups) {
    groupWork.set(group.settlementId, {
      bankEntryId: null,
      bankStatus: group.valid ? "MISSING" : "INVALID",
      equation: null,
      evidence: [],
      candidateBankEntryIds: [],
    });
  }
  const bankWork = new Map<BankEntryId, BankWork>();
  for (const row of bankDuplicates.active) {
    bankWork.set(row.value.bankEntryId, {
      settlementId: null,
      bankStatus: rejectedTaints.banks.has(row.value.bankEntryId) ? "INVALID" : row.value.direction === "CREDIT" ? "UNKNOWN_CREDIT" : "OUT_OF_SCOPE",
    });
  }

  const validGroups = groups.filter((group) => group.valid);
  const creditBanks = eligibleCreditBanks(bankDuplicates.active.filter((row) => !rejectedTaints.banks.has(row.value.bankEntryId)));
  const groupsByUtr = new Map<string, SettlementGroup[]>();
  const banksByUtr = new Map<string, SourceRow<BankEntry>[]>();
  for (const group of validGroups) {
    const key = exactKey(group.settlementUtr, config.mode);
    if (key === null) continue;
    const values = groupsByUtr.get(key) ?? [];
    values.push(group);
    groupsByUtr.set(key, values);
  }
  for (const bank of creditBanks) {
    const key = exactKey(bank.value.utr, config.mode);
    if (key === null) continue;
    const values = banksByUtr.get(key) ?? [];
    values.push(bank);
    banksByUtr.set(key, values);
  }

  const committedGroups = new Set<SettlementId>();
  const committedBanks = new Set<BankEntryId>();
  const quarantinedGroups = new Set<SettlementId>();
  const quarantinedBanks = new Set<BankEntryId>();
  const allUtrKeys = [...new Set([...groupsByUtr.keys(), ...banksByUtr.keys()])].sort(compareCodeUnits);
  for (const key of allUtrKeys) {
    const candidateGroups = (groupsByUtr.get(key) ?? []).sort((left, right) =>
      compareCodeUnits(left.settlementId, right.settlementId),
    );
    const candidateBanks = (banksByUtr.get(key) ?? []).sort((left, right) =>
      compareCodeUnits(left.value.bankEntryId, right.value.bankEntryId),
    );
    if (candidateGroups.length === 1 && candidateBanks.length === 1) {
      const group = candidateGroups[0];
      const bank = candidateBanks[0];
      if (group === undefined || bank === undefined) throw new Error("UTR index invariant failed");
      const equation = equationFor(group, bank.value.amount);
      if (equation.residualPaise === 0) {
        committedGroups.add(group.settlementId);
        committedBanks.add(bank.value.bankEntryId);
        groupWork.set(group.settlementId, {
          bankEntryId: bank.value.bankEntryId,
          bankStatus: "EXACT_UTR_MATCH",
          equation,
          evidence: ["EXACT_UTR"],
          candidateBankEntryIds: [bank.value.bankEntryId],
        });
        bankWork.set(bank.value.bankEntryId, {
          settlementId: group.settlementId,
          bankStatus: "EXACT_UTR_MATCH",
        });
      } else {
        quarantinedGroups.add(group.settlementId);
        quarantinedBanks.add(bank.value.bankEntryId);
        groupWork.set(group.settlementId, {
          bankEntryId: bank.value.bankEntryId,
          bankStatus: "AMOUNT_MISMATCH",
          equation,
          evidence: ["EXACT_UTR"],
          candidateBankEntryIds: [bank.value.bankEntryId],
        });
        bankWork.set(bank.value.bankEntryId, {
          settlementId: group.settlementId,
          bankStatus: "AMOUNT_MISMATCH",
        });
        const code: ExceptionCode = equation.residualPaise < 0 ? "SHORT_CREDIT" : "EXCESS_CREDIT";
        exceptions.add({
          code,
          caseId: caseIdForSettlement(group.settlementId),
          evidenceRowIds: [...group.rows.map((row) => row.rowId), bank.rowId],
          equation,
          impactPaise: equation.residualPaise,
          message: `Exact UTR ${key} identifies the transfer, but the bank amount differs by ${equation.residualPaise} paise`,
          terminal: "UNMATCHED",
        });
      }
    } else if (candidateGroups.length > 0 && candidateBanks.length > 0) {
      const evidenceRowIds = [
        ...candidateGroups.flatMap((group) => group.rows.map((row) => row.rowId)),
        ...candidateBanks.map((bank) => bank.rowId),
      ];
      for (const group of candidateGroups) {
        exceptions.add({
          code: "UTR_CONFLICT",
          caseId: caseIdForSettlement(group.settlementId),
          evidenceRowIds,
          message: `UTR ${key} is not one-to-one and was not greedily committed`,
          terminal: "AMBIGUOUS",
        });
      }
    }
  }

  const survivorGroups = validGroups.filter(
    (group) => !committedGroups.has(group.settlementId) && !quarantinedGroups.has(group.settlementId),
  );
  const survivorBanks = creditBanks.filter(
    (bank) => !committedBanks.has(bank.value.bankEntryId) && !quarantinedBanks.has(bank.value.bankEntryId),
  );

  const edgeDrafts: CandidateEdge[] = [];
  for (const group of survivorGroups) {
    for (const bank of survivorBanks) {
      if (bank.value.amount !== group.calculatedPaise) continue;
      if (config.mode === "baseline") {
        if (
          group.settlementUtr !== null &&
          bank.value.utr !== null &&
          group.settlementUtr === bank.value.utr
        ) {
          edgeDrafts.push({
            settlementId: group.settlementId,
            bankEntryId: bank.value.bankEntryId,
            evidence: ["EXACT_UTR"],
            hypothesisIds: [],
          });
        }
        continue;
      }
      if (
        group.settledDate === null ||
        !isWithinPostingWindow(group.settledDate, bank.value.postingDate, config.postingWindowDays)
      ) {
        continue;
      }
      const evidence = deterministicUtrEvidence(
        group.settlementUtr,
        bank.value.utr,
        bank.value.narration,
        {
          knownPrefixes: config.knownUtrPrefixes,
          minimumTruncatedLength: config.minimumTruncatedUtrLength,
        },
      );
      if (evidence.length > 0) {
        edgeDrafts.push({
          settlementId: group.settlementId,
          bankEntryId: bank.value.bankEntryId,
          evidence,
          hypothesisIds: [],
        });
      }
    }
  }

  let hypothesisVerdicts: readonly HypothesisVerdict[] = [];
  if (config.mode === "hybrid" && config.aiMode !== "off") {
    hypothesisVerdicts = verifyAiHypotheses({
      rawHypotheses,
      groups: survivorGroups,
      bankRows: survivorBanks,
      eligibleSettlementIds: new Set(survivorGroups.map((group) => group.settlementId)),
      eligibleBankEntryIds: new Set(survivorBanks.map((bank) => bank.value.bankEntryId)),
      ledgerPresentSettlementIds: ledgerCheck.ledgerPresentSettlementIds,
      config,
    });
    edgeDrafts.push(
      ...hypothesisVerdicts.flatMap((verdict) =>
        verdict.status === "VERIFIED" && verdict.addedEdge !== null ? [verdict.addedEdge] : [],
      ),
    );
    for (const verdict of hypothesisVerdicts) {
      if (verdict.status !== "REJECTED") continue;
      const subject = survivorBanks.find(
        (bank) => bank.value.bankEntryId === verdict.subjectBankEntryId,
      );
      const candidate = survivorGroups.find(
        (group) => group.settlementId === verdict.candidateSettlementId,
      );
      const caseId =
        candidate !== undefined
          ? caseIdForSettlement(candidate.settlementId)
          : caseIdForBank(verdict.subjectBankEntryId ?? verdict.hypothesisId);
      exceptions.add({
        code: "HYPOTHESIS_REJECTED",
        caseId,
        evidenceRowIds: [
          ...(candidate?.rows.map((row) => row.rowId) ?? []),
          ...(subject === undefined ? [] : [subject.rowId]),
        ],
        message: `${verdict.hypothesisId}: ${verdict.reason}`,
        terminal: "UNMATCHED",
      });
    }
  }

  const candidateEdges = mergeEdges(edgeDrafts);
  const matching = analyzeMatching(
    survivorGroups.map((group) => group.settlementId),
    survivorBanks.map((bank) => bank.value.bankEntryId),
    candidateEdges.map((edge) => ({ left: edge.settlementId, right: edge.bankEntryId })),
  );
  const edgeByKey = new Map(
    candidateEdges.map((edge) => [edgeKey(edge.settlementId, edge.bankEntryId), edge]),
  );
  const candidateBanksByGroup = new Map<SettlementId, BankEntryId[]>();
  for (const edge of candidateEdges) {
    const values = candidateBanksByGroup.get(edge.settlementId) ?? [];
    values.push(edge.bankEntryId);
    candidateBanksByGroup.set(edge.settlementId, values);
  }

  for (const edge of matching.requiredEdges) {
    const group = groupById.get(edge.left as SettlementId);
    const bank = survivorBanks.find((row) => row.value.bankEntryId === edge.right);
    const candidate = edgeByKey.get(edgeKey(edge.left, edge.right));
    if (group === undefined || bank === undefined || candidate === undefined) {
      throw new Error("required matching edge refers to a missing record");
    }
    const equation = equationFor(group, bank.value.amount);
    if (equation.residualPaise !== 0) {
      throw new Error("candidate graph admitted a non-zero-residual required edge");
    }
    const hasDeterministicEvidence = candidate.evidence.some((value) => value !== "AI_HYPOTHESIS");
    const bankStatus: BankStatus = hasDeterministicEvidence
      ? "DETERMINISTIC_MATCH"
      : "AI_VERIFIED_MATCH";
    groupWork.set(group.settlementId, {
      bankEntryId: bank.value.bankEntryId,
      bankStatus,
      equation,
      evidence: candidate.evidence,
      candidateBankEntryIds: [...new Set(candidateBanksByGroup.get(group.settlementId) ?? [])].sort(
        compareCodeUnits,
      ),
    });
    bankWork.set(bank.value.bankEntryId, {
      settlementId: group.settlementId,
      bankStatus,
    });
  }

  const ambiguousGroupIds = new Set(matching.ambiguousLeft as SettlementId[]);
  const ambiguousBankIds = new Set(matching.ambiguousRight as BankEntryId[]);
  for (const group of survivorGroups) {
    if (!ambiguousGroupIds.has(group.settlementId)) continue;
    const candidateIds = [...new Set(candidateBanksByGroup.get(group.settlementId) ?? [])].sort(compareCodeUnits);
    groupWork.set(group.settlementId, {
      bankEntryId: null,
      bankStatus: "AMBIGUOUS",
      equation: null,
      evidence: [],
      candidateBankEntryIds: candidateIds,
    });
    const bankRows = survivorBanks.filter((bank) => candidateIds.includes(bank.value.bankEntryId));
    exceptions.add({
      code: "AMBIGUOUS_CANDIDATES",
      caseId: caseIdForSettlement(group.settlementId),
      evidenceRowIds: [...group.rows.map((row) => row.rowId), ...bankRows.map((row) => row.rowId)],
      message: `Settlement ${group.settlementId} has more than one globally optimal disposition; Vouch refused to guess`,
      terminal: "AMBIGUOUS",
    });
  }
  for (const bankId of ambiguousBankIds) {
    bankWork.set(bankId, { settlementId: null, bankStatus: "AMBIGUOUS" });
  }

  const unmatchedGroupIds = new Set(matching.unmatchedLeft as SettlementId[]);
  for (const group of survivorGroups) {
    if (!unmatchedGroupIds.has(group.settlementId)) continue;
    const equation = equationFor(group, 0 as Paise);
    groupWork.set(group.settlementId, {
      bankEntryId: null,
      bankStatus: "MISSING",
      equation,
      evidence: [],
      candidateBankEntryIds: [...new Set(candidateBanksByGroup.get(group.settlementId) ?? [])].sort(
        compareCodeUnits,
      ),
    });
    exceptions.add({
      code: "MISSING_BANK_ENTRY",
      caseId: caseIdForSettlement(group.settlementId),
      evidenceRowIds: group.rows.map((row) => row.rowId),
      equation,
      impactPaise: equation.residualPaise,
      message: `No uniquely supportable bank credit exists for settlement ${group.settlementId}`,
      terminal: "UNMATCHED",
    });
  }
  const unmatchedBankIds = new Set(matching.unmatchedRight as BankEntryId[]);
  for (const bank of survivorBanks) {
    if (!unmatchedBankIds.has(bank.value.bankEntryId)) continue;
    bankWork.set(bank.value.bankEntryId, {
      settlementId: null,
      bankStatus: "UNKNOWN_CREDIT",
    });
    const equation = equationForUnknownBank(bank.value.amount);
    exceptions.add({
      code: "UNKNOWN_BANK_CREDIT",
      caseId: caseIdForBank(bank.value.bankEntryId),
      evidenceRowIds: [bank.rowId],
      equation,
      impactPaise: equation.residualPaise,
      message: `Bank credit ${bank.value.bankEntryId} has no uniquely supportable Razorpay settlement`,
      terminal: "UNMATCHED",
    });
  }

  const exceptionValues = [...exceptions.values.values()].sort((left, right) =>
    compareCodeUnits(left.exceptionId, right.exceptionId),
  );

  const settlementDecisions: SettlementDecision[] = groups.map((group) => {
    const work = groupWork.get(group.settlementId);
    if (work === undefined) throw new Error("missing settlement work state");
    const ledgerStatus = group.valid
      ? (ledgerCheck.groupStatuses.get(group.settlementId) ?? "NOT_APPLICABLE")
      : "INVALID";
    const overallStatus = overallForSettlement(work.bankStatus, ledgerStatus);
    const caseId = caseIdForSettlement(group.settlementId);
    const evidenceRows = [
      ...group.rows.map((row) => row.rowId),
      ...(ledgerCheck.merchantRowIdsBySettlement.get(group.settlementId) ?? []),
      ...bankDuplicates.active
        .filter((bank) => bank.value.bankEntryId === work.bankEntryId)
        .map((bank) => bank.rowId),
    ];
    return {
      caseId,
      settlementId: group.settlementId,
      settlementUtr: group.settlementUtr,
      bankEntryId: work.bankEntryId,
      bankStatus: work.bankStatus,
      ledgerStatus,
      reviewStatus: reviewFor(overallStatus),
      overallStatus,
      equation: work.equation,
      reconRowIds: group.rows.map((row) => row.rowId).sort(compareCodeUnits),
      merchantRowIds: [...(ledgerCheck.merchantRowIdsBySettlement.get(group.settlementId) ?? [])].sort(
        compareCodeUnits,
      ),
      candidateBankEntryIds: [...work.candidateBankEntryIds].sort(compareCodeUnits),
      evidence: [...work.evidence].sort(compareCodeUnits),
      warnings: [...group.warnings].sort(compareCodeUnits),
      exceptionIds: idsForRows(exceptionValues, evidenceRows, caseId),
      stateHistory: [
        {
          atEpochSeconds: config.runAtEpochSeconds,
          from: null,
          to: overallStatus,
          reason: `${work.bankStatus}/${ledgerStatus}`,
          actor: "SYSTEM",
        },
      ],
    };
  });
  settlementDecisions.sort((left, right) => compareCodeUnits(left.settlementId, right.settlementId));
  const settlementDecisionById = new Map(
    settlementDecisions.map((decision) => [decision.settlementId, decision]),
  );

  const bankDecisions: BankDecision[] = bankDuplicates.active.map((row) => {
    const work = bankWork.get(row.value.bankEntryId) ?? {
      settlementId: null,
      bankStatus: "INVALID" as const,
    };
    const linked = work.settlementId === null ? null : settlementDecisionById.get(work.settlementId) ?? null;
    let overallStatus: TerminalState;
    if (work.bankStatus === "OUT_OF_SCOPE") overallStatus = "UNMATCHED";
    else if (work.bankStatus === "INVALID") overallStatus = "INVALID_INPUT";
    else if (work.bankStatus === "AMBIGUOUS") overallStatus = "AMBIGUOUS";
    else if (work.bankStatus === "AMOUNT_MISMATCH" || work.bankStatus === "UNKNOWN_CREDIT") overallStatus = "UNMATCHED";
    else overallStatus = linked?.overallStatus ?? "UNMATCHED";
    return {
      bankEntryId: row.value.bankEntryId,
      rowId: row.rowId,
      settlementId: work.settlementId,
      bankStatus: work.bankStatus,
      reviewStatus: reviewFor(overallStatus, work.bankStatus),
      overallStatus,
      exceptionIds: idsForRows(
        exceptionValues,
        [row.rowId],
        work.settlementId === null
          ? caseIdForBank(row.value.bankEntryId)
          : caseIdForSettlement(work.settlementId),
      ),
    };
  });
  bankDecisions.sort((left, right) => compareCodeUnits(left.rowId, right.rowId));
  const bankDecisionByRow = new Map(bankDecisions.map((decision) => [decision.rowId, decision]));

  const ledgerDecisions: LedgerDecision[] = ledgerCheck.merchants.map((check) => {
    const linked =
      check.settlementId === null ? null : settlementDecisionById.get(check.settlementId) ?? null;
    let overallStatus: TerminalState;
    if (check.status === "AMBIGUOUS_REFERENCE") overallStatus = "AMBIGUOUS";
    else if (check.status === "VERIFIED" || check.status === "NOT_APPLICABLE") {
      overallStatus = linked?.overallStatus ?? "UNMATCHED";
    } else overallStatus = "UNMATCHED";
    return {
      recordId: check.row.value.recordId,
      rowId: check.row.rowId,
      reconRowId: check.reconRow?.rowId ?? null,
      settlementId: check.settlementId,
      ledgerStatus: check.status,
      reviewStatus: reviewFor(overallStatus),
      overallStatus,
      exceptionIds: idsForRows(
        exceptionValues,
        [check.row.rowId, ...(check.reconRow === null ? [] : [check.reconRow.rowId])],
        check.settlementId === null ? undefined : caseIdForSettlement(check.settlementId),
      ),
    };
  });
  ledgerDecisions.sort((left, right) => compareCodeUnits(left.rowId, right.rowId));
  const ledgerDecisionByRow = new Map(ledgerDecisions.map((decision) => [decision.rowId, decision]));

  const reconSettlementByRow = new Map(
    groups.flatMap((group) => group.rows.map((row) => [row.rowId, group.settlementId] as const)),
  );
  const settlementEntityByRow = new Map(
    settlementDuplicates.active.map((row) => [row.rowId, row.value.settlementId] as const),
  );
  const rowOutcomes: RowOutcome[] = ingested.allRows.map((row) => {
    const exceptionIds = idsForRows(exceptionValues, [row.rowId]);
    if (invalidRowIds.has(row.rowId)) {
      return {
        rowId: row.rowId,
        source: row.source,
        ownerId: row.rowId,
        overallStatus: "INVALID_INPUT",
        exceptionIds,
      };
    }
    if (row.source === "RAZORPAY") {
      const settlementId = reconSettlementByRow.get(row.rowId);
      const decision = settlementId === undefined ? undefined : settlementDecisionById.get(settlementId);
      return {
        rowId: row.rowId,
        source: row.source,
        ownerId: settlementId ?? row.rowId,
        overallStatus: decision?.overallStatus ?? "INVALID_INPUT",
        exceptionIds,
      };
    }
    if (row.source === "BANK") {
      const decision = bankDecisionByRow.get(row.rowId);
      return {
        rowId: row.rowId,
        source: row.source,
        ownerId: decision?.bankEntryId ?? row.rowId,
        overallStatus: decision?.overallStatus ?? "INVALID_INPUT",
        exceptionIds,
      };
    }
    if (row.source === "MERCHANT") {
      const decision = ledgerDecisionByRow.get(row.rowId);
      return {
        rowId: row.rowId,
        source: row.source,
        ownerId: decision?.recordId ?? row.rowId,
        overallStatus: decision?.overallStatus ?? "INVALID_INPUT",
        exceptionIds,
      };
    }
    const settlementId = settlementEntityByRow.get(row.rowId);
    const decision = settlementId === undefined ? undefined : settlementDecisionById.get(settlementId);
    return {
      rowId: row.rowId,
      source: row.source,
      ownerId: settlementId ?? row.rowId,
      overallStatus: decision?.overallStatus ?? "INVALID_INPUT",
      exceptionIds,
    };
  });
  rowOutcomes.sort((left, right) => compareCodeUnits(left.rowId, right.rowId));

  const summary = summarize(ingested.allRows.length, rowOutcomes, settlementDecisions);
  const auditEvents = makeAuditEvents(
    config.runAtEpochSeconds,
    exceptionValues,
    settlementDecisions,
    hypothesisVerdicts,
  );
  const artifact = withArtifactId({
    schemaVersion: "vouch.run/1",
    runAtEpochSeconds: config.runAtEpochSeconds,
    config,
    inputs: ingested.summaries,
    sourceRows: ingested.allRows.map((row) => ({
      rowId: row.rowId,
      source: row.source,
      contentHash: row.contentHash,
      duplicateOrdinal: row.duplicateOrdinal,
      raw: row.raw,
    })),
    settlements: settlementDecisions,
    bankEntries: bankDecisions,
    ledger: ledgerDecisions,
    rowOutcomes,
    exceptions: exceptionValues,
    hypotheses: hypothesisVerdicts,
    candidateEdges,
    auditEvents,
    summary,
  });
  assertRunArtifactInvariants(artifact);
  return artifact;
}

export function assertRunArtifactInvariants(artifact: RunArtifact): void {
  const inputCount = artifact.inputs.reduce((total, input) => total + input.inputRowCount, 0);
  if (inputCount !== artifact.rowOutcomes.length || !artifact.summary.complete) {
    throw new Error(`completeness invariant failed: ${inputCount} inputs, ${artifact.rowOutcomes.length} outcomes`);
  }
  const rowIds = artifact.rowOutcomes.map((row) => row.rowId);
  if (new Set(rowIds).size !== rowIds.length) {
    throw new Error("completeness invariant failed: duplicate row outcome");
  }
  const sourceRowIds = artifact.sourceRows.map((row) => row.rowId);
  if (
    sourceRowIds.length !== rowIds.length ||
    new Set(sourceRowIds).size !== sourceRowIds.length ||
    [...sourceRowIds].sort(compareCodeUnits).join("\u0000") !==
      [...rowIds].sort(compareCodeUnits).join("\u0000")
  ) {
    throw new Error("evidence invariant failed: source evidence and outcomes do not form the same partition");
  }
  const assignedBanks = new Set<BankEntryId>();
  for (const settlement of artifact.settlements) {
    const accepted =
      settlement.overallStatus === "EXACT_MATCH" ||
      settlement.overallStatus === "VERIFIED_ASSISTED_MATCH";
    if (accepted) {
      if (
        settlement.bankEntryId === null ||
        settlement.equation === null ||
        settlement.equation.residualPaise !== 0
      ) {
        throw new Error(`zero-residual invariant failed for ${settlement.settlementId}`);
      }
      if (assignedBanks.has(settlement.bankEntryId)) {
        throw new Error(`one-to-one invariant failed for bank entry ${settlement.bankEntryId}`);
      }
      assignedBanks.add(settlement.bankEntryId);
    }
  }
  if (artifact.summary.acceptedResidualPaise !== 0) {
    throw new Error("accepted residual total is not zero");
  }
  const evidenceUniverse = new Set(rowIds);
  for (const exception of artifact.exceptions) {
    for (const rowId of exception.evidenceRowIds) {
      if (!evidenceUniverse.has(rowId)) {
        throw new Error(`exception ${exception.exceptionId} references unknown row ${rowId}`);
      }
    }
  }
}

function recalculateArtifactSummary(artifact: Omit<RunArtifact, "artifactId" | "summary">): RunSummary {
  return summarize(
    artifact.inputs.reduce((total, input) => total + input.inputRowCount, 0),
    artifact.rowOutcomes,
    artifact.settlements,
  );
}

export function applyManualResolution(
  artifact: RunArtifact,
  command: ManualResolutionCommand,
): RunArtifact {
  const note = command.note.trim();
  const actor = command.actor.trim();
  if (note.length === 0 || actor.length === 0) {
    throw new Error("manual resolution requires a non-empty note and actor");
  }
  const at = epochSeconds(command.atEpochSeconds, "manual-resolution timestamp");
  const target = artifact.settlements.find((item) => item.caseId === command.caseId);
  if (target === undefined) throw new Error(`unknown settlement case ${command.caseId}`);
  if (target.reviewStatus !== "PENDING") {
    throw new Error(`case ${command.caseId} does not require manual review`);
  }

  const transition = {
    atEpochSeconds: at,
    from: target.overallStatus,
    to: "MANUALLY_RESOLVED" as const,
    reason: note,
    actor: "HUMAN" as const,
  };
  const settlements = artifact.settlements.map((item) =>
    item.caseId === command.caseId
      ? {
          ...item,
          reviewStatus: "RESOLVED" as const,
          overallStatus: "MANUALLY_RESOLVED" as const,
          stateHistory: [...item.stateHistory, transition],
        }
      : item,
  );
  const affectedRows = new Set([
    ...target.reconRowIds,
    ...target.merchantRowIds,
    ...artifact.bankEntries
      .filter((item) => item.settlementId === target.settlementId)
      .map((item) => item.rowId),
  ]);
  const rowOutcomes = artifact.rowOutcomes.map((row) =>
    affectedRows.has(row.rowId)
      ? { ...row, overallStatus: "MANUALLY_RESOLVED" as const }
      : row,
  );
  const bankEntries = artifact.bankEntries.map((entry) =>
    entry.settlementId === target.settlementId
      ? {
          ...entry,
          reviewStatus: "RESOLVED" as const,
          overallStatus: "MANUALLY_RESOLVED" as const,
        }
      : entry,
  );
  const ledger = artifact.ledger.map((entry) =>
    entry.settlementId === target.settlementId
      ? {
          ...entry,
          reviewStatus: "RESOLVED" as const,
          overallStatus: "MANUALLY_RESOLVED" as const,
        }
      : entry,
  );
  const exceptions = artifact.exceptions.map((exception) =>
    exception.caseId === command.caseId
      ? { ...exception, stateHistory: [...exception.stateHistory, transition] }
      : exception,
  );
  const sequence = artifact.auditEvents.length;
  const auditWithoutId = {
    sequence,
    atEpochSeconds: at,
    type: "MANUAL_RESOLUTION" as const,
    subjectId: command.caseId,
    detail: `${actor}: ${note}`,
  };
  const auditEvents = [
    ...artifact.auditEvents,
    {
      ...auditWithoutId,
      auditId: `audit_${sha256Hex(canonicalJson(auditWithoutId)).slice(0, 20)}`,
    },
  ];
  const withoutSummary: Omit<RunArtifact, "artifactId" | "summary"> = {
    schemaVersion: artifact.schemaVersion,
    runAtEpochSeconds: artifact.runAtEpochSeconds,
    config: artifact.config,
    inputs: artifact.inputs,
    sourceRows: artifact.sourceRows,
    settlements,
    bankEntries,
    ledger,
    rowOutcomes,
    exceptions,
    hypotheses: artifact.hypotheses,
    candidateEdges: artifact.candidateEdges,
    auditEvents,
  };
  const resolved = withArtifactId({
    ...withoutSummary,
    summary: recalculateArtifactSummary(withoutSummary),
  });
  assertRunArtifactInvariants(resolved);
  return resolved;
}

export function canonicalArtifactJson(artifact: RunArtifact): string {
  assertRunArtifactInvariants(artifact);
  return canonicalJson(artifact);
}

/** Functional projection used for deterministic-vs-hybrid-off ablation checks. */
export function canonicalDecisionJson(artifact: RunArtifact): string {
  assertRunArtifactInvariants(artifact);
  return canonicalJson({
    inputs: artifact.inputs,
    sourceRows: artifact.sourceRows,
    settlements: artifact.settlements,
    bankEntries: artifact.bankEntries,
    ledger: artifact.ledger,
    rowOutcomes: artifact.rowOutcomes,
    exceptions: artifact.exceptions,
    hypotheses: artifact.hypotheses,
    candidateEdges: artifact.candidateEdges,
    auditEvents: artifact.auditEvents,
    summary: artifact.summary,
  });
}
