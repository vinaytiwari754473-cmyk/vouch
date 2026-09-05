import { canonicalJson, compareCodeUnits } from "./canonical";
import { assertRunArtifactInvariants } from "./engine";
import { sha256Hex } from "./sha256";
import type {
  AuditEvent,
  CandidateEdge,
  Equation,
  EvidenceRow,
  ExceptionRecord,
  HypothesisVerdict,
  InputSummary,
  JsonObject,
  RowId,
  RunArtifact,
  RunSummary,
  SettlementDecision,
} from "./types";

export const MAX_RUN_ARTIFACT_JSON_BYTES = 25 * 1024 * 1024;

export class ArtifactValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ArtifactValidationError";
  }
}

type RecordValue = Record<string, unknown>;

const SOURCES = ["RAZORPAY", "BANK", "MERCHANT", "SETTLEMENT"] as const;
const TERMINAL_STATES = [
  "EXACT_MATCH",
  "VERIFIED_ASSISTED_MATCH",
  "AMBIGUOUS",
  "UNMATCHED",
  "INVALID_INPUT",
  "MANUALLY_RESOLVED",
] as const;
const BANK_STATUSES = [
  "EXACT_UTR_MATCH",
  "DETERMINISTIC_MATCH",
  "AI_VERIFIED_MATCH",
  "AMOUNT_MISMATCH",
  "AMBIGUOUS",
  "MISSING",
  "UNKNOWN_CREDIT",
  "OUT_OF_SCOPE",
  "INVALID",
] as const;
const LEDGER_STATUSES = [
  "VERIFIED",
  "MISSING_MERCHANT_RECORD",
  "MISSING_RAZORPAY_ROW",
  "AMOUNT_MISMATCH",
  "AMBIGUOUS_REFERENCE",
  "NOT_APPLICABLE",
  "INVALID",
] as const;
const REVIEW_STATUSES = ["NOT_REQUIRED", "PENDING", "RESOLVED"] as const;
const EXCEPTION_CODES = [
  "SHORT_CREDIT",
  "EXCESS_CREDIT",
  "MISSING_BANK_ENTRY",
  "UNKNOWN_BANK_CREDIT",
  "DUPLICATE_BANK_ENTRY",
  "DUPLICATE_IMPORT",
  "GROUP_SUM_MISMATCH",
  "MISSING_RAZORPAY_ROW",
  "MISSING_MERCHANT_LEDGER_RECORD",
  "LEDGER_AMOUNT_MISMATCH",
  "CURRENCY_MISMATCH",
  "MALFORMED_AMOUNT",
  "AMBIGUOUS_CANDIDATES",
  "UTR_CONFLICT",
  "HYPOTHESIS_REJECTED",
  "INSUFFICIENT_EVIDENCE",
] as const;
const SUGGESTED_ACTIONS = [
  "CHECK_BANK",
  "CHECK_RAZORPAY",
  "CHECK_MERCHANT_LEDGER",
  "REVIEW_CANDIDATES",
  "CORRECT_INPUT",
] as const;
const CANDIDATE_EVIDENCE = [
  "EXACT_UTR",
  "SPACE_CASE_UTR",
  "PREFIX_STRIP",
  "TRUNCATED_UTR",
  "NARRATION_TOKEN",
  "AI_HYPOTHESIS",
] as const;
const TEST_NAMES = [
  "NORMALIZED_UTR_MATCH",
  "EXACT_AMOUNT_MATCH",
  "POSTING_WINDOW_MATCH",
  "DUPLICATE_HASH_MATCH",
  "LEDGER_PRESENCE_CHECK",
  "LITERAL_SPAN",
  "CANDIDATE_EXISTS",
  "CURRENCY_MATCH",
] as const;
const AUDIT_TYPES = [
  "INPUT_REJECTED",
  "EXCEPTION_RAISED",
  "MATCH_ACCEPTED",
  "MATCH_ABSTAINED",
  "HYPOTHESIS_VERIFIED",
  "HYPOTHESIS_REJECTED",
  "MANUAL_RESOLUTION",
] as const;

function fail(path: string, message: string): never {
  throw new ArtifactValidationError(`${path}: ${message}`);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function assertPlainRecord(value: unknown, path: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, `expected an object, received ${describe(value)}`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(path, "expected a plain JSON object");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(path, "symbol keys are not valid JSON");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      fail(`${path}.${key}`, "expected an enumerable data property");
    }
  }
  return value as RecordValue;
}

function exactObject(value: unknown, path: string, keys: readonly string[]): RecordValue {
  const record = assertPlainRecord(value, path);
  const expected = new Set(keys);
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) fail(`${path}.${key}`, "is required");
  }
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) fail(`${path}.${key}`, "is not allowed");
  }
  return record;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return fail(path, `expected an array, received ${describe(value)}`);
  const expectedKeys = new Set(Array.from({ length: value.length }, (_, index) => String(index)));
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) fail(`${path}.${key}`, "array properties are not valid JSON");
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(`${path}[${index}]`, "sparse arrays are not valid JSON");
  }
  return value;
}

function stringValue(value: unknown, path: string, nonEmpty = false): string {
  if (typeof value !== "string") return fail(path, `expected a string, received ${describe(value)}`);
  if (nonEmpty && value.length === 0) fail(path, "must not be empty");
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : stringValue(value, path);
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, `expected a boolean, received ${describe(value)}`);
  return value;
}

