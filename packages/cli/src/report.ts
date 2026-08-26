import type { RunArtifact } from "@vouch/core";

import { stringifyCsv } from "./csv.js";

export function renderStandaloneReport(
  artifact: RunArtifact,
  evaluation: unknown | null = null
): string {
  const title = `Vouch evidence report · ${artifact.artifactId}`;
  const settlementRows = artifact.settlements
    .map((settlement) => {
      const equation = settlement.equation;
      return `<tr>
        <td><code>${escapeHtml(settlement.settlementId)}</code></td>
        <td>${badge(settlement.overallStatus)}</td>
        <td><code>${escapeHtml(settlement.bankEntryId ?? "—")}</code></td>
        <td>${escapeHtml(settlement.ledgerStatus)}</td>
        <td class="money">${equation === null ? "—" : formatInr(equation.expectedPaise)}</td>
        <td class="money">${equation === null ? "—" : formatInr(equation.actualPaise)}</td>
        <td class="money ${equation?.residualPaise === 0 ? "zero" : "risk"}">${
          equation === null ? "—" : formatSignedPaise(equation.residualPaise)
        }</td>
      </tr>`;
    })
    .join("\n");
  const exceptionRows = artifact.exceptions
    .map(
      (exception) => `<tr>
        <td>${badge(exception.code)}</td>
        <td><code>${escapeHtml(exception.caseId)}</code></td>
        <td>${escapeHtml(exception.message)}</td>
        <td class="money">${exception.impactPaise === null ? "—" : formatSignedPaise(exception.impactPaise)}</td>
        <td>${escapeHtml(exception.suggestedAction)}</td>
      </tr>`
    )
    .join("\n");
  const hypotheses = artifact.hypotheses.length === 0
    ? '<p class="muted">No model hypothesis entered this run. Deterministic results remain complete.</p>'
    : artifact.hypotheses
        .map(
          (hypothesis) => `<article class="hypothesis">
            <div>${badge(hypothesis.status)} <code>${escapeHtml(hypothesis.hypothesisId)}</code></div>
            <p>${escapeHtml(hypothesis.reason)}</p>
            <small>${escapeHtml(hypothesis.candidateSettlementId ?? "No candidate")}</small>
          </article>`
        )
        .join("\n");
  const auditRows = artifact.auditEvents
    .map(
      (event) => `<li><span>${event.sequence}</span><strong>${escapeHtml(event.type)}</strong><code>${escapeHtml(event.subjectId)}</code><p>${escapeHtml(event.detail)}</p></li>`
    )
    .join("\n");
  const evaluationBlock = evaluation === null
    ? ""
    : `<section><div class="section-heading"><p>Benchmark</p><h2>Frozen evaluation result</h2></div><details><summary>Inspect scored JSON</summary><pre>${escapeHtml(JSON.stringify(evaluation, null, 2))}</pre></details></section>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{--ink:#f2efe7;--muted:#989c99;--line:#303633;--panel:#161b19;--acid:#c7ff4a;--amber:#ffb45e;--red:#ff6b6b;--blue:#6dd6ff;background:#0b0e0d;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 0,#22301b 0,transparent 28rem),#0b0e0d;color:var(--ink)}main{width:min(1240px,calc(100% - 40px));margin:auto;padding:40px 0 80px}header{border-bottom:1px solid var(--line);padding-bottom:34px}.eyebrow,.section-heading p{margin:0 0 10px;color:var(--acid);font:700 12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase}h1{font-size:clamp(44px,8vw,92px);line-height:.91;letter-spacing:-.065em;margin:0;max-width:900px}h1 em{font-style:normal;color:var(--acid)}.lede{max-width:690px;color:#c1c6c2;font-size:18px;line-height:1.55}.meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.meta code,.chip{border:1px solid var(--line);background:#101412;padding:8px 11px;border-radius:999px;color:#c8ccc9}section{padding:38px 0;border-bottom:1px solid var(--line)}.section-heading{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:18px}.section-heading h2{font-size:28px;margin:0;letter-spacing:-.03em}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.metric{min-height:120px;background:var(--panel);border:1px solid var(--line);padding:16px}.metric b{font-size:34px;display:block;letter-spacing:-.04em}.metric span{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}table{width:100%;border-collapse:collapse;background:var(--panel);font-size:13px}th{color:var(--muted);font-weight:600;text-align:left}th,td{padding:13px 12px;border-bottom:1px solid var(--line);vertical-align:top}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em;color:#d6ddd8}.scroll{overflow:auto;border:1px solid var(--line)}.badge{display:inline-block;padding:4px 7px;border:1px solid #48504c;border-radius:2px;font:700 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.05em}.badge[data-kind="good"]{color:var(--acid);border-color:#617c28}.badge[data-kind="warn"]{color:var(--amber);border-color:#78552e}.badge[data-kind="risk"]{color:var(--red);border-color:#783939}.money{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.zero{color:var(--acid)}.risk{color:var(--red)}.hypothesis{border:1px solid var(--line);background:var(--panel);padding:16px;margin:8px 0}.hypothesis p{color:#c1c6c2}.muted{color:var(--muted)}.audit{list-style:none;padding:0;margin:0;display:grid;gap:1px}.audit li{display:grid;grid-template-columns:42px 170px 260px 1fr;gap:12px;background:var(--panel);padding:12px}.audit li span{color:var(--muted);font-family:monospace}.audit li p{margin:0;color:#bfc4c0}details{border:1px solid var(--line);background:var(--panel);padding:16px}summary{cursor:pointer;color:var(--acid)}pre{white-space:pre-wrap;word-break:break-word;color:#c9ceca;font-size:12px}footer{padding-top:28px;color:var(--muted);display:flex;justify-content:space-between;gap:20px}@media(max-width:900px){.metrics{grid-template-columns:repeat(2,1fr)}.audit li{grid-template-columns:32px 1fr}.audit li code,.audit li p{grid-column:2}.section-heading{display:block}}@media print{body{background:#fff;color:#111}main{width:100%;padding:0}.metric,table,.hypothesis,.audit li,details{background:#fff;border-color:#bbb;color:#111}.muted,.audit li p{color:#444}.badge{color:#111!important;border-color:#777!important}}
  </style>
</head>
<body><main>
  <header>
    <p class="eyebrow">Synthetic evidence dossier · offline reproducible</p>
    <h1>Every paise,<br><em>accounted for.</em></h1>
    <p class="lede">Vouch reconciles Razorpay settlement evidence, bank credits, and merchant books. AI may propose evidence; deterministic code owns every accepted financial decision.</p>
    <div class="meta"><code>${escapeHtml(artifact.artifactId)}</code><span class="chip">${escapeHtml(artifact.config.mode)} / ${escapeHtml(artifact.config.aiMode)}</span><span class="chip">clock ${artifact.runAtEpochSeconds}</span></div>
  </header>
  <section>
    <div class="section-heading"><div><p>Run integrity</p><h2>Closed-loop summary</h2></div><span class="chip">${artifact.summary.complete ? "COMPLETE" : "INCOMPLETE"}</span></div>
    <div class="metrics">
      ${metric(artifact.summary.inputRows, "input rows")}${metric(artifact.summary.settlements, "settlements")}${metric(artifact.summary.exactMatches, "exact matches")}${metric(artifact.summary.assistedMatches, "AI-assisted")}${metric(artifact.summary.ambiguous, "ambiguous")}${metric(artifact.summary.acceptedResidualPaise, "accepted residual paise")}
    </div>
  </section>
  <section>
    <div class="section-heading"><div><p>Settlement evidence</p><h2>Bank ↔ Razorpay ↔ books</h2></div><span class="chip">zero tolerance</span></div>
    <div class="scroll"><table><thead><tr><th>Settlement</th><th>Status</th><th>Bank row</th><th>Ledger</th><th class="money">Expected</th><th class="money">Actual</th><th class="money">Residual</th></tr></thead><tbody>${settlementRows}</tbody></table></div>
  </section>
  <section>
    <div class="section-heading"><div><p>Exception queue</p><h2>Nothing hidden</h2></div><span class="chip">${artifact.exceptions.length} records</span></div>
    <div class="scroll"><table><thead><tr><th>Type</th><th>Case</th><th>Evidence</th><th class="money">Impact</th><th>Next action</th></tr></thead><tbody>${exceptionRows}</tbody></table></div>
  </section>
  <section><div class="section-heading"><div><p>AI boundary</p><h2>Hypotheses and verdicts</h2></div></div>${hypotheses}</section>
  <section><div class="section-heading"><div><p>Audit trail</p><h2>Deterministic history</h2></div></div><ol class="audit">${auditRows}</ol></section>
  ${evaluationBlock}
  <footer><span>Vouch · synthetic benchmark, not production accuracy</span><span>AI proposes. The verifier proves.</span></footer>
</main></body></html>\n`;
}

