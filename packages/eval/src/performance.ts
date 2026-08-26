import type { PerformanceEnvelope, PerformanceEnvironment } from "./types.js";

export function createPerformanceEnvelope(input: {
  readonly canonicalArtifactSha256: string;
  readonly recordedAtIso: string;
  readonly environment: PerformanceEnvironment;
  readonly warmupRuns: number;
  readonly rowCount: number;
  readonly runtimesMs: readonly number[];
}): PerformanceEnvelope {
  requireNonNegativeInteger(input.warmupRuns, "warmupRuns");
  requireNonNegativeInteger(input.rowCount, "rowCount");
  if (input.runtimesMs.length === 0) {
    throw new RangeError("at least one measured runtime is required");
  }
  for (const runtime of input.runtimesMs) {
    if (!Number.isFinite(runtime) || runtime <= 0) {
      throw new RangeError("every runtime must be a positive finite number");
    }
  }

  const sorted = [...input.runtimesMs].sort((left, right) => left - right);
  const medianRuntimeMs = median(sorted);
  const p95RuntimeMs = nearestRank(sorted, 0.95);
  const medianRowsPerSecond =
    medianRuntimeMs === 0 ? 0 : (input.rowCount * 1_000) / medianRuntimeMs;

  return {
    schemaVersion: "1",
    canonicalArtifactSha256: input.canonicalArtifactSha256,
    recordedAtIso: input.recordedAtIso,
    environment: input.environment,
    warmupRuns: input.warmupRuns,
    measuredRuns: input.runtimesMs.length,
    rowCount: input.rowCount,
    runtimesMs: [...input.runtimesMs],
    medianRuntimeMs,
    p95RuntimeMs,
    medianRowsPerSecond
  };
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) {
    throw new RangeError("cannot calculate median of an empty sample");
  }
  if (sorted.length % 2 === 1) {
    return upper;
  }
  const lower = sorted[middle - 1];
  if (lower === undefined) {
    throw new RangeError("cannot calculate median of an empty sample");
  }
  return (lower + upper) / 2;
}

function nearestRank(sorted: readonly number[], quantile: number): number {
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  const value = sorted[index];
  if (value === undefined) {
    throw new RangeError("cannot calculate a quantile of an empty sample");
  }
  return value;
}

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}
