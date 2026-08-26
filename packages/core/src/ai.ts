import { z } from "zod";
import { canonicalJson, compareCodeUnits } from "./canonical";
import { isWithinPostingWindow } from "./date";
import { sha256Hex } from "./sha256";
import type { SettlementGroup } from "./group";
import { literalSpanMatchesUtr } from "./utr";
import type {
  AiHypothesis,
  BankEntry,
  BankEntryId,
  CandidateEdge,
  HypothesisTestResult,
  HypothesisVerdict,
  RequestedTest,
  RunConfig,
  SettlementId,
  SourceRow,
} from "./types";

const hypothesisTypes = [
  "UTR_FORMAT_VARIANT",
  "COLUMN_SCHEMA_MAPPING",
  "CROSS_CYCLE_REFUND",
  "DUPLICATE_BANK_ENTRY",
  "MISSING_BANK_ENTRY",
  "MISSING_RAZORPAY_ROW",
  "MISSING_MERCHANT_LEDGER_RECORD",
  "FEE_SEMANTICS_MISMATCH",
  "DELAYED_BANK_POSTING",
  "UNEXPLAINED_ADJUSTMENT",
  "INSUFFICIENT_EVIDENCE",
] as const;

const requestedTests = [
  "NORMALIZED_UTR_MATCH",
  "EXACT_AMOUNT_MATCH",
  "POSTING_WINDOW_MATCH",
  "DUPLICATE_HASH_MATCH",
  "LEDGER_PRESENCE_CHECK",
] as const;

const hypothesisSchema = z.strictObject({
  schema_version: z.literal("1"),
  hypothesis_id: z.string().min(1).max(128),
  subject_bank_entry_id: z.string().min(1).max(256),
  hypothesis_type: z.enum(hypothesisTypes),
  candidate_ids: z.array(z.string().min(1).max(256)).min(1).max(5),
  evidence_row_ids: z.array(z.string().min(1).max(256)).max(12),
  confidence: z.number().finite().min(0).max(1),
  requested_tests: z.array(z.enum(requestedTests)).max(8),
  literal_spans: z
    .array(
      z.strictObject({
        evidence_row_id: z.string().min(1).max(256),
        field: z.enum(["narration", "utr"]),
        start: z.number().int().min(0),
        end: z.number().int().min(0),
        text: z.string().max(512),
      }),
    )
    .min(1)
    .max(8),
});

export interface HypothesisVerificationInput {
  readonly rawHypotheses: readonly unknown[];
  readonly groups: readonly SettlementGroup[];
  readonly bankRows: readonly SourceRow<BankEntry>[];
  readonly eligibleSettlementIds: ReadonlySet<SettlementId>;
  readonly eligibleBankEntryIds: ReadonlySet<BankEntryId>;
  readonly ledgerPresentSettlementIds: ReadonlySet<SettlementId>;
  readonly config: RunConfig;
}

function result(
  name: HypothesisTestResult["name"],
  passed: boolean,
  detail: string,
): HypothesisTestResult {
  return { name, passed, detail };
}

function rejected(
  hypothesisId: string,
  subjectBankEntryId: BankEntryId | null,
  candidateSettlementId: SettlementId | null,
  reason: string,
  tests: readonly HypothesisTestResult[] = [],
): HypothesisVerdict {
  return {
    hypothesisId,
    subjectBankEntryId,
    candidateSettlementId,
    status: "REJECTED",
    reason,
    tests,
    addedEdge: null,
  };
}

function invalidHypothesisId(raw: unknown, index: number): string {
  try {
    return `invalid_${sha256Hex(canonicalJson(raw)).slice(0, 16)}`;
  } catch {
    return `invalid_${String(index).padStart(4, "0")}`;
  }
}

function literalSource(
  span: AiHypothesis["literal_spans"][number],
  subject: SourceRow<BankEntry>,
): string | null {
  if (span.evidence_row_id !== subject.rowId) return null;
  return span.field === "narration" ? subject.value.narration : subject.value.utr;
}

