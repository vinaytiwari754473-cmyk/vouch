import type { AgentStage } from '@vouch/core';

export async function readHostedAgentStream(response: Response, progress: (stage: AgentStage, message: string) => void): Promise<unknown> {
  if (!response.ok) {
    const messages: Record<number, string> = { 401: 'Enter the demo access code—not an API key.', 429: 'The demo is busy, cooling down or out of calls. Replay remains available.', 503: 'Live Gemini is temporarily unavailable. No replay was substituted.' };
    throw new Error(messages[response.status] ?? `Live request failed (${response.status})`);
  }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Live response has no stream');
  let buffer = ''; let bytes = 0; let result: unknown; let resultSeen = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const raw: unknown = JSON.parse(line);
    if (!raw || typeof raw !== 'object' || !('type' in raw) || resultSeen) throw new Error('Invalid live response sequence');
    const event = raw as { type: string; stage?: AgentStage; message?: string; session?: unknown };
    if (event.type === 'progress' && ['RECONCILE', 'INVESTIGATE', 'VERIFY', 'REPORT'].includes(event.stage ?? '') && typeof event.message === 'string' && event.message.length <= 1000) progress(event.stage!, event.message);
    else if (event.type === 'result' && event.session) { result = event.session; resultSeen = true; }
    else if (event.type === 'error' && typeof event.message === 'string' && event.message.length <= 1000) throw new Error(event.message);
    else throw new Error('Invalid live response event');
  };
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 262144) throw new Error('Live response exceeded its size limit');
      buffer += decoder.decode(part.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
    }
    buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
    if (!resultSeen) throw new Error('Live stream ended without a complete result. No replay substituted.');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
