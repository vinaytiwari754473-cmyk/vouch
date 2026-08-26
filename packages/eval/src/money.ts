import type { PaiseValue } from "./types.js";

const CANONICAL_INTEGER = /^(?:0|-[1-9]\d*|[1-9]\d*)$/;

/** Convert an already-denominated integer paise value without rounding or coercion. */
export function toPaiseBigInt(value: PaiseValue, label = "paise"): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${label} must be a safe integer`);
    }
    return BigInt(value);
  }

  if (!CANONICAL_INTEGER.test(value) || value === "-0") {
    throw new TypeError(`${label} must be a canonical integer paise string`);
  }

  return BigInt(value);
}

export function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function requireNonNegativePaise(value: PaiseValue, label: string): bigint {
  const parsed = toPaiseBigInt(value, label);
  if (parsed < 0n) {
    throw new RangeError(`${label} must be non-negative`);
  }
  return parsed;
}
