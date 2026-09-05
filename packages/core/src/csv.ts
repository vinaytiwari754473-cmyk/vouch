/** Browser-safe CSV codec shared by the CLI and the source workbench. */
export class CsvError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly records: readonly Readonly<Record<string, string>>[];
}

/** RFC 4180-style parser with CRLF/LF support and strict quote handling. */
export function parseCsv(input: string, label = "CSV"): readonly (readonly string[])[] {
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;
  let line = 1;
  let column = 1;

  const pushField = (): void => {
    row.push(field);
    field = "";
    quoteClosed = false;
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) break;

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
          column += 2;
          continue;
        }
        inQuotes = false;
        quoteClosed = true;
        column += 1;
        continue;
      }
      field += character;
      if (character === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      continue;
    }

    if (quoteClosed && character !== "," && character !== "\r" && character !== "\n") {
      throw new CsvError(`${label}:${line}:${column}: unexpected character after closing quote`);
    }
    if (character === '"') {
      if (field.length !== 0 || quoteClosed) {
        throw new CsvError(`${label}:${line}:${column}: quote inside unquoted field`);
      }
      inQuotes = true;
      column += 1;
      continue;
    }
    if (character === ",") {
      pushField();
      column += 1;
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      pushRow();
      line += 1;
      column = 1;
      continue;
    }
    field += character;
    column += 1;
  }

  if (inQuotes) {
    throw new CsvError(`${label}:${line}:${column}: unterminated quoted field`);
  }
  if (field.length > 0 || row.length > 0 || quoteClosed) {
    pushRow();
  }
  return rows;
}

export function parseCsvObjects(input: string, label = "CSV"): ParsedCsv {
  const rows = parseCsv(input, label);
  const headers = rows[0];
  if (headers === undefined || headers.length === 0 || headers.every((header) => header === "")) {
    throw new CsvError(`${label}: missing header row`);
  }
  const seen = new Set<string>();
  for (const header of headers) {
    if (header.length === 0) {
      throw new CsvError(`${label}: header names cannot be empty`);
    }
    if (seen.has(header)) {
      throw new CsvError(`${label}: duplicate header ${header}`);
    }
    seen.add(header);
  }

  const records = rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new CsvError(
        `${label}: row ${index + 2} has ${values.length} fields; expected ${headers.length}`
      );
    }
    const record: Record<string, string> = Object.create(null) as Record<string, string>;
    headers.forEach((header, columnIndex) => {
      record[header] = values[columnIndex] ?? "";
    });
    return record;
  });

  return { headers: [...headers], records };
}

/** Prefixes spreadsheet formula triggers while retaining the original text as data. */
export function escapeSpreadsheetFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function encodeCsvCell(value: string): string {
  const safe = escapeSpreadsheetFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function stringifyCsv(
  headers: readonly string[],
  records: readonly Readonly<Record<string, string | number | null | undefined>>[]
): string {
  if (headers.length === 0 || new Set(headers).size !== headers.length) {
    throw new CsvError("CSV writer requires non-empty unique headers");
  }
  const lines = [headers.map((header) => encodeCsvCell(header)).join(",")];
  for (const record of records) {
    lines.push(
      headers
        .map((header) => {
          const value = record[header];
          return encodeCsvCell(value === null || value === undefined ? "" : String(value));
        })
        .join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
