'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { RunArtifact } from '@vouch/core';
import { Workbench } from './workbench';
import {
  type ArtifactProjection,
  evaluationRows,
  validateAndProjectArtifact,
  verificationStages,
  type CaseStatus,
  type SettlementCase,
} from './artifact-data';

type View = 'workbench' | 'evidence' | 'exceptions' | 'evaluation';
type CaseFilter = 'ALL' | 'PROVED' | 'OPEN';

const statusOrder: Record<CaseStatus, number> = {
  DISCREPANCY: 0, AMBIGUOUS: 1, MISSING: 2, REVIEW: 3, ASSISTED: 4, PROVED: 5,
};

function formatPaise(value: number | null, signed = false) {
  if (value === null) return '—';
  const sign = value < 0 ? '−' : signed && value > 0 ? '+' : '';
  const absolute = Math.abs(value);
  const rupees = Math.floor(absolute / 100).toLocaleString('en-IN');
  return `${sign}₹${rupees}.${String(absolute % 100).padStart(2, '0')}`;
}

function downloadText(filename: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  const protectedValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function fetchSealedProjection(): Promise<ArtifactProjection> {
  const response = await fetch('/data/demo-run.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`sealed artifact request failed (${response.status})`);
  return validateAndProjectArtifact(await response.text());
}

function nextPaint(): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function StatusMark({ status }: { status: CaseStatus }) {
  return <span className={`status-mark status-${status.toLowerCase()}`}>{status}</span>;
}

function MiniWitness({ index, label, value, state }: { index: string; label: string; value: string; state: 'ok' | 'hold' | 'ai' }) {
  return (
    <div className={`mini-witness witness-${state}`}>
      <span>{index}</span>
      <div><b>{label}</b><small>{value}</small></div>
      <i aria-hidden="true">{state === 'ok' ? '✓' : state === 'ai' ? 'AI' : '!'}</i>
    </div>
  );
}

function EvidenceView({ selected }: { selected: SettlementCase }) {
  const residual = selected.actualPaise === null ? null : selected.actualPaise - selected.expectedPaise;
  const paymentNet = selected.rows.filter((row) => row.contributionPaise > 0).reduce((sum, row) => sum + row.contributionPaise, 0);
  const debits = selected.rows.filter((row) => row.contributionPaise < 0).reduce((sum, row) => sum + row.contributionPaise, 0);
  const allProved = selected.status === 'PROVED' || selected.status === 'ASSISTED';

  return (
    <section className="case-sheet" aria-labelledby="case-heading">
      <div className="case-heading">
        <div><p className="kicker">CASE FILE / {selected.shortId}</p><h1 id="case-heading" tabIndex={-1}>{selected.id}</h1></div>
        <StatusMark status={selected.status} />
      </div>

      <div className="witness-row" aria-label="Three-source verification state">
        <MiniWitness index="01" label="MERCHANT BOOKS" value={selected.ledgerStatus === 'NOT_REQUIRED' ? 'Not required for these row types' : `${selected.rows.filter((row) => row.merchant === 'VERIFIED').length}/${selected.rows.filter((row) => row.merchant !== 'NOT_REQUIRED').length} required records agree`} state={selected.ledgerStatus === 'VERIFIED' ? 'ok' : 'hold'} />
        <MiniWitness index="02" label="RAZORPAY RECON" value={`${selected.rows.length} ledger effects`} state="ok" />
        <MiniWitness index="03" label="BANK STATEMENT" value={selected.bankReference ?? 'No proved counterpart'} state={selected.bankStatus === 'EXACT' ? 'ok' : selected.bankStatus === 'ASSISTED' ? 'ai' : 'hold'} />
      </div>

      <div className="proof-body">
        <div className="constituents">
          <div className="section-head">
            <div><p className="kicker">CONSTITUENT EVIDENCE</p><h2>How the settlement was rebuilt</h2></div>
            <span>INR · INTEGER PAISE</span>
          </div>
          <div className="evidence-table" role="table" aria-label="Settlement constituent rows">
            <div className="evidence-row evidence-header" role="row">
              <span>ENTITY</span><span>TYPE</span><span>GROSS</span><span>FEE / TAX</span><span>SETTLEMENT EFFECT</span><span>BOOKS</span>
            </div>
            {selected.rows.map((row) => (
              <div className="evidence-row" role="row" key={row.rowId}>
                <code>{row.id}</code><span>{row.kind}</span><span>{formatPaise(row.grossPaise)}</span>
                <span>{row.feePaise ? `${formatPaise(row.feePaise)} / ${formatPaise(row.taxPaise)}` : '—'}</span>
                <b>{formatPaise(row.contributionPaise, true)}</b><em className={`ledger-${row.merchant.toLowerCase()}`}>{row.merchant}</em>
              </div>
            ))}
          </div>

          <div className="accounting-note">
            <strong>THE FOUNDING BUG, MADE VISIBLE</strong>
            <p><code>tax</code> is already inside <code>fee</code>. Vouch settles from authoritative <code>credit − debit</code>; subtracting GST again creates a convincing but false gap.</p>
          </div>

          <div className="candidate-area">
            <div className="section-head compact">
              <div><p className="kicker">CANDIDATE GRAPH</p><h2>{selected.candidates.length ? `${selected.candidates.length} bank edge${selected.candidates.length > 1 ? 's' : ''} examined` : 'No compatible bank edge'}</h2></div>
              <span>GLOBAL, NOT GREEDY</span>
            </div>
            {selected.candidates.length ? selected.candidates.map((candidate) => (
              <div className={`candidate-edge ${candidate.possible ? '' : 'edge-rejected'}`} key={candidate.id}>
                <code>{selected.shortId}</code><i>────────</i><code>{candidate.id}</code><b>{formatPaise(candidate.amountPaise)}</b><small>{candidate.evidence}</small>
              </div>
            )) : <p className="empty-evidence">Amount and date alone are deliberately insufficient evidence.</p>}
          </div>

          {selected.aiNote ? (
            <aside className={`ai-marginalia ai-${selected.aiNote.verdict.toLowerCase()}`}>
              <div><span>AI HYPOTHESIS</span><b>{selected.aiNote.verdict} · NOT A VERDICT</b></div>
              <blockquote><small>SOURCE NARRATION</small>“{selected.aiNote.sourceNarration}”</blockquote><p>{selected.aiNote.explanation}</p>
              <div className="ai-tests">{selected.aiNote.tests.map((test) => <small key={test}>{test}</small>)}</div>
            </aside>
          ) : null}
        </div>

        <aside className={`certificate certificate-${selected.status.toLowerCase()}`}>
          <p className="kicker">PROOF CERTIFICATE</p>
          <dl className="equation">
            <div><dt>Positive ledger effects</dt><dd>{formatPaise(paymentNet)}</dd></div>
            <div><dt>Refund / debit effects</dt><dd>{formatPaise(debits, true)}</dd></div>
            <div className="equation-total"><dt>Calculated settlement</dt><dd>{formatPaise(selected.expectedPaise)}</dd></div>
            <div><dt>Observed bank credit</dt><dd>{formatPaise(selected.actualPaise)}</dd></div>
          </dl>

          <div className="residual-block">
            <span>RESIDUAL</span><strong>{formatPaise(residual)}</strong>
            <small>{residual === 0 ? 'EXACT · NO TOLERANCE' : residual === null ? 'NOT COMPUTABLE' : `${Math.abs(residual)} PAISE UNEXPLAINED`}</small>
          </div>

          <div className="status-matrix">
            <div><span>BANK</span><b>{selected.bankStatus}</b></div><div><span>BOOKS</span><b>{selected.ledgerStatus}</b></div><div><span>REVIEW</span><b>{selected.reviewStatus}</b></div>
          </div>

          {allProved ? (
            <div className={`seal ${selected.status === 'ASSISTED' ? 'seal-assisted' : ''}`}>
              <small>{selected.ledgerStatus === 'NOT_REQUIRED' ? 'BANK PROVED · BOOKS NOT REQUIRED' : selected.status === 'ASSISTED' ? 'VERIFIED AFTER AI PROPOSAL' : 'THREE WITNESSES AGREE'}</small><b>PROVED</b><span>VOUCH / ZERO PAISE</span>
            </div>
          ) : (
            <div className="exception-ticket"><span>{selected.exceptionCodes.join(' · ') || 'REVIEW REQUIRED'}</span><p>{selected.exceptionCopy ?? 'The artifact leaves this case open without claiming a proof.'}</p><b>NEXT / {selected.suggestedAction ?? 'MANUAL REVIEW'}</b></div>
          )}

          <div className="identity-meta">
            <span><b>SETTLED</b>{selected.settledDate}</span><span><b>BANK POSTED</b>{selected.bankDate ?? 'NOT OBSERVED'}</span><span><b>GROUP UTR</b>{selected.utr ?? 'MISSING'}</span>
          </div>
        </aside>
      </div>

      <div className="audit-trail">
        <div className="section-head compact"><div><p className="kicker">IMMUTABLE REASONING TRACE</p><h2>Why Vouch reached this state</h2></div><span>{selected.audit.length} EVENTS</span></div>
        <div className="audit-events">
          {selected.audit.map((event, index) => (
            <article className={`audit-event audit-${event.tone}`} key={`${event.stage}-${index}`}><span>{event.stage}</span><b>{event.title}</b><p>{event.detail}</p></article>
          ))}
          {selected.audit.length === 0 ? <p className="empty-evidence">No case-scoped audit event was recorded.</p> : null}
        </div>
      </div>
    </section>
  );
}

function ExceptionsView({ cases, artifact, onSelect }: { cases: SettlementCase[]; artifact: RunArtifact; onSelect: (item: SettlementCase) => void }) {
  const exceptionRecords = artifact.exceptions.length;
  const exceptions = cases.filter((item) => item.status !== 'PROVED' && item.status !== 'ASSISTED');
  const cashExposure = exceptions.reduce((sum, item) => item.actualPaise === null ? sum + item.expectedPaise : sum + Math.abs(item.actualPaise - item.expectedPaise), 0);
  return (
    <section className="room-view">
      <div className="room-title">
        <div><p className="kicker">EXCEPTION ROOM / {exceptions.length} OPEN CASES / {exceptionRecords} RECORDS</p><h1>Nothing disappears<br />into “needs review.”</h1></div>
        <div className="room-number"><span>VISIBLE CASH EXPOSURE</span><strong>{formatPaise(cashExposure)}</strong><small>Different categories are never netted together.</small></div>
      </div>
      <div className="exception-ledger">
        <div className="exception-row exception-head"><span>CASE</span><span>FAILURE</span><span>BANK</span><span>BOOKS</span><span>IMPACT</span><span>ACTION</span></div>
        {exceptions.map((item) => {
          const impact = item.actualPaise === null ? item.expectedPaise : Math.abs(item.actualPaise - item.expectedPaise);
          return (
            <button className="exception-row" key={item.id} onClick={() => onSelect(item)} type="button">
              <span><b>{item.shortId}</b><code>{item.id}</code></span><span><StatusMark status={item.status} /><small>{item.exceptionCode}</small></span>
              <span>{item.bankStatus}</span><span>{item.ledgerStatus}</span><strong>{formatPaise(impact)}</strong><i>OPEN FILE ↗</i>
            </button>
          );
        })}
      </div>
      <div className="exception-principles">
        <article><span>01</span><h2>Discrepancy is not “unmatched”</h2><p>An exact UTR with unequal money is quarantined as short or excess credit. It cannot wander into another match.</p></article>
        <article><span>02</span><h2>Ambiguity is a result</h2><p>If more than one maximum assignment survives, Vouch refuses to pick the convenient one.</p></article>
        <article><span>03</span><h2>Three statuses, no greenwash</h2><p>Bank, merchant ledger and review states remain separate. Exact cash is not enough when the books disagree.</p></article>
      </div>
      <details className="all-exceptions"><summary>ALL {exceptionRecords} EXCEPTION RECORDS · INCLUDING INVALID AND ORPHAN SOURCE ROWS</summary><p>Settlement cases above are only one view. This register also includes exceptions that have no settlement case.</p>{artifact.exceptions.map((item) => <article key={item.exceptionId}><b>{item.code}</b><code>{item.caseId}</code><p>{item.message}</p><small>NEXT / {item.suggestedAction} · {item.evidenceRowIds.length} evidence rows</small><details><summary>Source row identifiers</summary>{item.evidenceRowIds.map((id) => <code className="exception-source-id" key={id}>{id}</code>)}</details></article>)}</details>
    </section>
  );
}

function EvaluationView() {
  return (
    <section className="room-view eval-view">
      <div className="eval-banner"><span>DEVELOPMENT BATCH</span><b>SYNTHETIC · PRE-REGISTERED METRICS · NOT HELD-OUT</b><em>seed / vouch-dev-seed-2026-08-25-v1</em></div>
      <div className="room-title">
        <div><p className="kicker">SAFETY BEFORE COVERAGE</p><h1>Abstention beats<br />a plausible lie.</h1></div>
        <div className="room-number safe-number"><span>VOUCH HYBRID / OBSERVED</span><strong>0 / 10</strong><small>false automatic verifications · Wilson upper bound lives in the artifact</small></div>
      </div>
      <div className="eval-table" role="table" aria-label="Development evaluation comparison">
        <div className="eval-row eval-head" role="row"><span>SYSTEM</span><span>AUTO COVERAGE</span><span>AUTO PRECISION</span><span>FALSE AUTO</span><span>UNIQUE RECALL</span><span>READOUT</span></div>
        {evaluationRows.map((row, index) => (
          <div className={`eval-row ${index === 2 ? 'eval-highlight' : ''}`} role="row" key={row.label}>
            <b>{row.label}</b><span>{row.accepted}</span><span>{row.correct}</span><span>{row.falseRate}</span><span>{row.recall}</span><em>{row.note}</em>
          </div>
        ))}
      </div>
      <div className="method-grid">
        <article><span>01 / FROZEN</span><h2>Truth stays outside the solver</h2><p>Core cannot import the generator, evaluator or truth directory. Input and truth hashes are recorded separately.</p></article>
        <article><span>02 / EXACT</span><h2>Ratios keep their denominators</h2><p>Results are stored as k/n, not rounded marketing percentages. A zero denominator is N/A, never zero.</p></article>
        <article><span>03 / HONEST</span><h2>Synthetic is not prevalence</h2><p>Category scores test behavior under planted faults. They do not claim to represent real merchant frequency.</p></article>
        <article><span>04 / MEASURED LOCALLY</span><h2>15,128 rows / second</h2><p>30 sealed runs after 5 warmups: p50 71.59 ms, p95 85.81 ms. Machine-specific core timing, not end-to-end upload or live-model latency.</p></article>
      </div>
    </section>
  );
}

export default function Home() {
  const [view, setView] = useState<View>('workbench');
  const [projection, setProjection] = useState<ArtifactProjection | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<CaseFilter>('ALL');
  const [query, setQuery] = useState('');
  const [verifyStep, setVerifyStep] = useState(-1);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState('LOADING SEALED ARTIFACT');
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const originalDemo = useRef<RunArtifact | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSealedProjection()
      .then((next) => {
        if (cancelled) return;
        originalDemo.current = next.artifact;
        setProjection(next);
        setSelectedId(next.cases[0]?.id ?? '');
        setNotice(`INTERNALLY CONSISTENT · ${next.batch.runId}`);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'unknown validation error');
        setNotice('SEALED ARTIFACT REJECTED');
      });
    return () => { cancelled = true; };
  }, []);

  const cases = useMemo(() => projection?.cases ?? [], [projection]);
  const batch = projection?.batch;
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];
  const filteredCases = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return [...cases]
      .filter((item) => filter === 'ALL' || (filter === 'PROVED' ? ['PROVED', 'ASSISTED'].includes(item.status) : !['PROVED', 'ASSISTED'].includes(item.status)))
      .filter((item) => !lowered || `${item.id} ${item.shortId} ${item.utr ?? ''} ${item.exceptionCodes.join(' ')}`.toLowerCase().includes(lowered))
      .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  }, [cases, filter, query]);

  const sealed = notice.startsWith('INTERNALLY CONSISTENT');

  async function verifyArtifact() {
    if (projection === null || verifying) return;
    setVerifying(true);
    setVerifyStep(0);
    setNotice('VERIFYING ARTIFACT BYTES');
    try {
      let artifactText = projection.canonicalText;
      if (projection.isSealedDemo) {
        const response = await fetch('/data/demo-run.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`sealed artifact request failed (${response.status})`);
        artifactText = await response.text();
      }
      setVerifyStep(1);
      await nextPaint();
      const next = validateAndProjectArtifact(artifactText);
      setVerifyStep(2);
      await nextPaint();
      setVerifyStep(3);
      await nextPaint();
      setVerifyStep(4);
      setProjection(next);
      if (!next.cases.some((item) => item.id === selectedId)) setSelectedId(next.cases[0]?.id ?? '');
      setNotice(`INTERNALLY CONSISTENT · SHA ${next.batch.artifactSha256.slice(0, 12)}…`);
    } catch (error: unknown) {
      setNotice(`VERIFICATION REJECTED · ${error instanceof Error ? error.message.toUpperCase().slice(0, 72) : 'INVALID ARTIFACT'}`);
    } finally {
      setVerifying(false);
      setVerifyStep(-1);
    }
  }

  function openCase(item: SettlementCase) {
    setSelectedId(item.id); setView('evidence');
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    window.requestAnimationFrame(() => document.getElementById('case-heading')?.focus());
  }
  function exportCsv() {
    const headers = ['settlement_id', 'overall_status', 'bank_status', 'ledger_status', 'expected_paise', 'actual_paise', 'exception'];
    const lines = cases.map((item) => [item.id, item.status, item.bankStatus, item.ledgerStatus, String(item.expectedPaise), item.actualPaise === null ? '' : String(item.actualPaise), item.exceptionCodes.join('|')].map(csvCell).join(','));
    downloadText('vouch-review-queue.csv', [headers.map(csvCell).join(','), ...lines].join('\r\n'), 'text/csv;charset=utf-8');
    setNotice('REVIEW CSV EXPORTED · FORMULA-SAFE');
  }
  function exportArtifact() {
    if (projection === null) return;
    downloadText(`${projection.batch.runId}.json`, `${projection.canonicalText}\n`, 'application/json;charset=utf-8');
    setNotice(`CANONICAL ARTIFACT EXPORTED · ${projection.batch.runId}`);
  }
  async function importArtifact(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('file exceeds 25 MiB');
      const next = validateAndProjectArtifact(await file.text());
      setProjection(next);
      setSelectedId(next.cases[0]?.id ?? '');
      setView('evidence');
      setQuery('');
      setNotice(`INTERNALLY CONSISTENT · ${next.cases.length} CASES · LOCAL IMPORT`);
    } catch (error: unknown) {
      setNotice(`IMPORT REJECTED · ${error instanceof Error ? error.message.toUpperCase().slice(0, 72) : 'INVALID ARTIFACT'}`);
    }
    finally { event.target.value = ''; }
  }

  async function retryLoad() {
    setLoadError(null);
    setNotice('LOADING SEALED ARTIFACT');
    try {
      const next = await fetchSealedProjection();
      setProjection(next);
      setSelectedId(next.cases[0]?.id ?? '');
      setNotice(`INTERNALLY CONSISTENT · ${next.batch.runId}`);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'unknown validation error');
      setNotice('SEALED ARTIFACT REJECTED');
    }
  }

  if (projection === null || batch === undefined) {
    return (
      <main className="app-shell loading-shell">
        <header className="masthead">
          <div className="wordmark"><span>VOUCH</span><sup>01</sup></div>
          <div className="batch-meta" role="status" aria-live="polite"><span className="status-dot" aria-hidden="true" />{notice}</div>
        </header>
        <section className="artifact-loader">
          <p className="kicker">EVIDENCE DESK / TRUST GATE</p>
          <h1>{loadError === null ? 'Verifying the sealed artifact.' : 'The artifact did not pass.'}</h1>
          <p>{loadError === null ? 'Vouch checks the source hashes, row partition, references, equations, audit trace, summary and artifact identity before displaying one rupee.' : loadError}</p>
          {loadError === null ? <span className="loader-line" aria-hidden="true" /> : <button className="run-button loader-retry" onClick={() => void retryLoad()} type="button"><span>TRY SEALED ARTIFACT AGAIN</span><i>↗</i></button>}
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell view-${view} ${verifying ? 'is-running' : ''} ${sealed ? 'is-sealed' : ''}`}>
      <header className="masthead">
        <button className="wordmark" onClick={() => setView('evidence')} type="button" aria-label="Open Vouch evidence desk"><span>VOUCH</span><sup>01</sup></button>
        <nav className="primary-nav" aria-label="Product views">
          <button className={view === 'workbench' ? 'active' : ''} aria-current={view === 'workbench' ? 'page' : undefined} onClick={() => setView('workbench')} type="button">Proof Lab</button>
          <button className={view === 'evidence' ? 'active' : ''} aria-current={view === 'evidence' ? 'page' : undefined} onClick={() => setView('evidence')} type="button">Evidence desk</button>
          <button className={view === 'exceptions' ? 'active' : ''} aria-current={view === 'exceptions' ? 'page' : undefined} onClick={() => setView('exceptions')} type="button">Review <b>{batch.reviewCases}</b></button>
          {projection.isSealedDemo ? <button className={view === 'evaluation' ? 'active' : ''} aria-current={view === 'evaluation' ? 'page' : undefined} onClick={() => setView('evaluation')} type="button">Evaluation</button> : null}
        </nav>
        <div className="batch-meta" role="status" aria-live="polite"><span className="status-dot" aria-hidden="true" />{notice}</div>
      </header>

      <section className="control-strip">
        <div className="batch-identity"><span>CANONICAL ARTIFACT</span><b>VCH / {batch.runDate} / {batch.runId.slice(-6).toUpperCase()}</b><code>SHA {batch.artifactSha256.slice(0, 8)}…{batch.artifactSha256.slice(-4)}</code></div>
        <div className="batch-counts" aria-label="Batch counts">
          <span><b>{batch.reconRows}</b>RECON</span><span><b>{batch.merchantRows}</b>BOOKS</span><span><b>{batch.bankRows}</b>BANK</span><span><b>{batch.settlements}</b>CASES</span>
        </div>
        <div className="mode-switch"><span>AI MODE</span><b>{batch.aiMode.toUpperCase()}</b><small>{batch.aiMode === 'replay' ? 'PINNED CACHE' : 'ARTIFACT CONFIG'}</small></div>
        <button className="run-button" onClick={() => void verifyArtifact()} disabled={verifying} aria-busy={verifying} type="button"><span>{verifying ? verificationStages[Math.max(0, verifyStep)] : 'VERIFY CURRENT ARTIFACT'}</span><i>{verifying ? `${String(verifyStep + 1).padStart(2, '0')}/05` : '↗'}</i></button>
      </section>

      {verifying ? (
        <div
          className="run-tape"
          role="progressbar"
          aria-label="Sealed artifact verification"
          aria-valuemin={1}
          aria-valuemax={verificationStages.length}
          aria-valuenow={verifyStep + 1}
          aria-valuetext={verificationStages[Math.max(0, verifyStep)]}
        >
          <div className="run-progress" aria-hidden="true"><span style={{ transform: `scaleX(${(verifyStep + 1) / verificationStages.length})` }} /></div>
          <div className="run-copy"><small>SEALED ARTIFACT VERIFICATION</small><b>{verificationStages[Math.max(0, verifyStep)]}</b></div>
          <em aria-hidden="true">{String(verifyStep + 1).padStart(2, '0')} / {String(verificationStages.length).padStart(2, '0')}</em>
          <div className="run-nodes" aria-hidden="true">
            {verificationStages.map((stage, index) => <i className={index <= verifyStep ? 'passed' : ''} key={stage} />)}
          </div>
        </div>
      ) : null}

      <div hidden={view !== 'workbench'}><Workbench demo={originalDemo.current ?? projection.artifact} onResult={(next, caseId) => { setProjection(next); setSelectedId(caseId ?? next.cases[0]?.id ?? ''); setQuery(''); setFilter('ALL'); setNotice(`INTERNALLY CONSISTENT · FRESH SOURCE RUN · ${next.batch.inputRows} ROWS`); }} onInspect={() => setView('evidence')} onRecorded={() => { void retryLoad().then(() => setView('evidence')); }} /></div>

      {view === 'evidence' ? (
        <div className="desk-layout">
          <aside className="case-index">
            <div className="index-head"><p className="kicker">SETTLEMENT REGISTER</p><b>{filteredCases.length.toString().padStart(2, '0')} / {batch.settlements}</b></div>
            <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, UTR or exception" aria-label="Search cases" /></label>
            <div className="filter-row">{(['ALL', 'PROVED', 'OPEN'] as const).map((item) => <button className={filter === item ? 'active' : ''} aria-pressed={filter === item} onClick={() => setFilter(item)} type="button" key={item}>{item}</button>)}</div>
            <div className="case-list">
              {filteredCases.map((item) => (
                <button className={`case-card ${item.id === selected?.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)} type="button" key={item.id}>
                  <span className="case-number">/{item.shortId}</span><StatusMark status={item.status} /><b>{formatPaise(item.expectedPaise)}</b><code>{item.id}</code>
                  <small>{item.exceptionCode ?? (item.ledgerStatus === 'NOT_REQUIRED' ? 'BANK PROVED · BOOKS NOT REQUIRED' : item.status === 'ASSISTED' ? 'AI EDGE · CODE VERIFIED' : 'THREE SOURCES AGREE')}</small>
                </button>
              ))}
            </div>
            <div className="index-actions">
              <input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={importArtifact} />
              <button onClick={() => fileInput.current?.click()} type="button">IMPORT ARTIFACT</button><button onClick={exportCsv} type="button">EXPORT REVIEW CSV</button><button onClick={exportArtifact} type="button">EXPORT JSON</button>
            </div>
          </aside>
          {selected === undefined ? <section className="case-sheet empty-artifact"><p className="kicker">EMPTY ARTIFACT</p><h1>No settlement decisions were recorded.</h1></section> : <EvidenceView key={selected.id} selected={selected} />}
        </div>
      ) : view === 'exceptions' ? <ExceptionsView cases={cases} artifact={projection.artifact} onSelect={openCase} /> : view === 'evaluation' && projection.isSealedDemo ? <EvaluationView /> : null}

      <footer className="principle-bar"><span>AI PROPOSES.</span><span>THE VERIFIER PROVES.</span><span>EVERY PAISE IS EXPLAINED—OR HONESTLY ESCALATED.</span></footer>
    </main>
  );
}
