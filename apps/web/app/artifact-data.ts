import {
  canonicalJson,
  sha256Hex,
  validateRunArtifactJson,
  type AuditEvent as RunAuditEvent,
  type EvidenceRow as RunEvidenceRow,
  type RunArtifact,
  type SettlementDecision,
} from '@vouch/core';

export const SEALED_DEMO_ARTIFACT_ID = 'run_eb5706d017fb9e79e9749f29';

export type CaseStatus =
  | 'PROVED'
  | 'ASSISTED'
  | 'DISCREPANCY'
  | 'AMBIGUOUS'
  | 'MISSING'
  | 'REVIEW';

export type DisplayEvidenceRow = {
  id: string;
  rowId: string;
  kind: 'PAYMENT' | 'REFUND' | 'TRANSFER' | 'ADJUSTMENT';
  grossPaise: number;
  feePaise: number;
  taxPaise: number;
  contributionPaise: number;
  merchant: 'VERIFIED' | 'MISSING' | 'MISMATCH' | 'NOT_REQUIRED';
};

export type DisplayAuditEvent = {
  stage: string;
  title: string;
  detail: string;
  tone: 'neutral' | 'proved' | 'ai' | 'warning';
};

export type SettlementCase = {
  id: string;
  shortId: string;
  status: CaseStatus;
  bankStatus: 'EXACT' | 'ASSISTED' | 'DISCREPANCY' | 'AMBIGUOUS' | 'MISSING' | 'INVALID';
  ledgerStatus: 'VERIFIED' | 'MISSING' | 'MISMATCH' | 'NOT_REQUIRED';
  reviewStatus: 'CLOSED' | 'OPEN';
  settledDate: string;
  bankDate: string | null;
  utr: string | null;
  bankReference: string | null;
  expectedPaise: number;
  actualPaise: number | null;
  exceptionCode: string | null;
  exceptionCodes: string[];
  exceptionCopy: string | null;
  suggestedAction: string | null;
  rows: DisplayEvidenceRow[];
  candidates: { id: string; amountPaise: number; evidence: string; possible: boolean }[];
  aiNote: {
    verdict: 'VERIFIED' | 'REJECTED';
    sourceNarration: string;
    explanation: string;
    tests: string[];
  } | null;
  audit: DisplayAuditEvent[];
};

export type BatchSummary = {
  artifactSha256: string;
  runId: string;
  reconRows: number;
  bankRows: number;
  merchantRows: number;
  settlementRows: number;
  inputRows: number;
  settlements: number;
  automatic: number;
  reviewCases: number;
  exceptionRecords: number;
  ambiguous: number;
  aiMode: RunArtifact['config']['aiMode'];
  runDate: string;
};

export type ArtifactProjection = {
  artifact: RunArtifact;
  canonicalText: string;
  cases: SettlementCase[];
  batch: BatchSummary;
  isSealedDemo: boolean;
};

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function integerValue(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
}

function parseRupeeTextToPaise(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value !== 'string') return 0;
  const normalized = value.trim().replaceAll(',', '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return 0;
  const paise = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return paise <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(paise) : 0;
}

function formatEpoch(epoch: number | null): string {
  if (epoch === null) return 'NOT RECORDED';
  return dateFormatter.format(new Date(epoch * 1000)).toUpperCase();
}

function formatIsoDate(value: string | null): string | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dateFormatter.format(new Date(`${value}T12:00:00+05:30`)).toUpperCase();
}

function displayStatus(settlement: SettlementDecision): CaseStatus {
  if (settlement.overallStatus === 'EXACT_MATCH') return 'PROVED';
  if (settlement.overallStatus === 'VERIFIED_ASSISTED_MATCH') return 'ASSISTED';
  if (settlement.overallStatus === 'AMBIGUOUS') return 'AMBIGUOUS';
  if (settlement.bankStatus === 'AMOUNT_MISMATCH') return 'DISCREPANCY';
  if (settlement.bankStatus === 'MISSING') return 'MISSING';
  return 'REVIEW';
}

function displayBankStatus(settlement: SettlementDecision): SettlementCase['bankStatus'] {
  if (settlement.bankStatus === 'EXACT_UTR_MATCH' || settlement.bankStatus === 'DETERMINISTIC_MATCH') return 'EXACT';
  if (settlement.bankStatus === 'AI_VERIFIED_MATCH') return 'ASSISTED';
  if (settlement.bankStatus === 'AMOUNT_MISMATCH') return 'DISCREPANCY';
  if (settlement.bankStatus === 'AMBIGUOUS') return 'AMBIGUOUS';
  if (settlement.bankStatus === 'INVALID') return 'INVALID';
  return 'MISSING';
}

function displayLedgerStatus(settlement: SettlementDecision): SettlementCase['ledgerStatus'] {
  if (settlement.ledgerStatus === 'NOT_APPLICABLE') return 'NOT_REQUIRED';
  if (settlement.ledgerStatus === 'VERIFIED') return 'VERIFIED';
  if (settlement.ledgerStatus === 'AMOUNT_MISMATCH') return 'MISMATCH';
  return 'MISSING';
}

