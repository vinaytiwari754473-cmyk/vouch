import { describe, expect, it } from "vitest";

import { exactRatio, wilsonUpperBound95 } from "./ratio.js";

describe("exact ratios", () => {
  it("preserves numerator and denominator and uses null for an undefined ratio", () => {
    expect(exactRatio(1, 4)).toEqual({ numerator: 1, denominator: 4, value: 0.25 });
    expect(exactRatio(0, 0)).toEqual({ numerator: 0, denominator: 0, value: null });
  });

  it("rejects invalid count ratios", () => {
    expect(() => exactRatio(2, 1)).toThrow(/cannot exceed/);
    expect(() => exactRatio(-1, 1)).toThrow(/non-negative/);
  });

  it("reports the Wilson 95% upper endpoint for an observed 0/N", () => {
    expect(wilsonUpperBound95(0, 100)).toBeCloseTo(0.0369935, 6);
    expect(wilsonUpperBound95(0, 0)).toBeNull();
  });
});
