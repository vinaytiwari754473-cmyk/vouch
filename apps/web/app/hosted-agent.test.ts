import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { assertHostedSample, runHostedAgent, hostedAgentConfig, hostedAgentPost, type HostedAgentEnv } from './hosted-agent';
import { agentCallsRemaining, reserveAgentCall, releaseAgentCall } from './hosted-agent-budget';
import { parseGeminiResponse, GEMINI_MODEL } from './gemini-provider';
import { executeAgentVerification } from './agent-data';
import { readHostedAgentStream } from './hosted-agent-client';

const demo = JSON.parse(readFileSync(new URL('../public/data/demo-run.json', import.meta.url), 'utf8'));
const capture = JSON.parse(readFileSync(new URL('../../../artifacts/ai-capture.json', import.meta.url), 'utf8'));
const raw = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(capture.response.structured) }] } }], modelVersion: GEMINI_MODEL };
const mockGemini = async () => ({ ...parseGeminiResponse(raw), raw });
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_flashy_sir_ram.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql: string) { return { bind(...values: (string | number)[]) { return { first: async () => sqlite.prepare(sql).get(...values) ?? null, run: async () => sqlite.prepare(sql).run(...values) }; } }; } } as unknown as D1Database;
  return { sqlite, db };
}
function request(body = '{}', code = 'demo-test-code', origin = 'https://vouch-settlement-proof.vvtt30691.chatgpt.site') {
  return new Request('https://vouch-settlement-proof.vvtt30691.chatgpt.site/api/agent/run', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-vouch-demo-code': code }, body });
}
describe('hosted Gemini agent and durable allowance', () => {
  it('refuses changed source provenance before making model requests', () => {
    expect(assertHostedSample(demo).artifactId).toBe(demo.artifactId);
    expect(() => assertHostedSample({ ...demo, artifactId: 'run_changed' })).toThrow();
    const changed = structuredClone(demo); changed.sourceRows[0].raw.credit = 0;
    expect(() => assertHostedSample(changed)).toThrow();
  });
  it('reproduces verified proposals with Gemini provenance and independent browser checks', async () => {
    const stages: string[] = [];
    const session = await runHostedAgent('test-key', event => { if (event.type === 'progress') stages.push(event.stage); }, undefined, mockGemini);
    expect(stages).toEqual(['RECONCILE', 'INVESTIGATE', 'VERIFY', 'REPORT']);
    expect(session.provenance.adapter).toBe('gemini');
    expect(session.request.provider_request).toMatchObject({ generationConfig: { thinkingConfig: { thinkingLevel: 'LOW' }, responseFormat: { text: { mimeType: 'APPLICATION_JSON' } } } });
    expect(JSON.stringify(session)).not.toContain('test-key');
    expect(executeAgentVerification(demo, session, 'live').artifact.summary).toMatchObject({ exactMatches: 9, assistedMatches: 1, acceptedResidualPaise: 0, rowOutcomes: 1083 });
  });
  it('atomically reserves one lease, preserves cooldown and stops at the durable 50-call limit', async () => {
    const { sqlite, db } = database();
    try {
      const attempts = await Promise.all(Array.from({ length: 20 }, () => reserveAgentCall(db, 100000)));
      expect(attempts.filter(Boolean)).toHaveLength(1);
      const lease = attempts.find(Boolean)!; expect(await agentCallsRemaining(db)).toBe(49);
      await releaseAgentCall(db, lease.leaseUntil);
      expect(await reserveAgentCall(db, 110000)).toBeNull();
      sqlite.prepare('UPDATE agent_budget SET attempts = 49, lease_until = 0').run();
      expect((await reserveAgentCall(db, 200000))?.remaining).toBe(0);
      expect(await reserveAgentCall(db, 900000)).toBeNull();
    } finally { sqlite.close(); }
  });
  it('rejects missing config, wrong codes, origins and uploaded inputs before reserving or invoking', async () => {
    const { sqlite, db } = database(); const invoke = vi.fn();
    const env: HostedAgentEnv = { DB: db, GEMINI_API_KEY: 'test-key', VOUCH_AGENT_ACCESS_CODE: 'demo-test-code' };
    try {
      expect((await hostedAgentPost(request(), {}, invoke)).status).toBe(503);
      expect((await hostedAgentPost(request('{}', 'bad'), env, invoke)).status).toBe(401);
      expect((await hostedAgentPost(request('{}', 'demo-test-code', 'https://evil.example'), env, invoke)).status).toBe(403);
      expect((await hostedAgentPost(request('{"input":"merchant data"}'), env, invoke)).status).toBe(400);
      expect((await hostedAgentPost(request('x'.repeat(257)), env, invoke)).status).toBe(413);
      expect(await agentCallsRemaining(db)).toBe(50); expect(invoke).not.toHaveBeenCalled();
      const broken = { ...env, DB: { prepare() { throw new Error('database unavailable'); } } as unknown as D1Database };
      expect((await hostedAgentPost(request(), broken, invoke)).status).toBe(503); expect(invoke).not.toHaveBeenCalled();
    } finally { sqlite.close(); }
  });
  it('streams a fresh run and counts provider failure without exposing secrets or substituting replay', async () => {
    const { sqlite, db } = database();
    const env = { DB: db, GEMINI_API_KEY: 'test-key', VOUCH_AGENT_ACCESS_CODE: 'demo-test-code' };
    try {
      const response = await hostedAgentPost(request(), env, (key, emit, signal) => runHostedAgent(key, emit, signal, mockGemini));
      const session = await readHostedAgentStream(response, () => {});
      expect(executeAgentVerification(demo, session, 'live').artifact.summary.assistedMatches).toBe(1);
      expect(await agentCallsRemaining(db)).toBe(49);
      sqlite.prepare('UPDATE agent_budget SET next_allowed_at = 0, lease_until = 0').run();
      const failed = await hostedAgentPost(request(), env, async () => { throw new Error('test-key must not leak'); });
      await expect(readHostedAgentStream(failed, () => {})).rejects.toThrow('No AI result');
      expect(await agentCallsRemaining(db)).toBe(48);
      const config = await hostedAgentConfig(env); expect(await config.text()).not.toContain('test-key');
    } finally { sqlite.close(); }
  });
  it('rejects truncated or oversized client streams', async () => {
    await expect(readHostedAgentStream(new Response('{"type":"progress","stage":"RECONCILE","message":"test"}\n'), () => {})).rejects.toThrow('without a complete result');
    await expect(readHostedAgentStream(new Response('x'.repeat(262145)), () => {})).rejects.toThrow('size limit');
  });
});