export function auditEventsToCsv(artifact: RunArtifact): string {
  return stringifyCsv(
    ["sequence", "at_epoch_seconds", "type", "subject_id", "detail"],
    artifact.auditEvents.map((event) => ({
      sequence: event.sequence,
      at_epoch_seconds: event.atEpochSeconds,
      type: event.type,
      subject_id: event.subjectId,
      detail: event.detail
    }))
  );
}

function metric(value: number, label: string): string {
  return `<div class="metric"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`;
}

function badge(status: string): string {
  const kind = /EXACT|VERIFIED/.test(status)
    ? "good"
    : /AMBIGUOUS|PENDING|UNMATCHED/.test(status)
      ? "warn"
      : /INVALID|REJECTED|SHORT|EXCESS|MISSING|UNKNOWN|CONFLICT/.test(status)
        ? "risk"
        : "neutral";
  return `<span class="badge" data-kind="${kind}">${escapeHtml(status)}</span>`;
}

function formatInr(paise: number): string {
  const sign = paise < 0 ? "−" : "";
  const absolute = Math.abs(paise);
  return `${sign}₹${groupIndianDigits(String(Math.floor(absolute / 100)))}.${String(absolute % 100).padStart(2, "0")}`;
}

function formatSignedPaise(paise: number): string {
  return paise === 0 ? "₹0.00" : formatInr(paise);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function groupIndianDigits(value: string): string {
  if (value.length <= 3) return value;
  const tail = value.slice(-3);
  const head = value.slice(0, -3);
  const groupedHead = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${groupedHead},${tail}`;
}
