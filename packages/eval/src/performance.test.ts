import { describe, expect, it } from "vitest";

import { createPerformanceEnvelope } from "./performance.js";

describe("performance envelope", () => {
  it("keeps volatile measurements outside the canonical decision artifact", () => {
    const envelope = createPerformanceEnvelope({
      canonicalArtifactSha256: "a".repeat(64),
      recordedAtIso: "2026-09-01T00:00:00.000Z",
      environment: {
        label: "evaluation laptop",
        nodeVersion: "22.13.0",
        platform: "win32",
        architecture: "x64"
      },
      warmupRuns: 5,
      rowCount: 600,
      runtimesMs: [12, 10, 14, 11]
    });

    expect(envelope.measuredRuns).toBe(4);
    expect(envelope.medianRuntimeMs).toBe(11.5);
    expect(envelope.p95RuntimeMs).toBe(14);
    expect(envelope.medianRowsPerSecond).toBeCloseTo(52_173.913, 3);
  });

  it("rejects empty or non-positive runtime samples", () => {
    const base = {
      canonicalArtifactSha256: "a".repeat(64),
      recordedAtIso: "2026-09-01T00:00:00.000Z",
      environment: {
        label: "test",
        nodeVersion: "22",
        platform: "win32",
        architecture: "x64"
      },
      warmupRuns: 0,
      rowCount: 1
    };

    expect(() => createPerformanceEnvelope({ ...base, runtimesMs: [] })).toThrow(/at least one/);
    expect(() => createPerformanceEnvelope({ ...base, runtimesMs: [0] })).toThrow(/positive/);
  });
});
