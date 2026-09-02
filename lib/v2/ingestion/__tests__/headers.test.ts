import { describe, expect, it } from "vitest";

import { sanitizeDisplayHeaders } from "../headers";
import { normalizeHeaderName } from "../hash";

describe("sanitizeDisplayHeaders", () => {
  it("keeps clean, unique headers unchanged", () => {
    expect(sanitizeDisplayHeaders(["SDR Name", "Company", "Outcome"])).toEqual([
      "SDR Name",
      "Company",
      "Outcome",
    ]);
  });

  it("fills blank cells with positional Column names", () => {
    expect(sanitizeDisplayHeaders(["Company", "", "Email", ""])).toEqual([
      "Company",
      "Column 2",
      "Email",
      "Column 4",
    ]);
  });

  it("de-duplicates repeated header names (the many-Company export case)", () => {
    expect(sanitizeDisplayHeaders(["Company", "Company", "Company"])).toEqual([
      "Company",
      "Company (2)",
      "Company (3)",
    ]);
  });

  it("aligns deduped display names with the parser's rawRowJson key dedup", () => {
    // parseCsvRows keys rawRowJson by normalizeHeaderName(header) with the same base+_n
    // dedup. The sanitized display name must normalize to that key so mapping resolves.
    const display = sanitizeDisplayHeaders(["Company", "Company"]);
    expect(normalizeHeaderName(display[1])).toBe("company_2");

    const blank = sanitizeDisplayHeaders(["Company", "", "X"]);
    expect(normalizeHeaderName(blank[1])).toBe("column_2");
  });
});