function verifyOneCandidate(
  hypothesis: AiHypothesis,
  candidateId: string,
  groups: ReadonlyMap<SettlementId, SettlementGroup>,
  banks: ReadonlyMap<BankEntryId, SourceRow<BankEntry>>,
  bankRows: readonly SourceRow<BankEntry>[],
  input: HypothesisVerificationInput,
): HypothesisVerdict {
  const subjectId = hypothesis.subject_bank_entry_id as BankEntryId;
  const settlementId = candidateId as SettlementId;
  const subject = banks.get(subjectId);
  const group = groups.get(settlementId);
  const tests: HypothesisTestResult[] = [];

  const candidateExists =
    subject !== undefined &&
    group !== undefined &&
    input.eligibleBankEntryIds.has(subjectId) &&
    input.eligibleSettlementIds.has(settlementId);
  tests.push(
    result(
      "CANDIDATE_EXISTS",
      candidateExists,
      candidateExists
        ? "subject bank line and candidate settlement are unresolved input records"
        : "subject or candidate is absent, invalid, already committed, or quarantined",
    ),
  );
  if (!candidateExists || subject === undefined || group === undefined) {
    return rejected(
      hypothesis.hypothesis_id,
      banks.has(subjectId) ? subjectId : null,
      groups.has(settlementId) ? settlementId : null,
      "candidate is outside the unresolved input universe",
      tests,
    );
  }

  if (hypothesis.hypothesis_type !== "UTR_FORMAT_VARIANT") {
    return rejected(
      hypothesis.hypothesis_id,
      subjectId,
      settlementId,
      `${hypothesis.hypothesis_type} is diagnostic-only and cannot create a candidate edge in V1`,
      tests,
    );
  }

  const evidenceIds = new Set(hypothesis.evidence_row_ids);
  const evidenceUniverse = new Set([
    ...bankRows.map((row) => String(row.rowId)),
    ...[...groups.values()].flatMap((item) => item.rows.map((row) => String(row.rowId))),
  ]);
  const evidenceIdsExist = [...evidenceIds].every((rowId) => evidenceUniverse.has(rowId));
  tests.push(
    result(
      "CANDIDATE_EXISTS",
      evidenceIdsExist,
      evidenceIdsExist
        ? "every cited evidence row exists in the unresolved input universe"
        : "one or more cited evidence rows were invented or are outside the unresolved input universe",
    ),
  );
  let literalMatched = false;
  for (const span of hypothesis.literal_spans) {
    const source = literalSource(span, subject);
    const boundsValid = span.end >= span.start && span.end <= (source?.length ?? -1);
    const exactQuote =
      source !== null && boundsValid && source.slice(span.start, span.end) === span.text;
    const citesEvidence = evidenceIds.has(span.evidence_row_id);
    const matchesCandidateUtr =
      exactQuote &&
      group.settlementUtr !== null &&
      literalSpanMatchesUtr(span.text, group.settlementUtr, {
        knownPrefixes: input.config.knownUtrPrefixes,
        minimumTruncatedLength: input.config.minimumTruncatedUtrLength,
      });
    if (citesEvidence && matchesCandidateUtr) literalMatched = true;
  }
  tests.push(
    result(
      "LITERAL_SPAN",
      literalMatched,
      literalMatched
        ? "an exact cited substring supports the candidate UTR"
        : "no exact cited substring supports the candidate UTR",
    ),
  );

  const amountMatch = subject.value.amount === group.calculatedPaise;
  const currencyMatch = subject.value.currency === "INR";
  const postingWindowMatch =
    group.settledDate !== null &&
    isWithinPostingWindow(
      group.settledDate,
      subject.value.postingDate,
      input.config.postingWindowDays,
    );
  tests.push(result("EXACT_AMOUNT_MATCH", amountMatch, `bank=${subject.value.amount}; settlement=${group.calculatedPaise}`));
  tests.push(result("CURRENCY_MATCH", currencyMatch, `bank=${subject.value.currency}; settlement=INR`));
  tests.push(
    result(
      "POSTING_WINDOW_MATCH",
      postingWindowMatch,
      `settled=${group.settledDate ?? "unknown"}; posted=${subject.value.postingDate}`,
    ),
  );

  const requested = [...new Set(hypothesis.requested_tests)].sort(compareCodeUnits);
  for (const test of requested) {
    if (test === "NORMALIZED_UTR_MATCH") {
      tests.push(result(test, literalMatched, "literal UTR evidence is deterministically normalized"));
    } else if (test === "DUPLICATE_HASH_MATCH") {
      const duplicate = bankRows.some(
        (row) => row.rowId !== subject.rowId && row.contentHash === subject.contentHash,
      );
      tests.push(result(test, duplicate, duplicate ? "duplicate content hash exists" : "no duplicate content hash exists"));
    } else if (test === "LEDGER_PRESENCE_CHECK") {
      const present = input.ledgerPresentSettlementIds.has(settlementId);
      tests.push(result(test, present, present ? "merchant evidence is present" : "merchant evidence is absent"));
    }
  }

  const mustRequestNormalized = requested.includes("NORMALIZED_UTR_MATCH");
  const allPassed = tests.every((test) => test.passed);
  if (!mustRequestNormalized || !allPassed) {
    return rejected(
      hypothesis.hypothesis_id,
      subjectId,
      settlementId,
      !mustRequestNormalized
        ? "UTR_FORMAT_VARIANT must request NORMALIZED_UTR_MATCH"
        : "one or more deterministic verification tests failed",
      tests,
    );
  }

  const edge: CandidateEdge = {
    settlementId,
    bankEntryId: subjectId,
    evidence: ["AI_HYPOTHESIS"],
    hypothesisIds: [hypothesis.hypothesis_id],
  };
  return {
    hypothesisId: hypothesis.hypothesis_id,
    subjectBankEntryId: subjectId,
    candidateSettlementId: settlementId,
    status: "VERIFIED",
    reason: "all mandatory and requested deterministic tests passed; candidate edge may enter global matching",
    tests,
    addedEdge: edge,
  };
}

