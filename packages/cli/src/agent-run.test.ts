import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentDigest, assertAgentScope, runVouch, verifyAgentSession, type AgentSession } from '@vouch/core';
import { runSampleAgent } from './agent-run.js';
import { allowedAgentRequest, createAgentServer } from './agent-server.js';
import { loadPublicInputs } from './public-inputs.js';

const root = resolve(import.meta.dirname, '../../..');
const demo = JSON.parse(await readFile(join(root, 'apps/web/public/data/demo-run.json'), 'utf8'));
const capture = JSON.parse(await readFile(join(root, 'artifacts/ai-capture.json'), 'utf8'));
const loaded = await loadPublicInputs(join(root, 'data/dev/public'));
const baseline = runVouch(loaded.input, { ...demo.config, mode: 'deterministic', aiMode: 'off' });
const providerResult = {
  responseId: 'test-response', reportedModel: null, providerClientVersion: 'test',
  usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, reportedCostUsd: null,
  structuredResponse: capture.response.structured, rawResponse: { test: true },
};
const servers: ReturnType<typeof createAgentServer>[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir())) || !directory.includes('vouch-agent-test-')) throw new Error('Unsafe test cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});

describe('bounded agent orchestration', () => {
  it('calls a model once, checks original proposals, globally rematches and replays independently', async () => {
    const invoke = vi.fn(async () => providerResult);
    const progress: string[] = [];
    const session = await runSampleAgent(root, event => progress.push(event.stage), invoke);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(['RECONCILE', 'INVESTIGATE', 'VERIFY', 'REPORT']);
    expect(session.provenance.reportedModel).toBeNull();
    expect(session.hypotheses).toEqual(capture.response.structured.hypotheses);
    const live = verifyAgentSession(loaded.input, baseline, session, 'live').artifact;
    const replay = verifyAgentSession(loaded.input, baseline, session, 'replay').artifact;
    expect(replay.config.aiMode).toBe('replay'); expect(live.config.aiMode).toBe('live');
    expect(replay.summary).toEqual(live.summary);
    expect(replay.summary).toMatchObject({ exactMatches: 9, assistedMatches: 1, inputRows: 1083, rowOutcomes: 1083, acceptedResidualPaise: 0 });
    expect(replay.hypotheses.map(item => item.status).sort()).toEqual(['REJECTED', 'VERIFIED']);
    expect(() => verifyAgentSession(loaded.input, baseline, { ...session, responseSha256: '0'.repeat(64) }, 'replay')).toThrow('integrity');
    const changed = { ...loaded.input, bankRows: loaded.input.bankRows.slice(1) };
    const changedBaseline = runVouch(changed, baseline.config);
    expect(() => verifyAgentSession(changed, changedBaseline, session, 'replay')).toThrow('different source');
  });
  it('accepts no-proposal abstention and never substitutes replay for a failed model', async () => {
    const session = await runSampleAgent(root, undefined, async () => ({ ...providerResult, structuredResponse: { hypotheses: [] } }));
    expect(verifyAgentSession(loaded.input, baseline, session, 'live').artifact.summary.assistedMatches).toBe(0);
    await expect(runSampleAgent(root, undefined, async () => { throw new Error('provider unavailable'); })).rejects.toThrow('provider unavailable');
  });
  it('rejects excess proposals, invented scope and omitted mandatory tests', () => {
    const proposal = capture.response.structured.hypotheses[0];
    expect(() => assertAgentScope(baseline, Array(13).fill(proposal))).toThrow('budget');
    expect(() => assertAgentScope(baseline, [{ ...proposal, candidate_ids: ['invented'] }])).toThrow('scope');
    expect(() => assertAgentScope(baseline, [{ ...proposal, requested_tests: ['NORMALIZED_UTR_MATCH'] }])).toThrow('required');
  });
  it('rejects modified or unmanifested input before invoking a model', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vouch-agent-test-')); directories.push(directory);
    const invoke = vi.fn(async () => providerResult);
    await expect(runSampleAgent(directory, undefined, invoke)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('loopback companion boundary', () => {
  it('rejects hostile origins, absent origins and DNS-rebound hosts', () => {
    expect(allowedAgentRequest('127.0.0.1:4318', 'http://localhost:3000', 4318)).toBe(true);
    expect(allowedAgentRequest('127.0.0.1:4318', 'https://evil.example', 4318)).toBe(false);
    expect(allowedAgentRequest('127.0.0.1:4318', undefined, 4318)).toBe(false);
    expect(allowedAgentRequest('evil.example:4318', 'http://localhost:3000', 4318)).toBe(false);
  });
  it('accepts only explicit empty-body sample requests and prevents overlapping model calls', async () => {
    let finish!: (session: AgentSession) => void;
    const pending = new Promise<AgentSession>(resolve => { finish = resolve; });
    const run = vi.fn(() => pending);
    const directory = await mkdtemp(join(tmpdir(), 'vouch-agent-test-')); directories.push(directory);
    const server = createAgentServer(directory, 0, run); servers.push(server);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
    const url = `http://127.0.0.1:${address.port}`;
    const headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-vouch-action': 'investigate-synthetic-sample' };
    expect((await fetch(`${url}/run`, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' })).status).toBe(403);
    expect((await fetch(`${url}/run`, { method: 'POST', headers, body: '{"input":"private data"}' })).status).toBe(400);
    expect((await fetch(`${url}/run`, { method: 'POST', headers, body: 'a'.repeat(257) })).status).toBe(413);
    expect((await fetch(`${url}/run`, { headers })).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
    expect((await fetch(`${url}/run`, { method: 'POST', headers, body: '{}' })).status).toBe(202);
    expect((await fetch(`${url}/run`, { method: 'POST', headers, body: '{}' })).status).toBe(429);
    expect(run).toHaveBeenCalledTimes(1);
    finish({ sessionId: 'test-completion', sessionSha256: agentDigest({}) } as AgentSession);
    // Give the completion promise and local recording write time to finish before cleanup.
    await new Promise(resolve => setTimeout(resolve, 50));
  });
});
