import { canonicalJson, compareCodeUnits } from "./canonical";
import type { ExceptionCode, SourceRow } from "./types";

export interface DuplicateIssue {
  readonly code: ExceptionCode;
  readonly ownerId: string;
  readonly rowIds: readonly SourceRow<unknown>["rowId"][];
  readonly message: string;
  readonly conflicting: boolean;
}

export interface DuplicateResult<T> {
  readonly active: readonly SourceRow<T>[];
  readonly quarantined: readonly SourceRow<T>[];
  readonly issues: readonly DuplicateIssue[];
}

export function quarantineStableDuplicates<T>(
  rows: readonly SourceRow<T>[],
  keyOf: (row: SourceRow<T>) => string,
  code: "DUPLICATE_BANK_ENTRY" | "DUPLICATE_IMPORT",
): DuplicateResult<T> {
  const groups = new Map<string, SourceRow<T>[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const active: SourceRow<T>[] = [];
  const quarantined: SourceRow<T>[] = [];
  const issues: DuplicateIssue[] = [];
  for (const key of [...groups.keys()].sort(compareCodeUnits)) {
    const group = (groups.get(key) ?? []).sort((left, right) =>
      compareCodeUnits(left.rowId, right.rowId),
    );
    if (group.length === 1) {
      const only = group[0];
      if (only !== undefined) active.push(only);
      continue;
    }

    const representations = new Set(group.map((row) => canonicalJson(row.raw)));
    if (representations.size === 1) {
      const first = group[0];
      if (first !== undefined) active.push(first);
      quarantined.push(...group.slice(1));
      issues.push({
        code,
        ownerId: key,
        rowIds: group.map((row) => row.rowId),
        message: `Repeated stable record ${key}; one identical occurrence retained and ${group.length - 1} quarantined`,
        conflicting: false,
      });
    } else {
      quarantined.push(...group);
      issues.push({
        code,
        ownerId: key,
        rowIds: group.map((row) => row.rowId),
        message: `Conflicting rows share stable record identifier ${key}; every occurrence was quarantined`,
        conflicting: true,
      });
    }
  }

  return {
    active: active.sort((left, right) => compareCodeUnits(left.rowId, right.rowId)),
    quarantined: quarantined.sort((left, right) => compareCodeUnits(left.rowId, right.rowId)),
    issues,
  };
}

export function findVisibleBankDuplicates<T extends {
  readonly bankEntryId: string;
  readonly direction: string;
  readonly amount: number;
  readonly currency: string;
  readonly postingDate: string;
  readonly utr: string | null;
  readonly narration: string;
}>(rows: readonly SourceRow<T>[]): readonly DuplicateIssue[] {
  const signatures = new Map<string, SourceRow<T>[]>();
  for (const row of rows) {
    const signature = canonicalJson({
      amount: row.value.amount,
      currency: row.value.currency,
      direction: row.value.direction,
      narration: row.value.narration,
      postingDate: row.value.postingDate,
      utr: row.value.utr,
    });
    const group = signatures.get(signature) ?? [];
    group.push(row);
    signatures.set(signature, group);
  }
  return [...signatures.entries()]
    .filter(([, group]) => group.length > 1)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([, group]) => ({
      code: "DUPLICATE_BANK_ENTRY",
      ownerId: group.map((row) => row.value.bankEntryId).sort(compareCodeUnits).join("|"),
      rowIds: group.map((row) => row.rowId).sort(compareCodeUnits),
      message:
        "Bank lines have identical financial evidence but distinct row references; all remain visible and matching must abstain if they are interchangeable",
      conflicting: false,
    }));
}
