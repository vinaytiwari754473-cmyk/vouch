import { agentDigest, assertAgentScope, buildInvestigationPacket, createCaptureRequest, runVouch, validateRunArtifact, verifyAgentSession, type AgentSession, type AgentStage, type RunArtifact } from '@vouch/core';
import sampleJson from '../public/data/demo-run.json';
import { inputFromArtifact, browserConfig } from './source-workbench';
import { buildGeminiBody, GEMINI_MODEL, GEMINI_OUTPUT_TOKENS, GEMINI_TIMEOUT_MS, invokeGemini } from './gemini-provider';
import { agentCallsRemaining, HOSTED_CALL_LIMIT, HOSTED_COOLDOWN_MS, reserveAgentCall, releaseAgentCall } from './hosted-agent-budget';

export type HostedAgentEnv = { GEMINI_API_KEY?: string; VOUCH_AGENT_ACCESS_CODE?: string; DB?: D1Database };
export type HostedEvent = { type: 'progress'; stage: AgentStage; message: string } | { type: 'result'; session: AgentSession } | { type: 'error'; message: string };
// The original input-file bundle hash below is valid only for this reviewed sample.
// Artifact validation binds all source rows and configuration; changes must be reviewed together.
export function assertHostedSample(artifact: RunArtifact) {
  if (validateRunArtifact(artifact).artifactId !== 'run_eb5706d017fb9e79e9749f29') throw new Error('Hosted source sample changed; review its provenance before enabling model calls.');
  return artifact;
}
const sample = assertHostedSample(validateRunArtifact(sampleJson));
const input = inputFromArtifact(sample);
const allowedOrigins = new Set(['https://vouch-settlement-proof.vvtt30691.chatgpt.site', 'http://localhost:3000', 'http://127.0.0.1:3000']);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function hostedAgentConfig(env: HostedAgentEnv) {
  try {
    const configured = Boolean(env.GEMINI_API_KEY?.trim() && env.VOUCH_AGENT_ACCESS_CODE && env.DB);
    return json({ configured, model: GEMINI_MODEL, callsRemaining: configured ? await agentCallsRemaining(env.DB!) : 0, callLimit: HOSTED_CALL_LIMIT, cooldownSeconds: HOSTED_COOLDOWN_MS / 1000 });
  } catch { return json({ configured: false, model: GEMINI_MODEL, callsRemaining: 0, callLimit: HOSTED_CALL_LIMIT, cooldownSeconds: HOSTED_COOLDOWN_MS / 1000 }); }
}