function safeInteger(value: unknown, path: string, minimum?: number, maximum?: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0)) {
    return fail(path, "expected a safe integer (negative zero is forbidden)");
  }
  if (minimum !== undefined && value < minimum) fail(path, `must be at least ${minimum}`);
  if (maximum !== undefined && value > maximum) fail(path, `must be at most ${maximum}`);
  return value;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return fail(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function regexString(value: unknown, path: string, pattern: RegExp, label: string): string {
  const result = stringValue(value, path, true);
  if (!pattern.test(result)) fail(path, `expected ${label}`);
  return result;
}

function stringArray(
  value: unknown,
  path: string,
  options: { nonEmptyItems?: boolean; unique?: boolean } = {},
): readonly string[] {
  const result = asArray(value, path).map((item, index) =>
    stringValue(item, `${path}[${index}]`, options.nonEmptyItems ?? false),
  );
  if (options.unique && new Set(result).size !== result.length) fail(path, "must not contain duplicates");
  return result;
}

function enumArray<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
): readonly T[number][] {
  const result = asArray(value, path).map((item, index) =>
    enumValue(item, `${path}[${index}]`, allowed),
  );
  if (new Set(result).size !== result.length) fail(path, "must not contain duplicates");
  return result;
}

function jsonValue(value: unknown, path: string, active: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail(path, "contains a non-canonical number");
    return;
  }
  if (typeof value !== "object") fail(path, `contains unsupported JSON value ${typeof value}`);
  if (active.has(value)) fail(path, "contains a circular reference");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      for (const [index, item] of asArray(value, path).entries()) {
        jsonValue(item, `${path}[${index}]`, active);
      }
      return;
    }
    const record = assertPlainRecord(value, path);
    for (const [key, item] of Object.entries(record)) jsonValue(item, `${path}.${key}`, active);
  } finally {
    active.delete(value);
  }
}

function jsonObject(value: unknown, path: string): JsonObject {
  const record = assertPlainRecord(value, path);
  jsonValue(record, path, new WeakSet<object>());
  return record as JsonObject;
}

function sha256(value: unknown, path: string): string {
  return regexString(value, path, /^[0-9a-f]{64}$/, "a lowercase SHA-256 digest");
}

function epoch(value: unknown, path: string): number {
  const result = safeInteger(value, path, 0);
  if (!Number.isSafeInteger((result + 19_800) * 1000)) fail(path, "is outside the supported date range");
  return result;
}

function stateHistory(value: unknown, path: string): void {
  const transitions = asArray(value, path);
  let prior: string | null = null;
  transitions.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = exactObject(item, itemPath, ["atEpochSeconds", "from", "to", "reason", "actor"]);
    epoch(record.atEpochSeconds, `${itemPath}.atEpochSeconds`);
    const from = record.from === null ? null : enumValue(record.from, `${itemPath}.from`, TERMINAL_STATES);
    const to = enumValue(record.to, `${itemPath}.to`, TERMINAL_STATES);
    stringValue(record.reason, `${itemPath}.reason`, true);
    enumValue(record.actor, `${itemPath}.actor`, ["SYSTEM", "HUMAN"] as const);
    if (index === 0 && from !== null) fail(`${itemPath}.from`, "the first transition must start at null");
    if (index > 0 && from !== prior) fail(`${itemPath}.from`, `must continue from ${String(prior)}`);
    prior = to;
  });
}

function candidateEdge(value: unknown, path: string): void {
  const record = exactObject(value, path, ["settlementId", "bankEntryId", "evidence", "hypothesisIds"]);
  stringValue(record.settlementId, `${path}.settlementId`, true);
  stringValue(record.bankEntryId, `${path}.bankEntryId`, true);
  const evidence = enumArray(record.evidence, `${path}.evidence`, CANDIDATE_EVIDENCE);
  if (evidence.length === 0) fail(`${path}.evidence`, "must include at least one evidence class");
  stringArray(record.hypothesisIds, `${path}.hypothesisIds`, { nonEmptyItems: true, unique: true });
}

function equation(value: unknown, path: string): void {
  const record = exactObject(value, path, ["expectedPaise", "actualPaise", "residualPaise", "terms"]);
  const expected = safeInteger(record.expectedPaise, `${path}.expectedPaise`, 0);
  const actual = safeInteger(record.actualPaise, `${path}.actualPaise`, 0);
  const residual = safeInteger(record.residualPaise, `${path}.residualPaise`);
  let contributionTotal = 0n;
  const termRows = new Set<string>();
  asArray(record.terms, `${path}.terms`).forEach((item, index) => {
    const itemPath = `${path}.terms[${index}]`;
    const term = exactObject(item, itemPath, [
      "rowId",
      "entityId",
      "creditPaise",
      "debitPaise",
      "contributionPaise",
    ]);
    const rowId = stringValue(term.rowId, `${itemPath}.rowId`, true);
    stringValue(term.entityId, `${itemPath}.entityId`, true);
    const credit = safeInteger(term.creditPaise, `${itemPath}.creditPaise`, 0);
    const debit = safeInteger(term.debitPaise, `${itemPath}.debitPaise`, 0);
    const contribution = safeInteger(term.contributionPaise, `${itemPath}.contributionPaise`);
    if (BigInt(contribution) !== BigInt(credit) - BigInt(debit)) {
      fail(`${itemPath}.contributionPaise`, "must equal creditPaise - debitPaise");
    }
    if (termRows.has(rowId)) fail(`${itemPath}.rowId`, "duplicates an equation term");
    termRows.add(rowId);
    contributionTotal += BigInt(contribution);
  });
  if (contributionTotal !== BigInt(expected)) {
    fail(`${path}.expectedPaise`, "must equal the exact sum of term contributions");
  }
  if (BigInt(residual) !== BigInt(actual) - BigInt(expected)) {
    fail(`${path}.residualPaise`, "must equal actualPaise - expectedPaise");
  }
}

