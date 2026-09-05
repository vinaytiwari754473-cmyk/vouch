import type { RunArtifact } from '@vouch/core';
import { executeAgentVerification } from './agent-data';
self.onmessage = (event: MessageEvent<{ demo: RunArtifact; session: unknown; mode: 'live' | 'replay' }>) => {
  try {
    self.postMessage(executeAgentVerification(event.data.demo, event.data.session, event.data.mode));
  } catch (cause) { self.postMessage({ error: cause instanceof Error ? cause.message : 'Agent verification failed' }); }
};
