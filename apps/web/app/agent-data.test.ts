import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { executeAgentVerification } from './agent-data';
import { agentDigest } from '@vouch/core';
const demo = JSON.parse(readFileSync(new URL('../public/data/demo-run.json', import.meta.url), 'utf8'));
const session = JSON.parse(readFileSync(new URL('../public/data/agent-session.json', import.meta.url), 'utf8'));
describe('agent browser verification contract', () => {
  it('rebuilds actual live capture in replay mode without consuming prior verdicts', () => {
    const result = executeAgentVerification(demo, session, 'replay');
    expect(result.baseline.summary.exactMatches).toBe(9);
    expect(result.artifact.summary).toMatchObject({ exactMatches: 9, assistedMatches: 1, complete: true, acceptedResidualPaise: 0 });
    expect(result.artifact.exceptions).toHaveLength(25);
    expect(result.artifact.config.aiMode).toBe('replay');
    expect(result.artifact.hypotheses.find(row => row.status === 'REJECTED')?.tests.some(test => test.name === 'POSTING_WINDOW_MATCH' && !test.passed)).toBe(true);
  });
  it('rejects a substituted recording even when its self-hash is recomputed', () => {
    const { sessionSha256: _, ...changed } = { ...session, sessionId: 'substituted' };
    expect(() => executeAgentVerification(demo, { ...changed, sessionSha256: agentDigest(changed) }, 'replay')).toThrow('reviewed recording');
  });
});
