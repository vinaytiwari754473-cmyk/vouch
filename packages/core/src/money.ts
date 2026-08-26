import type { Paise, SignedPaise } from "./types";

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

export class MoneyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

function assertSafeBigInt(value: bigint, label: string): number {
  if (value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT) {
    throw new MoneyError(`${label} exceeds JavaScript's safe-integer range`);
  }
  return Number(value);
}

export function paiseFromInteger(value: unknown, label = "money"): Paise {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < 0
  ) {
    throw new MoneyError(`${label} must be a non-negative safe integer in paise`);
  }
  return value as Paise;
}

export function signedPaiseFromInteger(value: unknown, label = "money"): SignedPaise {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0)
  ) {
    throw new MoneyError(`${label} must be a safe integer in paise`);
  }
  return value as SignedPaise;
}

const UNGROUPED = /^\d+$/;
const WESTERN_GROUPED = /^[1-9]\d{0,2}(?:,\d{3})+$/;
const INDIAN_GROUPED = /^[1-9]\d?(?:,\d{2})*,\d{3}$/;

export function parseRupeesToPaise(input: string, label = "money"): Paise {
  const value = input.trim();
  if (value.length === 0 || value.startsWith("+") || value.startsWith("-")) {
    throw new MoneyError(`${label} is not a valid non-negative decimal amount`);
  }

  const pieces = value.split(".");
  if (pieces.length > 2) {
    throw new MoneyError(`${label} has malformed decimal precision`);
  }

  const major = pieces[0] ?? "";
  const minor = pieces[1] ?? "";
  if (pieces.length === 2 && minor.length === 0) {
    throw new MoneyError(`${label} has malformed decimal precision`);
  }
  if (
    !(UNGROUPED.test(major) || WESTERN_GROUPED.test(major) || INDIAN_GROUPED.test(major))
  ) {
    throw new MoneyError(`${label} has malformed digit grouping`);
  }
  if (minor.length > 2 || (minor.length > 0 && !/^\d+$/.test(minor))) {
    throw new MoneyError(`${label} has more than two decimal places`);
  }

  const majorDigits = major.replaceAll(",", "");
  const minorDigits = minor.padEnd(2, "0");
  const result = BigInt(majorDigits) * 100n + BigInt(minorDigits || "0");
  return assertSafeBigInt(result, label) as Paise;
}

export function parseMoneyInput(input: unknown, label = "money"): Paise {
  return typeof input === "string"
    ? parseRupeesToPaise(input, label)
    : paiseFromInteger(input, label);
}

export function checkedAdd(
  left: Paise | SignedPaise,
  right: Paise | SignedPaise,
  label = "money sum",
): SignedPaise {
  return assertSafeBigInt(BigInt(left) + BigInt(right), label) as SignedPaise;
}

export function checkedSubtract(
  left: Paise | SignedPaise,
  right: Paise | SignedPaise,
  label = "money difference",
): SignedPaise {
  return assertSafeBigInt(BigInt(left) - BigInt(right), label) as SignedPaise;
}

export function checkedNonNegative(
  value: Paise | SignedPaise,
  label = "money",
): Paise {
  if (value < 0) {
    throw new MoneyError(`${label} cannot be negative`);
  }
  return value as number as Paise;
}

export function checkedSum(
  values: readonly (Paise | SignedPaise)[],
  label = "money sum",
): SignedPaise {
  let total = 0n;
  for (const value of values) {
    total += BigInt(value);
    if (total > MAX_SAFE_BIGINT || total < MIN_SAFE_BIGINT) {
      throw new MoneyError(`${label} exceeds JavaScript's safe-integer range`);
    }
  }
  return Number(total) as SignedPaise;
}

export function formatPaise(value: Paise | SignedPaise): string {
  const raw = BigInt(value);
  const sign = raw < 0n ? "-" : "";
  const absolute = raw < 0n ? -raw : raw;
  const rupees = absolute / 100n;
  const paise = String(absolute % 100n).padStart(2, "0");
  return `${sign}₹${rupees.toString()}.${paise}`;
}
