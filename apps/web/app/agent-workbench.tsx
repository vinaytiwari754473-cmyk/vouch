'use client';
import { useEffect, useRef, useState } from 'react';
import { canonicalArtifactJson, stringifyCsv, type AgentSession, type AgentStage, type RunArtifact } from '@vouch/core';
import { validateAndProjectArtifact, type ArtifactProjection } from './artifact-data';
import { readHostedAgentStream } from './hosted-agent-client';

const companion = 'http://127.0.0.1:4318';
const stages: { id: AgentStage; title: string; detail: string }[] = [
  { id: 'RECONCILE', title: 'Reconcile the batch', detail: 'Deterministic three-source verification.' },
  { id: 'INVESTIGATE', title: 'Investigate what remains', detail: 'One bounded AI request. Literal evidence only.' },
  { id: 'VERIFY', title: 'Challenge every proposal', detail: 'Code checks evidence and reruns global matching.' },
  { id: 'REPORT', title: 'Close the reconciliation run', detail: 'Proved settlements and an exception handoff.' },
];
type AgentResult = { session: AgentSession; artifact: RunArtifact; baseline: RunArtifact };
type CompanionStatus = { status: string; runId?: string; attemptsRemaining: number; progress?: { stage: AgentStage; message: string }; session?: unknown; error?: string };
function parseStatus(raw: unknown): CompanionStatus {
  if (!raw || typeof raw !== 'object' || !('status' in raw) || typeof raw.status !== 'string') throw new Error('Invalid companion response');
  const value = raw as CompanionStatus;
  if (!['ready', 'running', 'complete', 'failed'].includes(value.status) || !Number.isInteger(value.attemptsRemaining) || value.attemptsRemaining < 0 || value.attemptsRemaining > 3) throw new Error('Invalid companion status');
  if (value.runId !== undefined && (typeof value.runId !== 'string' || value.runId.length > 128)) throw new Error('Invalid companion run ID');
  if (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 1000)) throw new Error('Invalid companion error');
  if (value.progress && (!stages.some(stage => stage.id === value.progress?.stage) || typeof value.progress.message !== 'string' || value.progress.message.length > 1000)) throw new Error('Invalid companion progress');
  return value;
}
function download(name: string, body: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const proved = (artifact: RunArtifact) => artifact.summary.exactMatches + artifact.summary.assistedMatches;

export function AgentWorkbench({ demo, active, onResult, onInspect, onLab }: { demo: RunArtifact; active: boolean; onResult: (projection: ArtifactProjection) => void; onInspect: () => void; onLab: () => void }) {
  const [local, setLocal] = useState(false);
  const [connected, setConnected] = useState(false);
  const [remaining, setRemaining] = useState(3);
  const [hosted, setHosted] = useState<{ configured: boolean; callsRemaining: number; model: string }>({ configured: false, callsRemaining: 0, model: 'Gemini' });
  const [accessCode, setAccessCode] = useState('');
  const [mode, setMode] = useState<'live' | 'replay'>('replay');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<AgentStage | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<AgentResult | null>(null);
  const running = useRef(false);
  const worker = useRef<Worker | null>(null);
  const cancelled = useRef(false);
  const publishRef = useRef(onResult);
  useEffect(() => { publishRef.current = onResult; });
  useEffect(() => {
    if (active && result) publishRef.current(validateAndProjectArtifact(canonicalArtifactJson(result.artifact)));
  }, [active, result]);
  useEffect(() => {
    cancelled.current = false;
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port === '3000';
    setLocal(isLocal); if (isLocal) void connect();
    void refreshHosted();
    return () => { cancelled.current = true; worker.current?.terminate(); };
  }, []);
  async function refreshHosted() {
    try {
      const response = await fetch('/api/agent/config', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const raw = await response.json() as { configured?: unknown; callsRemaining?: unknown; model?: unknown };
      if (typeof raw.configured === 'boolean' && typeof raw.callsRemaining === 'number' && Number.isInteger(raw.callsRemaining) && raw.callsRemaining >= 0 && raw.callsRemaining <= 50 && typeof raw.model === 'string' && raw.model.length < 128) setHosted({ configured: raw.configured, callsRemaining: raw.callsRemaining, model: raw.model });
    } catch { /* Unconfigured hosting never interferes with recorded replay. */ }
  }
  async function connect() {
    try {
      const response = await fetch(`${companion}/status`, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
      if (!response.ok) throw new Error('Unavailable');
      const status = parseStatus(await response.json()); setRemaining(status.attemptsRemaining); setConnected(true);
    } catch { setConnected(false); }
  }
  async function verify(session: unknown, nextMode: 'live' | 'replay'): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      const instance = new Worker(new URL('./agent.worker.ts', import.meta.url), { type: 'module' }); worker.current = instance;
      const finish = () => { clearTimeout(timer); instance.terminate(); worker.current = null; };
      const timer = setTimeout(() => { finish(); reject(new Error('Independent verification timed out. No result accepted.')); }, 15000);
      instance.onmessage = (event: MessageEvent<AgentResult & { error?: string }>) => {
        finish(); if (event.data.error) { reject(new Error(event.data.error)); return; }
        try { validateAndProjectArtifact(canonicalArtifactJson(event.data.artifact)); resolve(event.data); } catch (cause) { reject(cause); }
      };
      instance.onerror = () => { finish(); reject(new Error('Verification worker failed. No result accepted.')); };
      instance.postMessage({ demo, session, mode: nextMode });
    });
  }
  async function run(nextMode: 'live' | 'replay', provider: 'gemini' | 'codex' = 'gemini') {
    if (running.current) return;
    running.current = true; setBusy(true); setMode(nextMode); setError(''); setResult(null); setStage('RECONCILE');
    try {
      let session: unknown;
      if (nextMode === 'replay') {
        setMessage('Loading recorded proposals. Verification will rerun from unchanged raw sample sources. No model call.');
        const response = await fetch('/data/agent-session.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('The recorded agent session is unavailable.');
        session = await response.json();
      } else if (provider === 'gemini') {
        setMessage('Starting a live Gemini investigation on the server. Only the fixed public synthetic evidence is sent.');
        const response = await fetch('/api/agent/run', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vouch-demo-code': accessCode.trim() }, body: '{}', signal: AbortSignal.timeout(85000) });
        session = await readHostedAgentStream(response, (nextStage, detail) => { setStage(nextStage); setMessage(detail); });
      } else {
        setMessage('Starting a live investigation using the local Codex subscription.');
        const response = await fetch(`${companion}/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-vouch-action': 'investigate-synthetic-sample' }, body: '{}', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`The companion rejected this run (${response.status}). Check connection, cooldown or session allowance.`);
        const accepted = parseStatus(await response.json());
        if (!accepted.runId) throw new Error('Companion version mismatch. Restart pnpm agent.');
        const deadline = Date.now() + 155000;
        while (!cancelled.current && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1200));
          const poll = await fetch(`${companion}/status`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
          if (!poll.ok) throw new Error('Lost connection to the local agent. No replay was substituted.');
          const state = parseStatus(await poll.json()); setRemaining(state.attemptsRemaining);
          if (state.runId !== accepted.runId) throw new Error('Another local run replaced this session. No unrelated result accepted.');
          if (state.progress) { setStage(state.progress.stage); setMessage(state.progress.message); }
          if (state.status === 'failed') throw new Error(state.error);
          if (state.status === 'complete') { session = state.session; break; }
        }
        if (!session) throw new Error('Live investigation timed out. No replay was substituted.');
      }
      setStage('VERIFY'); setMessage('Independently rebuilding the result from source rows and model proposals in this browser.');
      const next = await verify(session, nextMode); if (cancelled.current) return;
      setResult(next); setStage('REPORT'); setMessage('Run complete. Unresolved evidence remains in the exception report.');
    } catch (cause) { if (!cancelled.current) setError(cause instanceof Error ? cause.message : 'Agent run failed'); }
    finally { running.current = false; if (!cancelled.current) { setBusy(false); void refreshHosted(); } }
  }
  const artifact = result?.artifact;
  const provenance = result?.session.provenance;
  return <section className="agent-room room-view" aria-labelledby="agent-heading">
    <div className="agent-heading"><div><p className="kicker">THE INVESTIGATION DESK / SYNTHETIC BATCH</p><h1 id="agent-heading">An agent that knows<br /><em>when to stop.</em></h1><p>Reconcile 1,083 source records. Investigate unresolved evidence. Verify every proposal. Hand off everything that cannot be proved.</p></div><div className="agent-launch"><span className="agent-mode">{busy ? `${mode.toUpperCase()} IN PROGRESS` : result ? `${mode.toUpperCase()} RESULT` : 'CHOOSE A RUN'}</span>
      <label className="agent-access">Demo access code<input type="password" autoComplete="off" value={accessCode} onChange={event => setAccessCode(event.target.value)} maxLength={128} disabled={busy} placeholder="Access code, never an API key" /></label>
      <button className="run-button" disabled={busy || !hosted.configured || hosted.callsRemaining === 0 || !accessCode.trim()} onClick={() => void run('live')} type="button"><span>{busy && mode === 'live' ? 'LIVE INVESTIGATION…' : 'RUN LIVE GEMINI AGENT'}</span><i>↗</i></button>
      <p>{hosted.configured ? `${hosted.model} · ${hosted.callsRemaining}/50 demo calls remain. One active call; 30-second cooldown.` : 'Hosted Gemini is not configured or temporarily unavailable.'} <button type="button" className="agent-text-button" disabled={busy} onClick={() => void refreshHosted()}>Check availability</button></p>
      <small>The API key stays on the server. Request a demo access code from the builder; replay below needs no code.</small>
      <button className="agent-replay" disabled={busy} onClick={() => void run('replay')} type="button">{busy && mode === 'replay' ? 'REVERIFYING RECORDED PROPOSALS…' : 'REPLAY RECORDED AGENT + REVERIFY ↗'}</button><small>Replay makes no model call. Both modes run the verifier. No source files are uploaded from this page.</small>
      {local ? <details className="local-companion"><summary>Local Codex companion</summary><p>{connected ? `Connected · ${remaining} local calls left.` : <>Start <code>pnpm agent</code>, then <button className="agent-text-button" onClick={() => void connect()} type="button">check connection</button>.</>}</p><button className="agent-replay" disabled={busy || !connected || remaining === 0} onClick={() => void run('live', 'codex')} type="button">RUN LOCAL CODEX AGENT ↗</button></details> : null}
    </div></div>
    <div className="agent-flow" aria-label="Agent workflow">{stages.map((item, index) => <div key={item.id} className={stage === item.id ? 'current' : stage && stages.findIndex(row => row.id === stage) > index ? 'completed' : ''}><span>0{index + 1}</span><h2>{item.title}</h2><p>{item.detail}</p></div>)}</div>
    <div className="agent-status" aria-live="polite" aria-busy={busy}>{error ? <p role="alert"><b>NO AI RESULT ACCEPTED.</b> {error} The Evidence desk retains the previous result.</p> : <p>{message || 'The agent receives only a bounded packet of unresolved public synthetic evidence—not the merchant upload flow.'}</p>}</div>
    {result && artifact && provenance ? <>
      <section className="agent-summary"><div><p className="kicker">{mode === 'live' ? 'LIVE MODEL RESPONSE / CODE-VERIFIED RESULT' : 'RECORDED MODEL RESPONSE / FRESH CODE VERIFICATION'}</p><h2>{proved(result.baseline)} → {proved(artifact)} settlements proved.</h2><p>{(100 * proved(artifact) / artifact.summary.settlements).toFixed(1)}% match rate: {proved(artifact)} of {artifact.summary.settlements} settlements. {artifact.summary.settlements - proved(artifact)} remain unproved. Coverage, not accuracy.</p></div><div className="agent-metrics"><b>{artifact.summary.rowOutcomes}/{artifact.summary.inputRows}<small>ROWS ACCOUNTED FOR</small></b><b>{artifact.exceptions.length}<small>EXCEPTION RECORDS</small></b><b>{artifact.summary.acceptedResidualPaise}<small>ACCEPTED RESIDUAL · PAISE</small></b></div></section>
      <div className="agent-trace-head"><p className="kicker">MODEL PROPOSALS → PROGRAM CHECKS → FINAL DECISIONS</p><h2>{result.session.hypotheses.length} proposals. No financial authority.</h2><p>{artifact.hypotheses.filter(item => item.status === 'VERIFIED').length} candidate verdicts verified · {artifact.hypotheses.filter(item => item.status === 'REJECTED').length} rejected · {artifact.summary.assistedMatches} assisted settlement matches.</p></div>
      <div className="agent-proposals">{artifact.hypotheses.length ? artifact.hypotheses.map((verdict, index) => {
        const proposal = result.session.hypotheses.find(raw => (raw as { hypothesis_id?: string }).hypothesis_id === verdict.hypothesisId) as { literal_spans?: { text: string; field: string; start: number; end: number }[] } | undefined;
        const settlement = artifact.settlements.find(row => row.settlementId === verdict.candidateSettlementId);
        return <article key={`${verdict.hypothesisId}-${index}`} className={verdict.status === 'VERIFIED' ? 'proposal-verified' : 'proposal-rejected'}><div className="proposal-top"><b>{verdict.status === 'VERIFIED' ? 'CANDIDATE VERIFIED' : 'PROPOSAL REJECTED'}</b><span>{settlement?.overallStatus ?? 'NO SETTLEMENT MATCH'}</span></div><p className="agent-pair"><code>{verdict.subjectBankEntryId ?? 'Unknown bank entry'}</code><span>→</span><code>{verdict.candidateSettlementId ?? 'No candidate'}</code></p>{proposal?.literal_spans?.map((span, spanIndex) => <blockquote key={spanIndex}><small>CITED {span.field.toUpperCase()} · CHARACTERS {span.start}–{span.end}</small>“{span.text}”</blockquote>)}<ul className="agent-checks">{verdict.tests.map((test, testIndex) => <li key={testIndex}><b className={test.passed ? 'check-pass' : 'check-fail'}>{test.passed ? 'PASS' : 'FAIL'}</b><div><span>{test.name.replaceAll('_', ' ')}</span><small>{test.detail}</small></div></li>)}</ul><p>{verdict.reason}</p><small>Global matching decides the final assignment, not model confidence.</small></article>;
      }) : <p>The model returned no proposals. The deterministic result stands; unresolved evidence remains for review.</p>}</div>
      <section className="agent-handoff"><div><p className="kicker">RECONCILIATION RUN CLOSED / EXCEPTIONS STILL OPEN</p><h2>Every unresolved item has a next action.</h2><p>No bank transfer, accounting write-back or manual approval is performed. Closing the run does not mean every settlement is resolved.</p></div><div className="agent-actions"><button type="button" onClick={() => { onResult(validateAndProjectArtifact(canonicalArtifactJson(artifact))); onInspect(); }}>INSPECT THIS RUN ↗</button><button type="button" onClick={() => download(`${artifact.artifactId}.json`, canonicalArtifactJson(artifact))}>EXPORT PROOF JSON ↓</button><button type="button" onClick={() => download(`agent-${result.session.sessionId}.json`, JSON.stringify(result.session, null, 2))}>EXPORT AGENT TRACE ↓</button><button type="button" onClick={() => download('vouch-agent-exceptions.csv', stringifyCsv(['exception_id', 'case_id', 'code', 'impact_paise', 'suggested_action', 'message'], artifact.exceptions.map(item => ({ exception_id: item.exceptionId, case_id: item.caseId, code: item.code, impact_paise: item.impactPaise === null ? '' : String(item.impactPaise), suggested_action: item.suggestedAction, message: item.message }))), 'text/csv;charset=utf-8')}>EXPORT EXCEPTIONS CSV ↓</button></div></section>
      <details className="agent-exceptions"><summary>All {artifact.exceptions.length} unresolved exception records</summary>{artifact.exceptions.map(item => <article key={item.exceptionId}><b>{item.code}</b><code>{item.caseId}</code><p>{item.message}</p><small>NEXT ACTION: {item.suggestedAction.replaceAll('_', ' ')}</small></article>)}</details>
      <details className="agent-provenance"><summary>Run provenance & recorded orchestration events</summary><p>Requested model: {provenance.requestedModel}. Reported model: {provenance.reportedModel ?? 'not supplied by the provider'}. Adapter: {provenance.adapter}.</p><p>Original model latency: {(provenance.latencyMs / 1000).toFixed(1)} seconds. Tokens: {provenance.totalTokens ?? 'not reported'}. Cost: {provenance.reportedCostUsd === null ? 'not reported; not assumed zero' : `$${provenance.reportedCostUsd}`}. {mode === 'replay' ? 'These describe the recorded call, not this replay.' : ''}</p><p>Captured: {result.session.completedAt}. {provenance.adapter === 'gemini' ? 'Gemini calls have a 60-second timeout, a 4,096-output-token limit and a durable 50-call demo allowance. These are request limits, not a guaranteed monetary price.' : 'The CLI enforces a 120-second request timeout and response-size limits; its output-token target is not an enforced spending cap.'}</p><code>{result.session.sessionSha256}</code><ol>{result.session.events.map(event => <li key={event.stage}><b>{event.stage}</b> · {event.at}<p>{event.message}</p></li>)}</ol><p>This trace contains program events and evidence, not hidden model reasoning. Hashes detect content changes; they do not authenticate the provider or sources.</p></details>
    </> : null}
    <div className="agent-footnote"><p>Synthetic development evidence—not a held-out evaluation or recovered merchant money. AI does not set financial status.</p><button type="button" onClick={onLab}>NEXT: CHALLENGE A PROOF IN THE LAB ↗</button></div>
  </section>;
}