function nullableEquation(value: unknown, path: string): void {
  if (value !== null) equation(value, path);
}

function inputSummary(value: unknown, path: string): void {
  const record = exactObject(value, path, ["source", "logicalHash", "inputRowCount"]);
  enumValue(record.source, `${path}.source`, SOURCES);
  sha256(record.logicalHash, `${path}.logicalHash`);
  safeInteger(record.inputRowCount, `${path}.inputRowCount`, 0);
}

function evidenceRow(value: unknown, path: string): void {
  const record = exactObject(value, path, ["rowId", "source", "contentHash", "duplicateOrdinal", "raw"]);
  regexString(
    record.rowId,
    `${path}.rowId`,
    /^(?:razorpay|bank|merchant|settlement)_[0-9a-f]{64}_[0-9]+$/,
    "a source row ID",
  );
  enumValue(record.source, `${path}.source`, SOURCES);
  sha256(record.contentHash, `${path}.contentHash`);
  safeInteger(record.duplicateOrdinal, `${path}.duplicateOrdinal`, 0);
  jsonObject(record.raw, `${path}.raw`);
}

function settlement(value: unknown, path: string): void {
  const record = exactObject(value, path, [
    "caseId",
    "settlementId",
    "settlementUtr",
    "bankEntryId",
    "bankStatus",
    "ledgerStatus",
    "reviewStatus",
    "overallStatus",
    "equation",
    "reconRowIds",
    "merchantRowIds",
    "candidateBankEntryIds",
    "evidence",
    "warnings",
    "exceptionIds",
    "stateHistory",
  ]);
  stringValue(record.caseId, `${path}.caseId`, true);
  stringValue(record.settlementId, `${path}.settlementId`, true);
  nullableString(record.settlementUtr, `${path}.settlementUtr`);
  nullableString(record.bankEntryId, `${path}.bankEntryId`);
  enumValue(record.bankStatus, `${path}.bankStatus`, BANK_STATUSES);
  enumValue(record.ledgerStatus, `${path}.ledgerStatus`, LEDGER_STATUSES);
  enumValue(record.reviewStatus, `${path}.reviewStatus`, REVIEW_STATUSES);
  const overallStatus = enumValue(record.overallStatus, `${path}.overallStatus`, TERMINAL_STATES);
  nullableEquation(record.equation, `${path}.equation`);
  stringArray(record.reconRowIds, `${path}.reconRowIds`, { nonEmptyItems: true, unique: true });
  stringArray(record.merchantRowIds, `${path}.merchantRowIds`, { nonEmptyItems: true, unique: true });
  stringArray(record.candidateBankEntryIds, `${path}.candidateBankEntryIds`, {
    nonEmptyItems: true,
    unique: true,
  });
  enumArray(record.evidence, `${path}.evidence`, CANDIDATE_EVIDENCE);
  stringArray(record.warnings, `${path}.warnings`);
  stringArray(record.exceptionIds, `${path}.exceptionIds`, { nonEmptyItems: true, unique: true });
  stateHistory(record.stateHistory, `${path}.stateHistory`);
  const history = record.stateHistory as readonly RecordValue[];
  if (history.length === 0) fail(`${path}.stateHistory`, "must include the settlement decision");
  if (history.at(-1)?.to !== overallStatus) {
    fail(`${path}.stateHistory`, "final transition must equal overallStatus");
  }
}

function bankDecision(value: unknown, path: string): void {
  const record = exactObject(value, path, [
    "bankEntryId",
    "rowId",
    "settlementId",
    "bankStatus",
    "reviewStatus",
    "overallStatus",
    "exceptionIds",
  ]);
  stringValue(record.bankEntryId, `${path}.bankEntryId`, true);
  stringValue(record.rowId, `${path}.rowId`, true);
  nullableString(record.settlementId, `${path}.settlementId`);
  enumValue(record.bankStatus, `${path}.bankStatus`, BANK_STATUSES);
  enumValue(record.reviewStatus, `${path}.reviewStatus`, REVIEW_STATUSES);
  enumValue(record.overallStatus, `${path}.overallStatus`, TERMINAL_STATES);
  stringArray(record.exceptionIds, `${path}.exceptionIds`, { nonEmptyItems: true, unique: true });
}

function ledgerDecision(value: unknown, path: string): void {
  const record = exactObject(value, path, [
    "recordId",
    "rowId",
    "reconRowId",
    "settlementId",
    "ledgerStatus",
    "reviewStatus",
    "overallStatus",
    "exceptionIds",
  ]);
  stringValue(record.recordId, `${path}.recordId`, true);
  stringValue(record.rowId, `${path}.rowId`, true);
  nullableString(record.reconRowId, `${path}.reconRowId`);
  nullableString(record.settlementId, `${path}.settlementId`);
  enumValue(record.ledgerStatus, `${path}.ledgerStatus`, LEDGER_STATUSES);
  enumValue(record.reviewStatus, `${path}.reviewStatus`, REVIEW_STATUSES);
  enumValue(record.overallStatus, `${path}.overallStatus`, TERMINAL_STATES);
  stringArray(record.exceptionIds, `${path}.exceptionIds`, { nonEmptyItems: true, unique: true });
}

