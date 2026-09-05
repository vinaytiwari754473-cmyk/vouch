import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import type { AgentSession } from '@vouch/core';
import { runSampleAgent, type AgentProgress } from './agent-run.js';

const allowedOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
export function allowedAgentRequest(host: string | undefined, origin: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` && origin !== undefined && allowedOrigins.has(origin);
}

export function createAgentServer(root: string, port = 4318, run: typeof runSampleAgent = runSampleAgent) {
  let active = false;
  let attempts = 0;
  let lastStarted = 0;
  let status: { status: string; runId?: string; progress?: AgentProgress; session?: AgentSession; error?: string } = { status: 'ready' };
  const send = (response: ServerResponse, code: number, body: unknown) => { response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    const address = server.address();
    const boundPort = address && typeof address === 'object' ? address.port : port;
    if (!allowedAgentRequest(request.headers.host, request.headers.origin, boundPort)) { send(response, 403, { error: 'Only the local Vouch app may use this companion.' }); return; }
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin!);
    response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      response.setHeader('Access-Control-Allow-Headers', 'content-type, x-vouch-action');
      response.writeHead(204); response.end(); return;
    }
    if (request.url === '/status' && request.method === 'GET') { send(response, 200, { ...status, attemptsRemaining: Math.max(0, 3 - attempts) }); return; }
    if (request.url !== '/run' || request.method !== 'POST') { send(response, 404, { error: 'Not found' }); return; }
    if (request.headers['x-vouch-action'] !== 'investigate-synthetic-sample' || request.headers['content-type'] !== 'application/json') { send(response, 400, { error: 'Explicit sample investigation required.' }); return; }
    let body = '';
    for await (const chunk of request) {
      body += String(chunk);
      if (Buffer.byteLength(body) > 256) { send(response, 413, { error: 'Request too large' }); return; }
    }
    if (body !== '{}') { send(response, 400, { error: 'No inputs, paths, prompts or model overrides are accepted.' }); return; }
    if (active || attempts >= 3 || Date.now() - lastStarted < 30000) { send(response, 429, { error: 'One active run, 30-second cooldown and three model calls per companion session.' }); return; }
    const runId = randomUUID();
    active = true; attempts++; lastStarted = Date.now(); status = { status: 'running', runId, progress: { stage: 'RECONCILE', message: 'Loading the pinned public synthetic batch.' } };
    send(response, 202, { status: 'running', runId, attemptsRemaining: Math.max(0, 3 - attempts) });
    try {
      const session = await run(root, progress => { status = { status: 'running', runId, progress }; });
      // Local recording is separate from the reviewed public replay and never overwrites it.
      await mkdir(resolve(root, 'artifacts/local-agent'), { recursive: true });
      await writeFile(resolve(root, 'artifacts/local-agent', `${session.sessionId}.json`), JSON.stringify(session, null, 2), { encoding: 'utf8', flag: 'wx' });
      status = { status: 'complete', runId, session };
      process.stdout.write(`Agent complete: ${session.sessionId}\n`);
    } catch {
      status = { status: 'failed', runId, error: 'Live investigation did not complete. No AI result was accepted. Check Codex login, remaining usage and companion setup, then retry. Deterministic reconciliation remains available.' };
      process.stderr.write('Agent run failed; no AI result accepted. Provider details are not exposed to the browser.\n');
    } finally { active = false; }
  };
  const server = createServer((request, response) => { void handler(request, response).catch(() => { if (!response.headersSent) send(response, 400, { error: 'Invalid local request' }); else response.end(); }); });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  createAgentServer(root).listen(4318, '127.0.0.1', () => process.stdout.write('Vouch agent companion: http://127.0.0.1:4318 · fixed synthetic sample · at most three model calls. Open http://localhost:3000 and choose Agent run.\n'));
}
