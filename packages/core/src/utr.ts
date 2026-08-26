import { compareCodeUnits } from "./canonical";
import type { CandidateEvidence } from "./types";

export function exactUtrKey(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length === 0 ? null : normalized;
}

function removeAsciiSpace(value: string): string {
  return value.replace(/[\t\n\r ]+/g, "");
}

function compact(value: string): string {
  return value.toUpperCase().replace(/[\t\n\r /:\-]+/g, "");
}

function stripPrefix(value: string, prefixes: readonly string[]): string {
  const upper = value.trim().toUpperCase();
  for (const prefix of [...prefixes].sort(compareCodeUnits)) {
    const candidate = prefix.trim().toUpperCase();
    if (candidate.length === 0) continue;
    const pattern = new RegExp(`^${escapeRegExp(candidate)}[\\t\\n\\r /:\\-]+`);
    if (pattern.test(upper)) return upper.replace(pattern, "");
  }
  return upper;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boundedTruncationMatch(left: string, right: string, minimumLength: number): boolean {
  const a = compact(left);
  const b = compact(right);
  if (a === b || a.length < minimumLength || b.length < minimumLength) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return longer.startsWith(shorter) || longer.endsWith(shorter);
}

export interface UtrComparisonConfig {
  readonly knownPrefixes: readonly string[];
  readonly minimumTruncatedLength: number;
}

export function deterministicUtrEvidence(
  settlementUtr: string | null,
  bankUtr: string | null,
  narration: string,
  config: UtrComparisonConfig,
): readonly CandidateEvidence[] {
  if (settlementUtr === null) return [];
  const evidence = new Set<CandidateEvidence>();
  if (bankUtr !== null) {
    if (exactUtrKey(settlementUtr) === exactUtrKey(bankUtr)) evidence.add("EXACT_UTR");
    if (
      removeAsciiSpace(settlementUtr.toUpperCase()) ===
        removeAsciiSpace(bankUtr.toUpperCase()) &&
      exactUtrKey(settlementUtr) !== exactUtrKey(bankUtr)
    ) {
      evidence.add("SPACE_CASE_UTR");
    }
    if (
      stripPrefix(settlementUtr, config.knownPrefixes) ===
        stripPrefix(bankUtr, config.knownPrefixes) &&
      exactUtrKey(settlementUtr) !== exactUtrKey(bankUtr)
    ) {
      evidence.add("PREFIX_STRIP");
    }
    if (boundedTruncationMatch(settlementUtr, bankUtr, config.minimumTruncatedLength)) {
      evidence.add("TRUNCATED_UTR");
    }
  }

  const compactSettlement = compact(settlementUtr);
  const narrationTokens = narration
    .toUpperCase()
    .split(/[^A-Z0-9]+/g)
    .filter((token) => token.length >= config.minimumTruncatedLength);
  if (
    compactSettlement.length >= config.minimumTruncatedLength &&
    narrationTokens.includes(compactSettlement)
  ) {
    evidence.add("NARRATION_TOKEN");
  }
  return [...evidence].sort(compareCodeUnits);
}

export function literalSpanMatchesUtr(
  literal: string,
  settlementUtr: string,
  config: UtrComparisonConfig,
): boolean {
  const compactLiteral = compact(literal);
  const compactSettlement = compact(settlementUtr);
  if (
    compactLiteral.length >= config.minimumTruncatedLength &&
    compactLiteral === compactSettlement
  ) {
    return true;
  }
  const evidence = deterministicUtrEvidence(settlementUtr, literal, literal, config);
  return evidence.length > 0;
}