function rowOutcome(value: unknown, path: string): void {
  const record = exactObject(value, path, ["rowId", "source", "ownerId", "overallStatus", "exceptionIds"]);
  stringValue(record.rowId, `${path}.rowId`, true);
  enumValue(record.source, `${path}.source`, SOURCES);
  stringValue(record.ownerId, `${path}.ownerId`, true);
  enumValue(record.overallStatus, `${path}.overallStatus`, TERMINAL_STATES);
  stringArray(record.exceptionIds, `${path}.exceptionIds`, { nonEmptyItems: true, unique: true });
}

function exceptionRecord(value: unknown, path: string): void {
  const record = exactObject(value, path, [
    "exceptionId",
    "code",
    "caseId",
    "evidenceRowIds",
    "equation",
    "impactPaise",
    "suggestedAction",
    "message",
    "stateHistory",
  ]);
  regexString(record.exceptionId, `${path}.exceptionId`, /^exc_[0-9a-f]{20}$/, "an exception ID");
  enumValue(record.code, `${path}.code`, EXCEPTION_CODES);
  stringValue(record.caseId, `${path}.caseId`, true);
  stringArray(record.evidenceRowIds, `${path}.evidenceRowIds`, { nonEmptyItems: true, unique: true });
  nullableEquation(record.equation, `${path}.equation`);
  const impact = record.impactPaise === null ? null : safeInteger(record.impactPaise, `${path}.impactPaise`);
  enumValue(record.suggestedAction, `${path}.suggestedAction`, SUGGESTED_ACTIONS);
  stringValue(record.message, `${path}.message`, true);
  stateHistory(record.stateHistory, `${path}.stateHistory`);
  if (asArray(record.stateHistory, `${path}.stateHistory`).length === 0) {
    fail(`${path}.stateHistory`, "must include the exception decision");
  }
  if ((record.equation === null) !== (impact === null)) {
    fail(path, "equation and impactPaise must either both be null or both be present");
  }
  if (record.equation !== null && impact !== (record.equation as RecordValue).residualPaise) {
    fail(`${path}.impactPaise`, "must equal equation.residualPaise");
  }
}

function hypothesisVerdict(value: unknown, path: string): void {
  const record = exactObject(value, path, [
    "hypothesisId",
    "subjectBankEntryId",
    "candidateSettlementId",
    "status",
    "reason",
    "tests",
    "addedEdge",
  ]);
  stringValue(record.hypothesisId, `${path}.hypothesisId`, true);
  nullableString(record.subjectBankEntryId, `${path}.subjectBankEntryId`);
  nullableString(record.candidateSettlementId, `${path}.candidateSettlementId`);
  const status = enumValue(record.status, `${path}.status`, ["VERIFIED", "REJECTED"] as const);
  stringValue(record.reason, `${path}.reason`, true);
  asArray(record.tests, `${path}.tests`).forEach((item, index) => {
    const itemPath = `${path}.tests[${index}]`;
    const test = exactObject(item, itemPath, ["name", "passed", "detail"]);
    enumValue(test.name, `${itemPath}.name`, TEST_NAMES);
    booleanValue(test.passed, `${itemPath}.passed`);
    stringValue(test.detail, `${itemPath}.detail`, true);
  });
  if (record.addedEdge !== null) candidateEdge(record.addedEdge, `${path}.addedEdge`);
  if ((status === "VERIFIED") !== (record.addedEdge !== null)) {
    fail(`${path}.addedEdge`, "must be present exactly when the hypothesis is VERIFIED");
  }
}

function auditEvent(value: unknown, path: string): void {
  const record = exactObject(value, path, [
    "auditId",
    "sequence",
    "atEpochSeconds",
    "type",
    "subjectId",
    "detail",
  ]);
  regexString(record.auditId, `${path}.auditId`, /^audit_[0-9a-f]{20}$/, "an audit ID");
  safeInteger(record.sequence, `${path}.sequence`, 0);
  epoch(record.atEpochSeconds, `${path}.atEpochSeconds`);
  enumValue(record.type, `${path}.type`, AUDIT_TYPES);
  stringValue(record.subjectId, `${path}.subjectId`, true);
  stringValue(record.detail, `${path}.detail`, true);
}

function runSummary(value: unknown, path: string): void {
  const record = exactObject(value, path, [
    "inputRows",
    "rowOutcomes",
    "settlements",
    "exactMatches",
    "assistedMatches",
    "ambiguous",
    "unmatched",
    "invalid",
    "manual",
    "acceptedResidualPaise",
    "complete",
  ]);
  for (const key of [
    "inputRows",
    "rowOutcomes",
    "settlements",
    "exactMatches",
    "assistedMatches",
    "ambiguous",
    "unmatched",
    "invalid",
    "manual",
  ] as const) {
    safeInteger(record[key], `${path}.${key}`, 0);
  }
  safeInteger(record.acceptedResidualPaise, `${path}.acceptedResidualPaise`);
  booleanValue(record.complete, `${path}.complete`);
}

