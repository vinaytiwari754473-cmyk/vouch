export function parseJson(text: string, label: string): unknown {
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown JSON parser error";
    throw new Error(`${label} is not valid JSON: ${detail}`, { cause: error });
  }
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function requireRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a JSON array`);
  return value.map((item, index) => requireRecord(item, `${label}[${index}]`));
}

export function stablePrettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