export async function runHostedAgent(key: string, emit: (event: HostedEvent) => void, signal?: AbortSignal, invoke: typeof invokeGemini = invokeGemini): Promise<AgentSession> {
  const startedAt = new Date().toISOString(); const events: AgentSession['events'] = [];
  const progress = (stage: AgentStage, message: string) => { events.push({ stage, message, at: new Date().toISOString() }); emit({ type: 'progress', stage, message }); };
  const baseline = runVouch(input, browserConfig(sample));
  progress('RECONCILE', `${baseline.summary.inputRows} source rows accounted for; ${baseline.summary.exactMatches}/${baseline.summary.settlements} settlements proved without AI.`);
  const packet = buildInvestigationPacket(baseline);
  const request = createCaptureRequest({ provider: 'gemini', model: GEMINI_MODEL, promptVersion: 'vouch-investigator/1', inputBundleSha256: '7070d07f2bd54f40ae377470f12005c0dc30c5d51805e6c5671144d2a2b761ad', packet, maxOutputTokens: GEMINI_OUTPUT_TOKENS, timeoutSeconds: GEMINI_TIMEOUT_MS / 1000, maxBudgetUsd: '0' });
  progress('INVESTIGATE', `Calling Gemini once with ${packet.unresolved_bank_evidence.length} unresolved bank entries and ${packet.candidate_settlements.length} candidate settlements. Public synthetic evidence only.`);
  const started = Date.now(); const response = await invoke(request, key, fetch, signal); const latencyMs = Date.now() - started;
  assertAgentScope(baseline, response.hypotheses);
  progress('VERIFY', `${response.hypotheses.length} proposals returned. Checking exact citations, references, amounts, dates, books and global uniqueness.`);
  const final = runVouch(input, { ...baseline.config, mode: 'hybrid', aiMode: 'live' }, response.hypotheses);
  validateRunArtifact(final);
  progress('REPORT', `${final.summary.exactMatches + final.summary.assistedMatches}/${final.summary.settlements} settlements proved; ${final.exceptions.length} exception records. Accepted residual: ${final.summary.acceptedResidualPaise} paise.`);
  const capturedRequest = { ...request, provider_request: buildGeminiBody(request) };
  const payload = {
    schemaVersion: 'vouch.agent-session/1' as const, sessionId: crypto.randomUUID(), startedAt, completedAt: new Date().toISOString(),
    baselineArtifactId: baseline.artifactId, finalLiveArtifactId: final.artifactId, sourceSha256: agentDigest(baseline.sourceRows),
    request: capturedRequest, requestSha256: agentDigest(capturedRequest), hypotheses: response.hypotheses,
    responseSha256: agentDigest(response.hypotheses), rawResponseSha256: agentDigest(response.raw),
    provenance: { adapter: 'gemini' as const, requestedModel: GEMINI_MODEL, reportedModel: response.reportedModel, responseId: response.responseId, clientVersion: 'gemini-generate-content/v1beta', latencyMs, inputTokens: response.inputTokens, outputTokens: response.outputTokens, totalTokens: response.totalTokens, reportedCostUsd: null }, events,
  };
  return verifyAgentSession(input, baseline, { ...payload, sessionSha256: agentDigest(payload) }, 'live').session;
}

export async function hostedAgentPost(request: Request, env: HostedAgentEnv, invoke: typeof runHostedAgent = runHostedAgent): Promise<Response> {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins.has(origin) || origin !== new URL(request.url).origin) return json({ error: 'Same-origin request required.' }, 403);
  if (!env.GEMINI_API_KEY?.trim() || !env.VOUCH_AGENT_ACCESS_CODE || !env.DB) return json({ error: 'Live Gemini is not configured. Replay remains available.' }, 503);
  const suppliedCode = request.headers.get('x-vouch-demo-code') ?? '';
  if (suppliedCode.length > 128 || agentDigest(suppliedCode) !== agentDigest(env.VOUCH_AGENT_ACCESS_CODE)) return json({ error: 'A valid demo access code is required. Never enter an API key here.' }, 401);
  if (request.headers.get('content-type') !== 'application/json') return json({ error: 'JSON required' }, 415);
  // Read at most 256 bytes; never accept uploaded evidence, arbitrary prompts or model settings.
  const reader = request.body?.getReader(); let body = ''; let bytes = 0;
  if (!reader) return json({ error: 'Explicit empty request required' }, 400);
  try {
    const decoder = new TextDecoder();
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 256) { await reader.cancel(); return json({ error: 'Request too large' }, 413); } body += decoder.decode(part.value, { stream: true }); }
    body += decoder.decode();
  } finally { reader.releaseLock(); }
  if (body !== '{}') return json({ error: 'Only the fixed public synthetic sample is accepted.' }, 400);
  let reservation;
  try { reservation = await reserveAgentCall(env.DB, Date.now()); } catch { return json({ error: 'Usage protection is unavailable. No model request was sent.' }, 503); }
  if (!reservation) return json({ error: 'The demo is busy, cooling down, or has reached its 50-call allowance. Replay remains available.' }, 429);
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: HostedEvent) => { if (!abort.signal.aborted) { try { controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n')); } catch { abort.abort(); } } };
      void (async () => {
        try { const session = await invoke(env.GEMINI_API_KEY!, emit, abort.signal); emit({ type: 'result', session }); }
        catch { emit({ type: 'error', message: 'Gemini investigation did not complete or its response failed validation. No AI result accepted; no replay substituted. Check provider quota or try replay.' }); }
        finally { await releaseAgentCall(env.DB!, reservation.leaseUntil).catch(() => {}); if (!abort.signal.aborted) controller.close(); }
      })();
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
