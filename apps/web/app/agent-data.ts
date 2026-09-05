import { runVouch, verifyAgentSession, type RunArtifact } from '@vouch/core';
import { browserConfig, inputFromArtifact } from './source-workbench';
import { RECORDED_AGENT_SHA256 } from './agent-recording';

export function executeAgentVerification(demo: RunArtifact, session: unknown, mode: 'live' | 'replay') {
  if (mode === 'replay' && (!session || typeof session !== 'object' || !('sessionSha256' in session) || session.sessionSha256 !== RECORDED_AGENT_SHA256)) throw new Error('Recorded agent session does not match the reviewed recording');
  const input = inputFromArtifact(demo);
  const baseline = runVouch(input, browserConfig(demo));
  return { ...verifyAgentSession(input, baseline, session, mode), baseline };
}