function validateShape(value: unknown): RunArtifact {
  const artifact = exactObject(value, "$", [
    "schemaVersion",
    "artifactId",
    "runAtEpochSeconds",
    "config",
    "inputs",
    "sourceRows",
    "settlements",
    "bankEntries",
    "ledger",
    "rowOutcomes",
    "exceptions",
    "hypotheses",
    "candidateEdges",
    "auditEvents",
    "summary",
  ]);
  if (artifact.schemaVersion !== "vouch.run/1") fail("$.schemaVersion", "expected vouch.run/1");
  regexString(artifact.artifactId, "$.artifactId", /^run_[0-9a-f]{24}$/, "a run artifact ID");
  epoch(artifact.runAtEpochSeconds, "$.runAtEpochSeconds");

  const config = exactObject(artifact.config, "$.config", [
    "schemaVersion",
    "mode",
    "aiMode",
    "inputProfile",
    "postingWindowDays",
    "minimumTruncatedUtrLength",
    "knownUtrPrefixes",
    "runAtEpochSeconds",
  ]);
  if (config.schemaVersion !== "1") fail("$.config.schemaVersion", "expected 1");
  const mode = enumValue(config.mode, "$.config.mode", ["baseline", "deterministic", "hybrid"] as const);
  const aiMode = enumValue(config.aiMode, "$.config.aiMode", ["off", "replay", "live"] as const);
  enumValue(config.inputProfile, "$.config.inputProfile", ["synthetic-v1", "foreign"] as const);
  safeInteger(config.postingWindowDays, "$.config.postingWindowDays", 0, 31);
  safeInteger(config.minimumTruncatedUtrLength, "$.config.minimumTruncatedUtrLength", 10, 64);
  const prefixes = stringArray(config.knownUtrPrefixes, "$.config.knownUtrPrefixes", {
    nonEmptyItems: true,
    unique: true,
  });
  if (prefixes.some((prefix) => prefix !== prefix.trim().toUpperCase())) {
    fail("$.config.knownUtrPrefixes", "must contain normalized uppercase prefixes");
  }
  if ([...prefixes].sort(compareCodeUnits).join("\u0000") !== prefixes.join("\u0000")) {
    fail("$.config.knownUtrPrefixes", "must use canonical code-unit order");
  }
  const configRunAt = epoch(config.runAtEpochSeconds, "$.config.runAtEpochSeconds");
  if (configRunAt !== artifact.runAtEpochSeconds) {
    fail("$.config.runAtEpochSeconds", "must equal the artifact runAtEpochSeconds");
  }
  if (mode !== "hybrid" && aiMode !== "off") {
    fail("$.config.aiMode", "can be enabled only when mode is hybrid");
  }

  asArray(artifact.inputs, "$.inputs").forEach((item, index) => inputSummary(item, `$.inputs[${index}]`));
  asArray(artifact.sourceRows, "$.sourceRows").forEach((item, index) => evidenceRow(item, `$.sourceRows[${index}]`));
  asArray(artifact.settlements, "$.settlements").forEach((item, index) => settlement(item, `$.settlements[${index}]`));
  asArray(artifact.bankEntries, "$.bankEntries").forEach((item, index) => bankDecision(item, `$.bankEntries[${index}]`));
  asArray(artifact.ledger, "$.ledger").forEach((item, index) => ledgerDecision(item, `$.ledger[${index}]`));
  asArray(artifact.rowOutcomes, "$.rowOutcomes").forEach((item, index) => rowOutcome(item, `$.rowOutcomes[${index}]`));
  asArray(artifact.exceptions, "$.exceptions").forEach((item, index) => exceptionRecord(item, `$.exceptions[${index}]`));
  asArray(artifact.hypotheses, "$.hypotheses").forEach((item, index) => hypothesisVerdict(item, `$.hypotheses[${index}]`));
  asArray(artifact.candidateEdges, "$.candidateEdges").forEach((item, index) => candidateEdge(item, `$.candidateEdges[${index}]`));
  asArray(artifact.auditEvents, "$.auditEvents").forEach((item, index) => auditEvent(item, `$.auditEvents[${index}]`));
  runSummary(artifact.summary, "$.summary");
  return artifact as unknown as RunArtifact;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string, path: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (result.has(id)) fail(path, `contains duplicate identifier ${id}`);
    result.set(id, item);
  }
  return result;
}

function expectReference<T>(universe: ReadonlyMap<string, T>, id: string, path: string): T {
  const value = universe.get(id);
  if (value === undefined) fail(path, `references unknown identifier ${id}`);
  return value;
}