function titleForAudit(event: RunAuditEvent): string {
  return event.type.split('_').map((word) => `${word[0]}${word.slice(1).toLowerCase()}`).join(' ');
}

function toneForAudit(event: RunAuditEvent): DisplayAuditEvent['tone'] {
  if (event.type === 'HYPOTHESIS_VERIFIED' || event.type === 'HYPOTHESIS_REJECTED') return 'ai';
  if (event.type === 'MATCH_ACCEPTED' || event.type === 'MANUAL_RESOLUTION') return 'proved';
  if (event.type === 'MATCH_ABSTAINED' || event.type === 'EXCEPTION_RAISED' || event.type === 'INPUT_REJECTED') return 'warning';
  return 'neutral';
}

function projectCase(
  artifact: RunArtifact,
  settlement: SettlementDecision,
  sourceById: ReadonlyMap<string, RunEvidenceRow>,
): SettlementCase {
  const exceptionsById = new Map(artifact.exceptions.map((item) => [item.exceptionId, item]));
  const bankById = new Map(artifact.bankEntries.map((item) => [item.bankEntryId, item]));
  const ledgerByReconId = new Map(
    artifact.ledger
      .filter((item) => item.reconRowId !== null)
      .map((item) => [item.reconRowId as string, item]),
  );
  const termByRowId = new Map((settlement.equation?.terms ?? []).map((term) => [term.rowId as string, term]));
  const caseExceptions = settlement.exceptionIds
    .map((id) => exceptionsById.get(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);

  const rows = settlement.reconRowIds.map((rowId): DisplayEvidenceRow => {
    const source = sourceById.get(rowId);
    const raw = asRecord(source?.raw);
    const term = termByRowId.get(rowId);
    const ledger = ledgerByReconId.get(rowId);
    const merchant = raw.type === 'adjustment' || raw.type === 'transfer'
      ? 'NOT_REQUIRED'
      : ledger === undefined
      ? 'MISSING'
      : ledger.ledgerStatus === 'NOT_APPLICABLE'
        ? 'NOT_REQUIRED'
        : ledger.ledgerStatus === 'VERIFIED'
        ? 'VERIFIED'
        : ledger.ledgerStatus === 'AMOUNT_MISMATCH'
          ? 'MISMATCH'
          : 'MISSING';
    const rawType = stringValue(raw.type)?.toUpperCase();
    const kind = rawType === 'REFUND' || rawType === 'TRANSFER' || rawType === 'ADJUSTMENT'
      ? rawType
      : 'PAYMENT';
    return {
      id: stringValue(raw.entity_id) ?? rowId.slice(0, 22),
      rowId,
      kind,
      grossPaise: Math.abs(integerValue(raw.amount)),
      feePaise: integerValue(raw.fee),
      taxPaise: integerValue(raw.tax),
      contributionPaise: term?.contributionPaise ?? (integerValue(raw.credit) - integerValue(raw.debit)),
      merchant,
    };
  });

  const selectedBankDecision = settlement.bankEntryId === null ? undefined : bankById.get(settlement.bankEntryId);
  const selectedBankSource = selectedBankDecision === undefined ? undefined : sourceById.get(selectedBankDecision.rowId);
  const selectedBankRaw = asRecord(selectedBankSource?.raw);
  const candidateEdges = artifact.candidateEdges.filter((edge) => edge.settlementId === settlement.settlementId);
  const candidates = settlement.candidateBankEntryIds.map((candidateId) => {
    const decision = bankById.get(candidateId);
    const raw = asRecord(decision === undefined ? undefined : sourceById.get(decision.rowId)?.raw);
    const edge = candidateEdges.find((item) => item.bankEntryId === candidateId);
    const evidence = edge?.evidence ?? settlement.evidence;
    const accepted = settlement.bankEntryId === candidateId &&
      (settlement.bankStatus === 'EXACT_UTR_MATCH' ||
        settlement.bankStatus === 'DETERMINISTIC_MATCH' ||
        settlement.bankStatus === 'AI_VERIFIED_MATCH');
    return {
      id: candidateId,
      amountPaise: parseRupeeTextToPaise(raw.amount),
      evidence: evidence.length > 0 ? evidence.join(' · ').replaceAll('_', ' ') : 'RECORDED CANDIDATE',
      possible: accepted || settlement.overallStatus === 'AMBIGUOUS',
    };
  });

  const hypothesis = artifact.hypotheses.find((item) => item.candidateSettlementId === settlement.settlementId);
  const hypothesisBank = hypothesis?.subjectBankEntryId === null || hypothesis === undefined
    ? undefined
    : bankById.get(hypothesis.subjectBankEntryId);
  const hypothesisRaw = asRecord(hypothesisBank === undefined ? undefined : sourceById.get(hypothesisBank.rowId)?.raw);
  const passedTests = hypothesis?.tests.filter((test) => test.passed).length ?? 0;
  const aiNote = hypothesis === undefined ? null : {
    verdict: hypothesis.status,
    sourceNarration: stringValue(hypothesisRaw.narration) ?? 'Narration not retained in this artifact.',
    explanation: `${hypothesis.reason}. ${passedTests}/${hypothesis.tests.length} recorded deterministic checks passed.`,
    tests: hypothesis.tests.map((test) => `${test.passed ? 'PASS' : 'FAIL'} · ${test.name} · ${test.detail}`),
  };

  const auditSubjects = new Set<string>([
    settlement.caseId,
    settlement.settlementId,
    ...settlement.exceptionIds,
    ...artifact.hypotheses
      .filter((item) => item.candidateSettlementId === settlement.settlementId)
      .map((item) => item.hypothesisId),
    ...(settlement.bankEntryId === null ? [] : [settlement.bankEntryId]),
  ]);
  const audit = artifact.auditEvents
    .filter((event) => auditSubjects.has(event.subjectId))
    .map((event): DisplayAuditEvent => ({
      stage: `${String(event.sequence + 1).padStart(2, '0')} / ${event.type.replaceAll('_', ' ')}`,
      title: titleForAudit(event),
      detail: event.detail,
      tone: toneForAudit(event),
    }));

  const settledEpoch = settlement.reconRowIds
    .map((rowId) => integerValue(asRecord(sourceById.get(rowId)?.raw).settled_at))
    .find((value) => value > 0) ?? null;
  const expectedPaise = settlement.equation?.expectedPaise ?? rows.reduce((total, row) => total + row.contributionPaise, 0);
  const actualPaise = settlement.bankEntryId === null ? null : settlement.equation?.actualPaise ?? parseRupeeTextToPaise(selectedBankRaw.amount);

  return {
    id: settlement.settlementId,
    shortId: settlement.caseId.slice(-6).toUpperCase(),
    status: displayStatus(settlement),
    bankStatus: displayBankStatus(settlement),
    ledgerStatus: displayLedgerStatus(settlement),
    reviewStatus: settlement.reviewStatus === 'PENDING' ? 'OPEN' : 'CLOSED',
    settledDate: formatEpoch(settledEpoch),
    bankDate: formatIsoDate(stringValue(selectedBankRaw.posting_date)),
    utr: settlement.settlementUtr,
    bankReference: stringValue(selectedBankRaw.bank_row_ref) ?? stringValue(selectedBankRaw.bank_row_id) ?? settlement.bankEntryId,
    expectedPaise,
    actualPaise,
    exceptionCode: caseExceptions[0]?.code ?? null,
    exceptionCodes: caseExceptions.map((item) => item.code),
    exceptionCopy: caseExceptions.length > 0 ? caseExceptions.map((item) => item.message).join(' · ') : null,
    suggestedAction: caseExceptions[0]?.suggestedAction.replaceAll('_', ' ') ?? null,
    rows,
    candidates,
    aiNote,
    audit,
  };
}

export function projectArtifact(artifact: RunArtifact): ArtifactProjection {
  const sourceById = new Map(artifact.sourceRows.map((row) => [row.rowId as string, row]));
  const canonicalText = canonicalJson(artifact);
  const inputCount = (source: RunEvidenceRow['source']) => artifact.inputs.find((item) => item.source === source)?.inputRowCount ?? 0;
  const cases = artifact.settlements.map((settlement) => projectCase(artifact, settlement, sourceById));
  const automatic = artifact.summary.exactMatches + artifact.summary.assistedMatches;
  return {
    artifact,
    canonicalText,
    cases,
    batch: {
      artifactSha256: sha256Hex(canonicalText),
      runId: artifact.artifactId,
      reconRows: inputCount('RAZORPAY'),
      bankRows: inputCount('BANK'),
      merchantRows: inputCount('MERCHANT'),
      settlementRows: inputCount('SETTLEMENT'),
      inputRows: artifact.summary.inputRows,
      settlements: artifact.summary.settlements,
      automatic,
      reviewCases: artifact.summary.settlements - automatic,
      exceptionRecords: artifact.exceptions.length,
      ambiguous: artifact.summary.ambiguous,
      aiMode: artifact.config.aiMode,
      runDate: formatEpoch(artifact.runAtEpochSeconds),
    },
    isSealedDemo: artifact.artifactId === SEALED_DEMO_ARTIFACT_ID,
  };
}

export function validateAndProjectArtifact(text: string): ArtifactProjection {
  return projectArtifact(validateRunArtifactJson(text));
}

export const verificationStages = [
  'Loading sealed artifact bytes',
  'Verifying source identities and hashes',
  'Checking the complete row-outcome partition',
  'Checking equations and zero-residual proofs',
  'Rendering recorded decisions',
] as const;

export const evaluationRows = [
  { label: 'Literal UTR baseline', accepted: '7 / 24', correct: '7 / 7', falseRate: '0 / 7', recall: '7 / 11', note: 'Exact reference only' },
  { label: 'Vouch deterministic', accepted: '9 / 24', correct: '9 / 9', falseRate: '0 / 9', recall: '9 / 11', note: 'Forced edges only' },
  { label: 'Vouch + verified AI', accepted: '10 / 24', correct: '10 / 10', falseRate: '0 / 10', recall: '10 / 11', note: '+1 verified replay edge' },
] as const;
