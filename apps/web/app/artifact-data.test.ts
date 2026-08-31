import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJson, sha256Hex } from '@vouch/core';
import { describe, expect, it } from 'vitest';
import { SEALED_DEMO_ARTIFACT_ID, validateAndProjectArtifact } from './artifact-data';

const sealedText = readFileSync(resolve('apps/web/public/data/demo-run.json'), 'utf8');

function rehashArtifact<T extends { artifactId: string }>(artifact: T): T {
  const body = Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== 'artifactId'));
  return { ...body, artifactId: `run_${sha256Hex(canonicalJson(body)).slice(0, 24)}` } as T;
}

describe('artifact-driven Evidence Desk', () => {
  it('projects every recorded settlement from the sealed artifact', () => {
    const projected = validateAndProjectArtifact(sealedText);

    expect(projected.artifact.artifactId).toBe(SEALED_DEMO_ARTIFACT_ID);
    expect(projected.batch.artifactSha256).toBe('8542b4dbc303e34ea267f4be581091c8e4b4227182c3d367631695548de61931');
    expect(projected.cases).toHaveLength(24);
    expect(projected.cases.filter((item) => item.status === 'PROVED' || item.status === 'ASSISTED')).toHaveLength(10);
    expect(projected.cases.filter((item) => item.reviewStatus === 'OPEN')).toHaveLength(14);
    expect(projected.batch.exceptionRecords).toBe(25);
    expect(projected.cases.some((item) => item.id === 'setl_W4Z81QK27')).toBe(false);
  });

  it('keeps the important recorded cases exact and unembellished', () => {
    const projected = validateAndProjectArtifact(sealedText);
    const byId = new Map(projected.cases.map((item) => [item.id, item]));

    const short = byId.get('setl_hr5zo1vtwfkt8e');
    expect(short?.status).toBe('DISCREPANCY');
    expect((short?.actualPaise ?? 0) - (short?.expectedPaise ?? 0)).toBe(-50);
    expect(short?.exceptionCodes).toContain('SHORT_CREDIT');

    const assisted = byId.get('setl_py9hern3hehi91');
    expect(assisted?.status).toBe('ASSISTED');
    expect(assisted?.aiNote?.verdict).toBe('VERIFIED');
    expect(assisted?.aiNote?.tests.some((test) => test.startsWith('PASS · LITERAL_SPAN'))).toBe(true);

    const ambiguous = byId.get('setl_7htrgwjj4mavxy');
    expect(ambiguous?.status).toBe('AMBIGUOUS');
    expect(ambiguous?.candidates).toHaveLength(2);

    const booksMissing = byId.get('setl_3ydj1b58mz7vv9');
    expect(booksMissing?.bankStatus).toBe('EXACT');
    expect(booksMissing?.ledgerStatus).toBe('MISSING');
    expect(booksMissing?.status).toBe('REVIEW');
  });

  it('rejects a changed artifact identity', () => {
    const artifact = JSON.parse(sealedText) as { artifactId: string };
    artifact.artifactId = `run_${'0'.repeat(24)}`;
    expect(() => validateAndProjectArtifact(JSON.stringify(artifact))).toThrow(/artifactId/);
  });

  it('rejects a rehashed artifact with a false summary', () => {
    const artifact = JSON.parse(sealedText) as {
      artifactId: string;
      summary: { exactMatches: number };
    };
    artifact.summary.exactMatches += 1;
    expect(() => validateAndProjectArtifact(JSON.stringify(rehashArtifact(artifact)))).toThrow(/summary\.exactMatches/);
  });

  it('rejects rehashed source and reference tampering', () => {
    const sourceTamper = JSON.parse(sealedText) as {
      artifactId: string;
      sourceRows: { raw: Record<string, unknown> }[];
    };
    sourceTamper.sourceRows[0].raw.tampered = true;
    expect(() => validateAndProjectArtifact(JSON.stringify(rehashArtifact(sourceTamper)))).toThrow(/contentHash/);

    const referenceTamper = JSON.parse(sealedText) as {
      artifactId: string;
      settlements: { reconRowIds: string[] }[];
    };
    referenceTamper.settlements[0].reconRowIds[0] = `razorpay_${'0'.repeat(64)}_0`;
    expect(() => validateAndProjectArtifact(JSON.stringify(rehashArtifact(referenceTamper)))).toThrow(/unknown identifier/);
  });

  it('rejects a rehashed one-paise automatic proof', () => {
    const artifact = JSON.parse(sealedText) as {
      artifactId: string;
      settlements: {
        overallStatus: string;
        equation: { actualPaise: number; residualPaise: number } | null;
      }[];
    };
    const accepted = artifact.settlements.find((item) => item.overallStatus === 'EXACT_MATCH');
    if (accepted?.equation === null || accepted?.equation === undefined) throw new Error('sealed fixture has no accepted equation');
    accepted.equation.actualPaise += 1;
    accepted.equation.residualPaise = 1;
    expect(() => validateAndProjectArtifact(JSON.stringify(rehashArtifact(artifact)))).toThrow(/acceptedResidualPaise|zero-residual invariant/);
  });
});