function validateSourceIntegrity(artifact: RunArtifact): Map<string, EvidenceRow> {
  const inputs = uniqueBy(artifact.inputs, (item) => item.source, "$.inputs");
  for (const source of SOURCES) {
    if (!inputs.has(source)) fail("$.inputs", `is missing the ${source} input summary`);
  }
  if (inputs.size !== SOURCES.length) fail("$.inputs", "must contain exactly one summary per source");

  const rows = uniqueBy(artifact.sourceRows, (row) => row.rowId, "$.sourceRows");
  const bySource = new Map(SOURCES.map((source) => [source, [] as EvidenceRow[]]));
  const collisionGuard = new Map<string, string>();
  const duplicateGroups = new Map<string, number[]>();
  for (const [index, row] of artifact.sourceRows.entries()) {
    let rawCanonical: string;
    try {
      rawCanonical = canonicalJson(row.raw);
    } catch (error) {
      fail(`$.sourceRows[${index}].raw`, error instanceof Error ? error.message : "cannot be canonicalized");
    }
    const contentHash = sha256Hex(rawCanonical);
    if (row.contentHash !== contentHash) {
      fail(`$.sourceRows[${index}].contentHash`, "does not match the canonical raw row");
    }
    const priorCanonical = collisionGuard.get(contentHash);
    if (priorCanonical !== undefined && priorCanonical !== rawCanonical) {
      fail(`$.sourceRows[${index}].contentHash`, "creates a SHA-256 collision across distinct raw rows");
    }
    collisionGuard.set(contentHash, rawCanonical);
    const expectedRowId = `${row.source.toLowerCase()}_${contentHash}_${row.duplicateOrdinal}`;
    if (row.rowId !== expectedRowId) {
      fail(`$.sourceRows[${index}].rowId`, `must equal ${expectedRowId}`);
    }
    const groupKey = `${row.source}\u0000${contentHash}`;
    const ordinals = duplicateGroups.get(groupKey) ?? [];
    ordinals.push(row.duplicateOrdinal);
    duplicateGroups.set(groupKey, ordinals);
    bySource.get(row.source)?.push(row);
  }
  for (const [group, ordinals] of duplicateGroups) {
    ordinals.sort((left, right) => left - right);
    ordinals.forEach((ordinal, index) => {
      if (ordinal !== index) fail("$.sourceRows", `duplicate ordinals for ${group.replace("\u0000", "/")} must be contiguous from zero`);
    });
  }
  for (const source of SOURCES) {
    const sourceRows = bySource.get(source) ?? [];
    sourceRows.sort((left, right) => {
      const hashOrder = compareCodeUnits(left.contentHash, right.contentHash);
      return hashOrder === 0
        ? compareCodeUnits(canonicalJson(left.raw), canonicalJson(right.raw))
        : hashOrder;
    });
    const summary = inputs.get(source);
    if (summary === undefined) fail("$.inputs", `is missing ${source}`);
    if (summary.inputRowCount !== sourceRows.length) {
      fail(`$.inputs.${source}.inputRowCount`, `expected ${sourceRows.length}`);
    }
    const logicalHash = sha256Hex(canonicalJson(sourceRows.map((row) => row.contentHash)));
    if (summary.logicalHash !== logicalHash) {
      fail(`$.inputs.${source}.logicalHash`, "does not match the ordered source-row hashes");
    }
  }
  return rows;
}

function equationRows(value: Equation, path: string, rows: ReadonlyMap<string, EvidenceRow>): Set<string> {
  const result = new Set<string>();
  value.terms.forEach((term, index) => {
    const row = expectReference(rows, term.rowId, `${path}.terms[${index}].rowId`);
    if (row.source !== "RAZORPAY") fail(`${path}.terms[${index}].rowId`, "must reference a RAZORPAY row");
    result.add(term.rowId);
  });
  return result;
}

