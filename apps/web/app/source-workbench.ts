import { canonicalJson, parseCsvObjects, parseMoneyInput, paiseFromInteger, checkedSubtract, runVouch, type JsonObject, type RunArtifact, type RunConfig, type RunInput } from '@vouch/core';

export const SOURCE_LIMIT_BYTES = 5 * 1024 * 1024;
export const SOURCE_LIMIT_ROWS = 5000;
export type SourceTexts = { recon: string; bank: string; merchant: string };
export type Experiment = 'unchanged' | 'one-paise' | 'shortfall' | 'missing-books' | 'duplicate-bank';
export type RunRequest = { input: RunInput; config: Partial<RunConfig> };

export function parseSourceFiles(texts: SourceTexts): RunInput {
  for (const [name, text] of Object.entries(texts)) {
    if (new TextEncoder().encode(text).byteLength > SOURCE_LIMIT_BYTES) throw new Error(`${name}: maximum file size is 5 MiB`);
  }
  const collection: unknown = JSON.parse(texts.recon);
  if (collection === null || typeof collection !== 'object' || Array.isArray(collection)) throw new Error('Razorpay JSON must contain an items array');
  const items: unknown = (collection as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.some((row: unknown) => row === null || typeof row !== 'object' || Array.isArray(row))) throw new Error('Razorpay items must be an array of row objects');
  const bank = parseCsvObjects(texts.bank, 'Bank CSV');
  const merchant = parseCsvObjects(texts.merchant, 'Merchant CSV');
  if (!bank.headers.includes('amount') || !bank.headers.includes('posting_date') || !(bank.headers.includes('bank_row_ref') || bank.headers.includes('bank_row_id'))) throw new Error('Bank CSV needs bank_row_id (or bank_row_ref), posting_date and amount headers; download the sample for the full schema');
  if (!merchant.headers.includes('expected_amount') || !(merchant.headers.includes('record_id') || merchant.headers.includes('ledger_row_id'))) throw new Error('Merchant CSV needs ledger_row_id (or record_id) and expected_amount headers; download the sample for the full schema');
  const input: RunInput = {
    reconRows: items as JsonObject[],
    bankRows: bank.records.map((row) => ({ ...row, bank_row_ref: row.bank_row_ref ?? row.bank_row_id ?? '' })),
    merchantRows: merchant.records.map((row) => ({ ...row, record_id: row.record_id ?? row.ledger_row_id ?? '', entity_ref: row.entity_ref ?? row.razorpay_ref ?? null, payment_ref: row.payment_ref ?? null, order_ref: row.order_ref ?? row.order_id ?? null })),
  };
  assertBrowserLimits(input);
  return input;
}

export function assertBrowserLimits(input: RunInput): void {
  const count = input.reconRows.length + input.bankRows.length + input.merchantRows.length + (input.settlementEntities?.length ?? 0);
  if (count > SOURCE_LIMIT_ROWS) throw new Error('Browser runs are limited to 5,000 total source rows; use the CLI for larger batches');
  if (new Set(input.reconRows.map((row) => row.settlement_id)).size > 250) throw new Error('Browser runs are limited to 250 settlements; use the CLI for larger batches');
}

/** Reuse raw evidence only. No prior verdict, truth label or AI replay is an input. */
export function inputFromArtifact(artifact: RunArtifact): RunInput {
  const rows = (source: string) => artifact.sourceRows.filter((row) => row.source === source).map((row) => JSON.parse(canonicalJson(row.raw)) as JsonObject);
  const settlements = rows('SETTLEMENT');
  return { reconRows: rows('RAZORPAY'), bankRows: rows('BANK'), merchantRows: rows('MERCHANT'), ...(settlements.length ? { settlementEntities: settlements } : {}) };
}

export function browserConfig(artifact?: RunArtifact): Partial<RunConfig> {
  return { ...(artifact?.config ?? {}), mode: 'deterministic', aiMode: 'off', inputProfile: artifact?.config.inputProfile ?? 'foreign' };
}

export function executeBrowserRun(request: RunRequest): RunArtifact {
  assertBrowserLimits(request.input);
  return runVouch(request.input, { ...request.config, mode: 'deterministic', aiMode: 'off' }, []);
}

/** Mutate a COPY of a proved case's source evidence, never its decision or original input. */
export function experimentInput(baseline: RunArtifact, settlementId: string, experiment: Experiment): RunInput {
  const input = inputFromArtifact(baseline);
  const settlement = baseline.settlements.find((item) => item.settlementId === settlementId);
  if (!settlement || settlement.overallStatus !== 'EXACT_MATCH' || !settlement.bankEntryId) throw new Error('Choose a deterministically proved settlement');
  const bank = baseline.bankEntries.find((item) => item.bankEntryId === settlement.bankEntryId);
  const bankSource = baseline.sourceRows.find((row) => row.rowId === bank?.rowId);
  if (!bankSource) throw new Error('Bank source is missing');
  const bankIndex = input.bankRows.findIndex((row) => canonicalJson(row) === canonicalJson(bankSource.raw));
  const selectedBank = input.bankRows[bankIndex];
  if (!selectedBank) throw new Error('Bank source is missing');
  if (experiment === 'one-paise' || experiment === 'shortfall') {
    const amount = parseMoneyInput(selectedBank.amount);
    const changed = checkedSubtract(amount, paiseFromInteger(experiment === 'one-paise' ? 1 : 500000));
    if (changed < 0) throw new Error('This settlement is too small for this shortfall');
    const nextAmount = typeof selectedBank.amount === 'string' ? `${Math.floor(changed / 100)}.${String(changed % 100).padStart(2, '0')}` : changed;
    return { ...input, bankRows: input.bankRows.map((row, index) => index === bankIndex ? { ...row, amount: nextAmount } : row) };
  }
  if (experiment === 'duplicate-bank') {
    const existingIds = new Set(input.bankRows.map((row) => row.bank_row_ref));
    let copyId = `${String(selectedBank.bank_row_ref)}_challenge`;
    while (existingIds.has(copyId)) copyId += '_copy';
    return { ...input, bankRows: [...input.bankRows, { ...selectedBank, bank_row_ref: copyId, bank_row_id: copyId }] };
  }
  if (experiment === 'missing-books') {
    const ledger = baseline.ledger.find((item) => item.settlementId === settlement.settlementId && item.ledgerStatus === 'VERIFIED');
    const source = baseline.sourceRows.find((row) => row.rowId === ledger?.rowId);
    if (!source) throw new Error('This case has no required merchant row');
    return { ...input, merchantRows: input.merchantRows.filter((row) => canonicalJson(row) !== canonicalJson(source.raw)) };
  }
  return input;
}
