import type { JsonValue } from "./types";

export class CanonicalJsonError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new CanonicalJsonError(`${path} contains a non-canonical number`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => serialize(item, `${path}[${index}]`)).join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError(`${path} is not a plain JSON object`);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareCodeUnits);
    const fields = keys.map((key) => {
      const child = record[key];
      if (child === undefined) {
        throw new CanonicalJsonError(`${path}.${key} is undefined`);
      }
      return `${JSON.stringify(key)}:${serialize(child, `${path}.${key}`)}`;
    });
    return `{${fields.join(",")}}`;
  }
  throw new CanonicalJsonError(`${path} contains unsupported JSON value ${typeof value}`);
}

export function canonicalJson(value: JsonValue | unknown): string {
  return serialize(value, "$");
}