function validateReferences(artifact: RunArtifact, rows: ReadonlyMap<string, EvidenceRow>): void {
  const settlements = uniqueBy(artifact.settlements, (item) => item.settlementId, "$.settlements");
  uniqueBy(artifact.settlements, (item) => item.caseId, "$.settlements");
  const banks = uniqueBy(artifact.bankEntries, (item) => item.bankEntryId, "$.bankEntries");
  uniqueBy(artifact.bankEntries, (item) => item.rowId, "$.bankEntries");
  uniqueBy(artifact.ledger, (item) => item.recordId, "$.ledger");
  uniqueBy(artifact.ledger, (item) => item.rowId, "$.ledger");
  const exceptions = uniqueBy(artifact.exceptions, (item) => item.exceptionId, "$.exceptions");
  // A proposal may receive one verdict per candidate. Proposal IDs are not verdict IDs.
  const hypotheses = new Map<string, typeof artifact.hypotheses[number][]>();
  for (const verdict of artifact.hypotheses) {
    const group = hypotheses.get(verdict.hypothesisId) ?? [];
    group.push(verdict);
    hypotheses.set(verdict.hypothesisId, group);
  }
  uniqueBy(artifact.auditEvents, (item) => item.auditId, "$.auditEvents");

  const checkExceptionIds = (ids: readonly string[], path: string): void => {
    ids.forEach((id, index) => expectReference(exceptions, id, `${path}[${index}]`));
  };

  artifact.settlements.forEach((decision, index) => {
    const path = `$.settlements[${index}]`;
    decision.reconRowIds.forEach((rowId, rowIndex) => {
      const row = expectReference(rows, rowId, `${path}.reconRowIds[${rowIndex}]`);
      if (row.source !== "RAZORPAY") fail(`${path}.reconRowIds[${rowIndex}]`, "must reference a RAZORPAY row");
    });
    decision.merchantRowIds.forEach((rowId, rowIndex) => {
      const row = expectReference(rows, rowId, `${path}.merchantRowIds[${rowIndex}]`);
      if (row.source !== "MERCHANT") fail(`${path}.merchantRowIds[${rowIndex}]`, "must reference a MERCHANT row");
    });
    decision.candidateBankEntryIds.forEach((bankId, bankIndex) =>
      expectReference(banks, bankId, `${path}.candidateBankEntryIds[${bankIndex}]`),
    );
    if (decision.bankEntryId !== null) {
      const bank = expectReference(banks, decision.bankEntryId, `${path}.bankEntryId`);
      if (bank.settlementId !== decision.settlementId) {
        fail(`${path}.bankEntryId`, "does not point back to this settlement");
      }
    }
    if (decision.equation !== null) {
      const terms = equationRows(decision.equation, `${path}.equation`, rows);
      const reconRows = new Set(decision.reconRowIds);
      if (
        terms.size !== reconRows.size ||
        [...terms].some((rowId) => !reconRows.has(rowId as RowId))
      ) {
        fail(`${path}.equation.terms`, "must exactly cover the settlement reconRowIds");
      }
    }
    checkExceptionIds(decision.exceptionIds, `${path}.exceptionIds`);
  });

  artifact.bankEntries.forEach((decision, index) => {
    const path = `$.bankEntries[${index}]`;
    const row = expectReference(rows, decision.rowId, `${path}.rowId`);
    if (row.source !== "BANK") fail(`${path}.rowId`, "must reference a BANK row");
    if (decision.settlementId !== null) {
      const settlementDecision = expectReference(settlements, decision.settlementId, `${path}.settlementId`);
      if (settlementDecision.bankEntryId !== decision.bankEntryId) {
        fail(`${path}.settlementId`, "does not point back to this bank entry");
      }
    }
    checkExceptionIds(decision.exceptionIds, `${path}.exceptionIds`);
  });

  artifact.ledger.forEach((decision, index) => {
    const path = `$.ledger[${index}]`;
    const row = expectReference(rows, decision.rowId, `${path}.rowId`);
    if (row.source !== "MERCHANT") fail(`${path}.rowId`, "must reference a MERCHANT row");
    if (decision.reconRowId !== null) {
      const recon = expectReference(rows, decision.reconRowId, `${path}.reconRowId`);
      if (recon.source !== "RAZORPAY") fail(`${path}.reconRowId`, "must reference a RAZORPAY row");
    }
    if (decision.settlementId !== null) {
      expectReference(settlements, decision.settlementId, `${path}.settlementId`);
    }
    checkExceptionIds(decision.exceptionIds, `${path}.exceptionIds`);
  });

  const outcomes = uniqueBy(artifact.rowOutcomes, (item) => item.rowId, "$.rowOutcomes");
  artifact.rowOutcomes.forEach((outcome, index) => {
    const path = `$.rowOutcomes[${index}]`;
    const row = expectReference(rows, outcome.rowId, `${path}.rowId`);
    if (row.source !== outcome.source) fail(`${path}.source`, `must equal source row type ${row.source}`);
    checkExceptionIds(outcome.exceptionIds, `${path}.exceptionIds`);
  });
  if (outcomes.size !== rows.size) fail("$.rowOutcomes", "must contain exactly one outcome for every source row");

  artifact.exceptions.forEach((exception, index) => {
    const path = `$.exceptions[${index}]`;
    const evidence = new Set(exception.evidenceRowIds);
    exception.evidenceRowIds.forEach((rowId, rowIndex) =>
      expectReference(rows, rowId, `${path}.evidenceRowIds[${rowIndex}]`),
    );
    if (exception.equation !== null) {
      const terms = equationRows(exception.equation, `${path}.equation`, rows);
      for (const rowId of terms) {
        if (!evidence.has(rowId as RowId)) fail(`${path}.equation.terms`, `row ${rowId} is absent from evidenceRowIds`);
      }
    }
  });

  artifact.candidateEdges.forEach((edge, index) => {
    const path = `$.candidateEdges[${index}]`;
    const decision = expectReference(settlements, edge.settlementId, `${path}.settlementId`);
    expectReference(banks, edge.bankEntryId, `${path}.bankEntryId`);
    if (!decision.candidateBankEntryIds.includes(edge.bankEntryId)) {
      fail(`${path}.bankEntryId`, "is absent from the settlement candidate list");
    }
    edge.hypothesisIds.forEach((id, hypothesisIndex) => {
      const verdicts = expectReference(hypotheses, id, `${path}.hypothesisIds[${hypothesisIndex}]`);
      if (!verdicts.some((verdict) => verdict.status === 'VERIFIED'
        && verdict.subjectBankEntryId === edge.bankEntryId && verdict.candidateSettlementId === edge.settlementId)) {
        fail(`${path}.hypothesisIds[${hypothesisIndex}]`, 'must reference a verified hypothesis for this bank and settlement');
      }
    });
    if (edge.hypothesisIds.length > 0 && !edge.evidence.includes("AI_HYPOTHESIS")) {
      fail(`${path}.evidence`, "must include AI_HYPOTHESIS when hypothesisIds are present");
    }
  });
  uniqueBy(
    artifact.candidateEdges,
    (edge) => `${edge.settlementId}\u0000${edge.bankEntryId}`,
    "$.candidateEdges",
  );

  const mergedEdges = new Map(artifact.candidateEdges.map((edge) => [`${edge.settlementId}\u0000${edge.bankEntryId}`, edge]));
  artifact.hypotheses.forEach((verdict, index) => {
    const path = `$.hypotheses[${index}]`;
    if (verdict.subjectBankEntryId !== null) {
      expectReference(banks, verdict.subjectBankEntryId, `${path}.subjectBankEntryId`);
    }
    if (verdict.candidateSettlementId !== null) {
      expectReference(settlements, verdict.candidateSettlementId, `${path}.candidateSettlementId`);
    }
    if (verdict.addedEdge !== null) {
      if (verdict.addedEdge.bankEntryId !== verdict.subjectBankEntryId) {
        fail(`${path}.addedEdge.bankEntryId`, "must equal subjectBankEntryId");
      }
      if (verdict.addedEdge.settlementId !== verdict.candidateSettlementId) {
        fail(`${path}.addedEdge.settlementId`, "must equal candidateSettlementId");
      }
      if (!verdict.addedEdge.hypothesisIds.includes(verdict.hypothesisId)) {
        fail(`${path}.addedEdge.hypothesisIds`, "must include this hypothesisId");
      }
      const merged = mergedEdges.get(`${verdict.addedEdge.settlementId}\u0000${verdict.addedEdge.bankEntryId}`);
      if (merged === undefined || verdict.addedEdge.evidence.some((item) => !merged.evidence.includes(item))
        || verdict.addedEdge.hypothesisIds.some((item) => !merged.hypothesisIds.includes(item))) {
        fail(`${path}.addedEdge`, "must be represented by the merged candidate edge");
      }
    }
  });
}

