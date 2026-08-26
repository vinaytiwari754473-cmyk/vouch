import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  createHeldoutBundle,
  hashCanonicalJson,
  verifyHeldoutBundleHashes
} from "./hash.js";
import type { HeldoutProvenance } from "./types.js";

const provenance: HeldoutProvenance = {
  datasetId: "sealed-001",
  generatedAtIso: "2026-09-01T00:00:00.000Z",
  evaluationFreezeCommit: "freeze-commit",
  generatorCommit: "generator-commit",
  solverCommit: "solver-commit",
  evaluatorCommit: "evaluator-commit",
  metricsSha256: "a".repeat(64),
  promptSha256: "b".repeat(64),
  modelProvider: "provider",
  modelId: "model-version",
  modelConfigSha256: "c".repeat(64),
  seedCommitmentSha256: "d".repeat(64)
};

describe("held-out hashing", () => {
  it("is stable across object insertion order", () => {
    expect(hashCanonicalJson({ b: 2, a: 1 })).toBe(hashCanonicalJson({ a: 1, b: 2 }));
    expect(canonicalJson({ b: 2, a: [true, null] })).toBe('{"a":[true,null],"b":2}');
  });

  it("binds public inputs, independent truth, and frozen provenance", () => {
    const bundle = createHeldoutBundle({
      publicInputs: { bank: [{ id: "b1", amount: "100" }] },
      truthManifest: { links: [{ settlementId: "s1", bankRowId: "b1" }] },
      provenance
    });

    expect(verifyHeldoutBundleHashes(bundle)).toBe(true);
    expect(
      verifyHeldoutBundleHashes({
        ...bundle,
        truthManifest: { links: [{ settlementId: "s1", bankRowId: "changed" }] }
      })
    ).toBe(false);
  });

  it("rejects values that cannot be represented unambiguously in JSON", () => {
    expect(() => canonicalJson(1n)).toThrow(/bigint/);
    expect(() => canonicalJson({ bad: undefined })).toThrow(/undefined/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/);
  });
});
