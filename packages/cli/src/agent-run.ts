import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentDigest, assertAgentScope, runVouch, validateRunArtifact, verifyAgentSession, type AgentSession, type AgentStage } from '@vouch/core';
import { buildInvestigationPacket, createCaptureRequest, hypothesesFromStructuredResponse, invokeCaptureProvider, type ProviderInvocation, type ProviderResult } from './ai-capture.js';
import { loadPublicInputs } from './public-inputs.js';

export const AGENT_BATCH_SHA256 = '7070d07f2bd54f40ae377470f12005c0dc30c5d51805e6c5671144d2a2b761ad';
export type AgentProgress = { stage: AgentStage; message: string };

/** One bounded model call. No browser-provided paths, prompts, models or financial data. */
export async function runSampleAgent(root: string, progress: (event: AgentProgress) => void = () => {}, invoke: (request: ProviderInvocation) => Promise<ProviderResult> = invokeCaptureProvider): Promise<AgentSession> {
  const events: AgentSession['events'] = [];
  const startedAt = new Date().toISOString();
  const event = (stage: AgentStage, message: string) => { events.push({ stage, message, at: new Date().toISOString() }); progress({ stage, message }); };
  const loaded = await loadPublicInputs(join(root, 'data/dev/public'));
  if (loaded.inputBundleSha256 !== AGENT_BATCH_SHA256 || loaded.warnings.length || loaded.input.settlementEntities?.length) throw new Error('Agent accepts only the pinned public synthetic sample');
  const sample = validateRunArtifact(JSON.parse(await readFile(join(root, 'apps/web/public/data/demo-run.json'), 'utf8')));
  const baseline = runVouch(loaded.input, { ...sample.config, mode: 'deterministic', aiMode: 'off' });
  if (agentDigest(baseline.sourceRows) !== agentDigest(sample.sourceRows)) throw new Error('Published sample and agent sources differ');
  event('RECONCILE', `${baseline.summary.inputRows} source rows accounted for; ${baseline.summary.exactMatches}/${baseline.summary.settlements} settlements proved without AI.`);
  const packet = buildInvestigationPacket(baseline);
  if (!packet.unresolved_bank_evidence.length || !packet.candidate_settlements.length) throw new Error('No unresolved evidence is eligible for investigation');
  const request = createCaptureRequest({ provider: 'codex-cli', model: 'gpt-5.6-sol', promptVersion: 'vouch-investigator/1', inputBundleSha256: loaded.inputBundleSha256, packet, maxOutputTokens: 4096, timeoutSeconds: 120, maxBudgetUsd: '0' });
  event('INVESTIGATE', `One live model request: ${packet.unresolved_bank_evidence.length} unresolved bank entries, ${packet.candidate_settlements.length} candidate settlements. Public synthetic evidence only.`);
  const modelStart = Date.now();
  const response = await invoke({ provider: 'codex-cli', model: request.model, maxOutputTokens: 4096, timeoutMilliseconds: 120000, maxBudgetUsd: '0', request });
  const latencyMs = Date.now() - modelStart;
  const hypotheses = [...hypothesesFromStructuredResponse(response.structuredResponse)];
  assertAgentScope(baseline, hypotheses);
  // In addition to core literal checks, require one of the exact supplied span options.
  for (const raw of hypotheses) {
    const proposal = raw as { subject_bank_entry_id: string; literal_spans: { field: string; start: number; end: number; text: string }[] };
    const evidence = (packet.unresolved_bank_evidence as { bank_entry_id: string; exact_span_options: unknown[] }[]).find(row => row.bank_entry_id === proposal.subject_bank_entry_id);
    for (const span of proposal.literal_spans) {
      if (!evidence?.exact_span_options.some(option => agentDigest(option) === agentDigest({ field: span.field, start: span.start, end: span.end, text: span.text }))) throw new Error('Agent cited a span not present in its investigation packet');
    }
  }
  event('VERIFY', `${hypotheses.length} proposals returned. Running literal, identity, money, date, books and global-uniqueness checks.`);
  const final = runVouch(loaded.input, { ...baseline.config, mode: 'hybrid', aiMode: 'live' }, hypotheses);
  validateRunArtifact(final);
  event('REPORT', `${final.summary.exactMatches + final.summary.assistedMatches}/${final.summary.settlements} settlements proved; ${final.exceptions.length} exception records. Accepted residual: ${final.summary.acceptedResidualPaise} paise.`);
  const payload = {
    schemaVersion: 'vouch.agent-session/1' as const, sessionId: randomUUID(), startedAt, completedAt: new Date().toISOString(),
    baselineArtifactId: baseline.artifactId, finalLiveArtifactId: final.artifactId,
    sourceSha256: agentDigest(baseline.sourceRows), request: { ...request }, requestSha256: agentDigest(request),
    hypotheses, responseSha256: agentDigest(hypotheses), rawResponseSha256: agentDigest(response.rawResponse),
    provenance: { adapter: 'codex-cli' as const, requestedModel: request.model, reportedModel: response.reportedModel, responseId: response.responseId, clientVersion: response.providerClientVersion, latencyMs, inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.totalTokens, reportedCostUsd: response.reportedCostUsd }, events,
  };
  const session = { ...payload, sessionSha256: agentDigest(payload) };
  verifyAgentSession(loaded.input, baseline, session, 'live');
  return session;
}
