import { describe, expect, it } from "vitest";

import {
  CsvError,
  escapeSpreadsheetFormula,
  parseCsv,
  parseCsvObjects,
  stringifyCsv
} from "./csv.js";

describe("CSV boundary", () => {
  it("parses BOM, CRLF, escaped quotes, commas, and physical newlines", () => {
    const parsed = parseCsv('\uFEFFid,narration\r\n1,"credit, ref ""A""\ncontinued"\r\n');

    expect(parsed).toEqual([
      ["id", "narration"],
      ["1", 'credit, ref "A"\ncontinued']
    ]);
  });

  it("rejects malformed quoting and duplicate headers", () => {
    expect(() => parseCsv('id\n"open', "bank.csv")).toThrow(/unterminated quoted field/);
    expect(() => parseCsvObjects("id,id\r\n1,2\r\n")).toThrow(CsvError);
  });

  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "\tformula", "\rformula"])(
    "neutralises spreadsheet formula trigger %j",
    (value) => expect(escapeSpreadsheetFormula(value)).toBe(`'${value}`)
  );

  it("writes RFC 4180 CRLF with formula-safe cells", () => {
    const output = stringifyCsv(
      ["id", "note"],
      [{ id: "=HYPERLINK(\"https://bad.invalid\")", note: "two, words" }]
    );

    expect(output).toBe(
      'id,note\r\n"\'=HYPERLINK(""https://bad.invalid"")","two, words"\r\n'
    );
  });
});