export function verifyAiHypotheses(
  input: HypothesisVerificationInput,
): readonly HypothesisVerdict[] {
  const groups = new Map(input.groups.map((group) => [group.settlementId, group]));
  const banks = new Map(input.bankRows.map((row) => [row.value.bankEntryId, row]));
  const parsed: { hypothesis: AiHypothesis; rawIndex: number }[] = [];
  const verdicts: HypothesisVerdict[] = [];

  input.rawHypotheses.forEach((raw, rawIndex) => {
    const result = hypothesisSchema.safeParse(raw);
    if (!result.success) {
      verdicts.push(
        rejected(
          invalidHypothesisId(raw, rawIndex),
          null,
          null,
          `strict hypothesis schema rejected output: ${result.error.issues
            .map((issue) => issue.message)
            .sort(compareCodeUnits)
            .join("; ")}`,
        ),
      );
      return;
    }
    parsed.push({ hypothesis: result.data, rawIndex });
  });

  parsed.sort((left, right) =>
    compareCodeUnits(
      `${left.hypothesis.subject_bank_entry_id}\u0000${left.hypothesis.hypothesis_id}`,
      `${right.hypothesis.subject_bank_entry_id}\u0000${right.hypothesis.hypothesis_id}`,
    ),
  );
  const callsBySubject = new Map<string, number>();
  for (const { hypothesis } of parsed) {
    const count = callsBySubject.get(hypothesis.subject_bank_entry_id) ?? 0;
    callsBySubject.set(hypothesis.subject_bank_entry_id, count + 1);
    if (count >= 2) {
      for (const candidate of hypothesis.candidate_ids) {
        verdicts.push(
          rejected(
            hypothesis.hypothesis_id,
            banks.has(hypothesis.subject_bank_entry_id as BankEntryId)
              ? (hypothesis.subject_bank_entry_id as BankEntryId)
              : null,
            groups.has(candidate as SettlementId) ? (candidate as SettlementId) : null,
            "per-exception model-call cap exceeded",
          ),
        );
      }
      continue;
    }
    for (const candidate of [...new Set(hypothesis.candidate_ids)].sort(compareCodeUnits)) {
      verdicts.push(verifyOneCandidate(hypothesis, candidate, groups, banks, input.bankRows, input));
    }
  }

  return verdicts.sort((left, right) =>
    compareCodeUnits(
      `${left.hypothesisId}\u0000${left.candidateSettlementId ?? ""}`,
      `${right.hypothesisId}\u0000${right.candidateSettlementId ?? ""}`,
    ),
  );
}
