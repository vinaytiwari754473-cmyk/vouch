import { z } from 'zod';
import { canonicalJson } from './canonical';
import { runVouch } from './engine';
import { sha256Hex } from './sha256';
import type { RunArtifact, RunInput } from './types';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const optionalCount = z.number().int().nonnegative().nullable();
const sessionSchema = z.object({
  schemaVersion: z.literal('vouch.agent-session/1'),
  sessionId: z.string().min(1).max(128),
  sessionSha256: digest,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  baselineArtifactId: z.string(),
  finalLiveArtifactId: z.string(),
  sourceSha256: digest,
  request: z.record(z.string(), z.unknown()),
  requestSha256: digest,
  hypotheses: z.array(z.unknown()).max(12),
  responseSha256: digest,
  rawResponseSha256: digest,
  provenance: z.object({
    adapter: z.literal('codex-cli'),
    requestedModel: z.string().min(1).max(128),
    reportedModel: z.string().max(128).nullable(),
    responseId: z.string().max(256).nullable(),
    clientVersion: z.string().max(128).nullable(),
    latencyMs: z.number().finite().nonnegative(),
    inputTokens: optionalCount,
    outputTokens: optionalCount,
    totalTokens: optionalCount,
    reportedCostUsd: z.number().finite().nonnegative().nullable(),
  }).strict(),
  events: z.array(z.object({
    stage: z.enum(['RECONCILE', 'INVESTIGATE', 'VERIFY', 'REPORT']),
    at: z.string().datetime(),
    message: z.string().max(600),
  }).strict()).length(4),
}).strict();

export type AgentSession = z.infer<typeof sessionSchema>;
export type AgentStage = AgentSession['events'][number]['stage'];
export const agentDigest = (value: unknown): string => sha256Hex(canonicalJson(value));

/** A model can only investigate the unresolved scope selected by the program. */
export function assertAgentScope(baseline: RunArtifact, hypotheses: readonly unknown[]): void {
  if (hypotheses.length > 12 || canonicalJson(hypotheses).length > 65536) throw new Error('Agent proposal budget exceeded');
  const banks = new Map(baseline.bankEntries.filter(row => row.bankStatus === 'UNKNOWN_CREDIT').map(row => [String(row.bankEntryId), String(row.rowId)]));
  const settlements = new Set(baseline.settlements.filter(row => row.bankStatus === 'MISSING').map(row => String(row.settlementId)));
  const ids = new Set<string>();
  for (const raw of hypotheses) {
    const proposal = z.object({
      hypothesis_id: z.string(), subject_bank_entry_id: z.string(),
      hypothesis_type: z.literal('UTR_FORMAT_VARIANT'),
      candidate_ids: z.array(z.string()).min(1).max(5),
      evidence_row_ids: z.array(z.string()).min(1).max(12),
      requested_tests: z.array(z.string()),
      literal_spans: z.array(z.object({ evidence_row_id: z.string() }).passthrough()).min(1).max(8),
    }).passthrough().parse(raw);
    const rowId = banks.get(proposal.subject_bank_entry_id);
    if (!rowId || ids.has(proposal.hypothesis_id) || proposal.candidate_ids.some(id => !settlements.has(id)) || proposal.evidence_row_ids.some(id => id !== rowId) || proposal.literal_spans.some(span => span.evidence_row_id !== rowId)) throw new Error('Agent proposed evidence outside its supplied scope');
    for (const test of ['NORMALIZED_UTR_MATCH', 'EXACT_AMOUNT_MATCH', 'POSTING_WINDOW_MATCH', 'LEDGER_PRESENCE_CHECK']) {
      if (!proposal.requested_tests.includes(test)) throw new Error('Agent omitted a required verification test');
    }
    ids.add(proposal.hypothesis_id);
  }
}

/** Hashes bind content, not provider authenticity. Every decision is recomputed. */
export function verifyAgentSession(input: RunInput, baseline: RunArtifact, raw: unknown, mode: 'live' | 'replay'): { session: AgentSession; artifact: RunArtifact } {
  const session = sessionSchema.parse(raw);
  const { sessionSha256, ...payload } = session;
  if (agentDigest(payload) !== sessionSha256 || agentDigest(session.request) !== session.requestSha256 || agentDigest(session.hypotheses) !== session.responseSha256) throw new Error('Agent session integrity check failed');
  if (baseline.config.aiMode !== 'off' || session.baselineArtifactId !== baseline.artifactId || session.sourceSha256 !== agentDigest(baseline.sourceRows)) throw new Error('Agent session belongs to different source evidence or configuration');
  assertAgentScope(baseline, session.hypotheses);
  const live = runVouch(input, { ...baseline.config, mode: 'hybrid', aiMode: 'live' }, session.hypotheses);
  if (live.artifactId !== session.finalLiveArtifactId) throw new Error('Agent result is not reproducible with this engine');
  return { session, artifact: mode === 'live' ? live : runVouch(input, { ...baseline.config, mode: 'hybrid', aiMode: 'replay' }, session.hypotheses) };
}
