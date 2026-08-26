import type { ExactRatio } from "./types.js";

export function exactRatio(numerator: number, denominator: number): ExactRatio {
  requireCount(numerator, "numerator");
  requireCount(denominator, "denominator");
  if (numerator > denominator) {
    throw new RangeError("ratio numerator cannot exceed denominator");
  }

  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator
  };
}

/** Upper endpoint of a two-sided Wilson score interval at 95% confidence. */
export function wilsonUpperBound95(successes: number, trials: number): number | null {
  requireCount(successes, "successes");
  requireCount(trials, "trials");
  if (successes > trials) {
    throw new RangeError("successes cannot exceed trials");
  }
  if (trials === 0) {
    return null;
  }

  const z = 1.959963984540054;
  const zSquared = z * z;
  const observed = successes / trials;
  const denominator = 1 + zSquared / trials;
  const center = observed + zSquared / (2 * trials);
  const spread =
    z * Math.sqrt((observed * (1 - observed)) / trials + zSquared / (4 * trials * trials));

  return Math.min(1, (center + spread) / denominator);
}

function requireCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}
