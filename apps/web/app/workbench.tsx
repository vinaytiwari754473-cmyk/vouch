'use client';

import { useEffect, useRef, useState } from 'react';
import { canonicalArtifactJson, stringifyCsv, type RunArtifact } from '@vouch/core';
import { validateAndProjectArtifact, type ArtifactProjection } from './artifact-data';
import { browserConfig, experimentInput, inputFromArtifact, parseSourceFiles, SOURCE_LIMIT_BYTES, type Experiment, type RunRequest, type SourceTexts } from './source-workbench';

const experiments: { id: Experiment; title: string; detail: string }[] = [
  { id: 'shortfall', title: '₹5,000 goes missing', detail: 'Same UTR. Lower bank credit.' },
  { id: 'one-paise', title: 'Just one paise', detail: 'No rounding. No tolerance.' },
  { id: 'missing-books', title: 'The books lose a row', detail: 'Cash agrees. Evidence does not.' },
  { id: 'duplicate-bank', title: 'Two plausible credits', detail: 'A second identity. No guessing.' },
  { id: 'unchanged', title: 'Restore the source', detail: 'Recalculate the original proof.' },
];

function money(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  return `${paise < 0 ? '−' : ''}₹${Math.floor(Math.abs(paise) / 100).toLocaleString('en-IN')}.${String(Math.abs(paise) % 100).padStart(2, '0')}`;
}
function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Workbench({ demo, onResult, onInspect, onRecorded }: { demo: RunArtifact; onResult: (next: ArtifactProjection, caseId?: string) => void; onInspect: () => void; onRecorded: () => void }) {
  const [files, setFiles] = useState<Partial<Record<keyof SourceTexts, File>>>({});
  const [baseline, setBaseline] = useState<RunArtifact | null>(null);
  const [result, setResult] = useState<RunArtifact | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [experiment, setExperiment] = useState<Experiment>('shortfall');
  const [resultExperiment, setResultExperiment] = useState<Experiment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);

  function compute(request: RunRequest): Promise<RunArtifact> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./reconcile.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      const finish = () => { clearTimeout(timeout); worker.terminate(); workerRef.current = null; };
      const timeout = setTimeout(() => { finish(); reject(new Error('The run exceeded 15 seconds. No proof was accepted. Try a smaller batch or use the CLI.')); }, 15000);
      worker.onmessage = (event: MessageEvent<{ artifact?: RunArtifact; error?: string }>) => {
        finish();
        if (event.data.error || !event.data.artifact) reject(new Error(event.data.error ?? 'No artifact returned'));
        else {
          try { resolve(validateAndProjectArtifact(canonicalArtifactJson(event.data.artifact)).artifact); }
          catch (cause) { reject(cause); }
        }
      };
      worker.onerror = () => { finish(); reject(new Error('The local verification worker could not run. No result was accepted.')); };
      worker.postMessage(request);
    });
  }

  async function guarded(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Run failed'); }
    finally { setBusy(false); }
  }
  function publish(artifact: RunArtifact, caseId?: string) {
    setResult(artifact);
    onResult(validateAndProjectArtifact(canonicalArtifactJson(artifact)), caseId);
  }
  async function loadSample() {
    await guarded(async () => {
      const next = await compute({ input: inputFromArtifact(demo), config: browserConfig(demo) });
      const first = next.settlements.find((item) => item.settlementId === 'setl_950hhkn23ad9sd' && item.overallStatus === 'EXACT_MATCH') ?? next.settlements.find((item) => item.overallStatus === 'EXACT_MATCH' && (item.equation?.actualPaise ?? 0) >= 500000);
      if (!first) throw new Error('No eligible proved settlement in the sample');
      setBaseline(next); setSelectedId(first.settlementId); setResultExperiment('unchanged'); publish(next, first.settlementId);
    });
  }
  async function runExperiment() {
    if (!baseline) return;
    await guarded(async () => {
      const input = experimentInput(baseline, selectedId, experiment);
      const next = await compute({ input, config: browserConfig(baseline) });
      setResultExperiment(experiment); publish(next, selectedId);
      requestAnimationFrame(() => document.getElementById('lab-result-heading')?.focus());
    });
  }
  async function runFiles() {
    await guarded(async () => {
      if (!files.recon || !files.bank || !files.merchant) throw new Error('Choose all three source files');
      for (const file of Object.values(files)) if (file.size > SOURCE_LIMIT_BYTES) throw new Error(`${file.name}: maximum file size is 5 MiB`);
      const [recon, bank, merchant] = await Promise.all([files.recon.text(), files.bank.text(), files.merchant.text()]);
      const input = parseSourceFiles({ recon, bank, merchant });
      const next = await compute({ input, config: browserConfig() });
      setResultExperiment(null); publish(next);
      requestAnimationFrame(() => document.getElementById('lab-result-heading')?.focus());
    });
  }
  function sampleFile(kind: keyof SourceTexts) {
    const input = inputFromArtifact(demo);
    if (kind === 'recon') { download('razorpay-recon.json', JSON.stringify({ items: input.reconRows }, null, 2), 'application/json'); return; }
    const source = kind === 'bank' ? input.bankRows : input.merchantRows;
    const headers = kind === 'bank' ? ['bank_row_ref', 'posting_date', 'direction', 'amount', 'currency', 'utr', 'narration'] : ['record_id', 'type', 'entity_ref', 'payment_ref', 'order_ref', 'expected_amount', 'currency', 'created_date', 'status'];
    const rows = source.map((row) => Object.fromEntries(headers.map((key) => [key, row[key] === null || row[key] === undefined ? '' : String(row[key])])));
    download(kind === 'bank' ? 'bank-statement.csv' : 'merchant-ledger.csv', stringifyCsv(headers, rows), 'text/csv;charset=utf-8');
  }

  const eligible = baseline?.settlements.filter((item) => item.overallStatus === 'EXACT_MATCH') ?? [];
  const before = baseline?.settlements.find((item) => item.settlementId === selectedId);
  const after = resultExperiment === null ? undefined : result?.settlements.find((item) => item.settlementId === selectedId);
  const restored = resultExperiment === 'unchanged' && baseline !== null && result?.artifactId === baseline.artifactId;

  return <section className="workbench room-view" aria-labelledby="workbench-heading">
    <div className="workbench-intro"><div><p className="kicker">THE PROOF LAB / ACTUAL ENGINE · LOCAL EXECUTION</p><h1 id="workbench-heading">Don’t trust the green.<br /><em>Challenge the proof.</em></h1><p>A matching reference is a lead, not a conclusion. Change the evidence. Watch the verifier earn—or withdraw—its answer.</p></div><aside><span>01 / CONTROLLED DEMONSTRATION</span><b>Source → calculation → verdict</b><p>No edited verdicts. No AI replay on altered data. The original evidence remains untouched.</p><button type="button" onClick={onRecorded} disabled={busy}>Open the recorded AI-assisted run ↗</button></aside></div>

    <div className="workbench-grid">
      <section className="challenge-panel" aria-labelledby="challenge-title"><div className="section-head"><div><p className="kicker">SYNTHETIC STRESS TEST</p><h2 id="challenge-title">What would break this proof?</h2></div><span>AI OFF</span></div>
        {!baseline ? <div className="challenge-start"><span className="lab-glyph" aria-hidden="true">₹<i>?</i></span><p>First, rebuild the demo from its raw source rows. This runs deterministic reconciliation, not a saved answer.</p><button className="run-button" type="button" disabled={busy} onClick={() => void loadSample()}><span>{busy ? 'RECALCULATING…' : 'RECONCILE SAMPLE SOURCES'}</span><i>↗</i></button></div> : <>
          <label className="lab-select">PROVED BASELINE CASE<select aria-label="Baseline settlement" value={selectedId} disabled={busy} onChange={(event) => { setSelectedId(event.target.value); setResultExperiment(null); setResult(null); }}>{eligible.map((item) => <option value={item.settlementId} key={item.settlementId}>{item.settlementId} · {money(item.equation?.actualPaise)}</option>)}</select></label>
          <div className="experiment-options" role="group" aria-label="Source change">{experiments.map((item, index) => <button key={item.id} type="button" aria-pressed={experiment === item.id} className={experiment === item.id ? 'active' : ''} onClick={() => setExperiment(item.id)} disabled={busy}><span>0{index + 1}</span><div><b>{item.title}</b><small>{item.detail}</small></div><i aria-hidden="true">{experiment === item.id ? '●' : '○'}</i></button>)}</div>
          <button className="run-button" onClick={() => void runExperiment()} type="button" disabled={busy}><span>{busy ? 'RECALCULATING FROM SOURCES…' : 'CHANGE SOURCE & RERUN'}</span><i>↗</i></button><small className="lab-note">Each experiment starts from the same baseline. Changes never accumulate.</small>
        </>}
      </section>
      <section className="source-panel" aria-labelledby="source-title"><div className="section-head"><div><p className="kicker">YOUR EVIDENCE / YOUR ANSWER</p><h2 id="source-title">Reconcile three source files.</h2></div></div><p>Use the documented schema below. Files stay in this browser session; this flow does not upload them to a server or call an AI provider.</p>
        {([{ key: 'recon', label: 'Razorpay reconciliation', format: 'JSON · items[] · integer paise' }, { key: 'bank', label: 'Bank statement', format: 'CSV · amount in rupees' }, { key: 'merchant', label: 'Merchant ledger', format: 'CSV · expected_amount in rupees' }] as const).map((item, index) => <div className="source-slot" key={item.key}><span>0{index + 1}</span><div><label htmlFor={`source-${item.key}`}>{item.label}</label><small>{item.format}</small><input id={`source-${item.key}`} type="file" accept={item.key === 'recon' ? '.json,application/json' : '.csv,text/csv'} disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; setFiles((prior) => ({ ...prior, [item.key]: file })); }} /></div><button type="button" onClick={() => sampleFile(item.key)}>SAMPLE ↓</button></div>)}
        <button className="run-button source-run" onClick={() => void runFiles()} type="button" disabled={busy || !files.recon || !files.bank || !files.merchant}><span>{busy ? 'RUN IN PROGRESS…' : 'RECONCILE MY FILES'}</span><i>↗</i></button><small className="lab-note">5 MiB/file · 5,000 rows total · 250 settlements · 15-second worker limit. INR only. No direct bank connection or source-authenticity claim.</small>
      </section>
    </div>
    {error ? <div className="lab-error" role="alert"><b>RUN NOT ACCEPTED</b><p>{error}</p><small>The previous result, if any, is unchanged.</small></div> : null}
    <div aria-live="polite" aria-busy={busy}>{result ? <section className={`lab-result ${restored ? 'result-restored' : ''}`}><div className="section-head"><div><p className="kicker">{resultExperiment === null ? 'SOURCE FILE RUN' : resultExperiment === 'unchanged' ? 'DETERMINISTIC BASELINE' : `SOURCE CHANGED / ${experiments.find((item) => item.id === resultExperiment)?.title.toUpperCase()}`}</p><h2 id="lab-result-heading" tabIndex={-1}>{restored ? 'The original proof is reproducible.' : after ? after.overallStatus === 'EXACT_MATCH' ? 'The verifier still accepts this evidence.' : 'The verifier will not close this case.' : 'Reconciliation complete. Inspect every outcome.'}</h2></div><button type="button" onClick={() => { onResult(validateAndProjectArtifact(canonicalArtifactJson(result)), after?.settlementId); onInspect(); }}>INSPECT FULL RUN ↗</button></div>
      {before && after ? <div className="result-comparison" role="table" aria-label="Before and after source change"><div role="row"><span>CHECK</span><b>BEFORE</b><b>AFTER</b></div>{[['Bank credit', money(before.equation?.actualPaise), money(after.equation?.actualPaise)], ['Residual', money(before.equation?.residualPaise), money(after.equation?.residualPaise)], ['Bank', before.bankStatus, after.bankStatus], ['Books', before.ledgerStatus, after.ledgerStatus], ['Verdict', before.overallStatus, after.overallStatus]].map(([label, oldValue, newValue]) => <div role="row" key={label}><span>{label}</span><b>{oldValue}</b><b className={oldValue !== newValue ? 'changed-value' : ''}>{newValue}</b></div>)}</div> : null}
      <div className="result-accounting"><b>{result.summary.exactMatches} / {result.summary.settlements}<small>AUTOMATICALLY PROVED</small></b><b>{result.summary.rowOutcomes} / {result.summary.inputRows}<small>SOURCE ROWS ACCOUNTED FOR</small></b><b>{result.exceptions.length}<small>EXCEPTION RECORDS</small></b><b>OFF<small>AI / NO REPLAY</small></b></div>
      <div className="result-identity"><code>{result.artifactId}</code><span>{restored ? 'IDENTICAL BASELINE ARTIFACT ID' : 'HASHED SOURCES + DECISIONS'}</span><button type="button" onClick={() => download(`${result.artifactId}.json`, canonicalArtifactJson(result), 'application/json')}>EXPORT RUN JSON ↓</button></div>
    </section> : null}</div>
    <p className="lab-disclosure">The sample is synthetic development data, not a held-out accuracy test or recovered merchant money. Browser runs use the same deterministic core as the CLI. The recorded hybrid run separately demonstrates a pinned AI proposal checked by code.</p>
  </section>;
}