function validateSummary(artifact: RunArtifact): void {
  const accepted = artifact.settlements.filter(
    (item) => item.overallStatus === "EXACT_MATCH" || item.overallStatus === "VERIFIED_ASSISTED_MATCH",
  );
  const acceptedResidual = accepted.reduce(
    (total, item) => total + BigInt(item.equation?.residualPaise ?? 0),
    0n,
  );
  if (acceptedResidual > BigInt(Number.MAX_SAFE_INTEGER) || acceptedResidual < BigInt(Number.MIN_SAFE_INTEGER)) {
    fail("$.summary.acceptedResidualPaise", "accepted residual exceeds the safe-integer range");
  }
  const inputRows = artifact.inputs.reduce((total, input) => total + input.inputRowCount, 0);
  if (!Number.isSafeInteger(inputRows)) fail("$.summary.inputRows", "input count exceeds the safe-integer range");
  const expected: RunSummary = {
    inputRows,
    rowOutcomes: artifact.rowOutcomes.length,
    settlements: artifact.settlements.length,
    exactMatches: artifact.settlements.filter((item) => item.overallStatus === "EXACT_MATCH").length,
    assistedMatches: artifact.settlements.filter((item) => item.overallStatus === "VERIFIED_ASSISTED_MATCH").length,
    ambiguous: artifact.settlements.filter((item) => item.overallStatus === "AMBIGUOUS").length,
    unmatched: artifact.settlements.filter((item) => item.overallStatus === "UNMATCHED").length,
    invalid: artifact.settlements.filter((item) => item.overallStatus === "INVALID_INPUT").length,
    manual: artifact.settlements.filter((item) => item.overallStatus === "MANUALLY_RESOLVED").length,
    acceptedResidualPaise: Number(acceptedResidual) as RunSummary["acceptedResidualPaise"],
    complete: inputRows === artifact.rowOutcomes.length,
  };
  for (const key of Object.keys(expected) as (keyof RunSummary)[]) {
    if (artifact.summary[key] !== expected[key]) {
      fail(`$.summary.${key}`, `expected ${String(expected[key])}`);
    }
  }
}

function validateAuditIntegrity(events: readonly AuditEvent[]): void {
  events.forEach((event, index) => {
    const path = `$.auditEvents[${index}]`;
    if (event.sequence !== index) fail(`${path}.sequence`, `expected contiguous sequence ${index}`);
    const { auditId: _auditId, ...withoutId } = event;
    const expected = `audit_${sha256Hex(canonicalJson(withoutId)).slice(0, 20)}`;
    if (event.auditId !== expected) fail(`${path}.auditId`, `must equal ${expected}`);
  });
}

function validateArtifactId(artifact: RunArtifact): void {
  const { artifactId: _artifactId, ...withoutId } = artifact;
  const expected = `run_${sha256Hex(canonicalJson(withoutId)).slice(0, 24)}`;
  if (artifact.artifactId !== expected) fail("$.artifactId", `must equal ${expected}`);
}

/**
 * Validates an already-parsed artifact without Node-only APIs, making it safe to
 * call from the Evidence Desk before trusting any imported decisions.
 */
export function validateRunArtifact(value: unknown): RunArtifact {
  const artifact = validateShape(value);
  const rows = validateSourceIntegrity(artifact);
  validateReferences(artifact, rows);
  validateSummary(artifact);
  validateAuditIntegrity(artifact.auditEvents);
  try {
    assertRunArtifactInvariants(artifact);
  } catch (error) {
    fail("$", error instanceof Error ? error.message : "run artifact invariant failed");
  }
  validateArtifactId(artifact);
  return artifact;
}

/** Parses and validates a UTF-8 JSON artifact, rejecting payloads over 25 MiB by default. */
export function validateRunArtifactJson(
  text: string,
  options: { readonly maxBytes?: number } = {},
): RunArtifact {
  if (typeof text !== "string") fail("$", "artifact JSON must be a string");
  const maxBytes = options.maxBytes ?? MAX_RUN_ARTIFACT_JSON_BYTES;
  safeInteger(maxBytes, "options.maxBytes", 1);
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > maxBytes) {
    fail("$", `artifact JSON is ${byteLength} bytes; maximum is ${maxBytes}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    fail("$", `invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`);
  }
  return validateRunArtifact(value);
}
