import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalArtifactJson, canonicalJson, validateRunArtifactJson } from '@vouch/core';
import { describe, expect, it } from 'vitest';
import { browserConfig, executeBrowserRun, experimentInput, inputFromArtifact, parseSourceFiles, assertBrowserLimits } from './source-workbench';
import { validateAndProjectArtifact } from './artifact-data';

const demo = validateRunArtifactJson(readFileSync(resolve('apps/web/public/data/demo-run.json'), 'utf8'));
const input = inputFromArtifact(demo);
const baseline = executeBrowserRun({ input, config: browserConfig(demo) });
const target = baseline.settlements.find((item) => item.overallStatus === 'EXACT_MATCH' && (item.equation?.actualPaise ?? 0) >= 500000);
if (!target) throw new Error('No proved fixture large enough for the experiment');
const targetId = target.settlementId;

describe('source-to-proof browser workflow', () => {
  it('recalculates the deterministic result without replaying the stored AI answer', () => {
    expect(demo.summary.assistedMatches).toBe(1);
    expect(baseline.summary.exactMatches).toBe(9);
    expect(baseline.summary.assistedMatches).toBe(0);
    expect(baseline.hypotheses).toHaveLength(0);
    expect(baseline.config.aiMode).toBe('off');
    expect(validateAndProjectArtifact(canonicalArtifactJson(baseline)).isSealedDemo).toBe(false);
  });
  it.each([['one-paise', -1], ['shortfall', -500000]] as const)('recomputes %s from modified bank source rows', (experiment, residual) => {
    const snapshot = canonicalArtifactJson(baseline);
    const changed = experimentInput(baseline, targetId, experiment);
    const result = executeBrowserRun({ input: changed, config: browserConfig(baseline) });
    const settlement = result.settlements.find((item) => item.settlementId === targetId);
    expect(settlement?.equation?.residualPaise).toBe(residual);
    expect(settlement?.overallStatus).not.toBe('EXACT_MATCH');
    expect(result.summary.exactMatches).toBe(baseline.summary.exactMatches - 1);
    expect(result.summary.complete).toBe(true);
    expect(result.artifactId).not.toBe(baseline.artifactId);
    expect(canonicalArtifactJson(baseline)).toBe(snapshot);
    expect(validateRunArtifactJson(canonicalArtifactJson(result))).toEqual(result);
  });
  it('keeps a missing ledger row open despite exactly matching bank cash', () => {
    const changed = experimentInput(baseline, targetId, 'missing-books');
    const result = executeBrowserRun({ input: changed, config: browserConfig(baseline) });
    const settlement = result.settlements.find((item) => item.settlementId === targetId);
    expect(settlement?.bankStatus).toBe('EXACT_UTR_MATCH');
    expect(settlement?.ledgerStatus).toBe('MISSING_MERCHANT_RECORD');
    expect(settlement?.overallStatus).not.toBe('EXACT_MATCH');
    expect(result.summary.inputRows).toBe(baseline.summary.inputRows - 1);
    expect(validateRunArtifactJson(canonicalArtifactJson(result))).toEqual(result);
  });
  it('abstains when a distinct bank credit has the same reference and amount', () => {
    const result = executeBrowserRun({ input: experimentInput(baseline, targetId, 'duplicate-bank'), config: browserConfig(baseline) });
    expect(result.settlements.find((item) => item.settlementId === targetId)?.overallStatus).toBe('AMBIGUOUS');
    expect(validateRunArtifactJson(canonicalArtifactJson(result))).toEqual(result);
  });
  it('restores exactly the same artifact from unchanged original inputs', () => {
    const result = executeBrowserRun({ input: experimentInput(baseline, targetId, 'unchanged'), config: browserConfig(baseline) });
    expect(canonicalArtifactJson(result)).toBe(canonicalArtifactJson(baseline));
    expect(canonicalJson(input)).toBe(canonicalJson(inputFromArtifact(demo)));
  });
  it('ingests the documented three public source files and forces AI off', () => {
    const read = (name: string) => readFileSync(resolve('data/dev/public', name), 'utf8');
    const source = parseSourceFiles({ recon: read('razorpay-recon.json'), bank: read('bank-statement.csv'), merchant: read('merchant-ledger.csv') });
    const result = executeBrowserRun({ input: source, config: { ...browserConfig(), mode: 'hybrid', aiMode: 'replay' } });
    expect(result.summary.exactMatches).toBe(9);
    expect(result.summary.complete).toBe(true);
    expect(result.config.aiMode).toBe('off');
  });
  it('rejects malformed file structures and enforces browser limits', () => {
    expect(() => parseSourceFiles({ recon: '{}', bank: '', merchant: '' })).toThrow(/items/);
    expect(() => parseSourceFiles({ recon: '{"items":[]}', bank: 'amount,amount\n1,1', merchant: '' })).toThrow(/duplicate header/);
    expect(() => assertBrowserLimits({ reconRows: [], bankRows: Array.from({ length: 5001 }, () => ({})), merchantRows: [] })).toThrow(/5,000/);
  });
});
