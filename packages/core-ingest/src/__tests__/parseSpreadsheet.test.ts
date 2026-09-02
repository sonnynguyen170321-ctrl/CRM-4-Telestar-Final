import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  detectHeaderRowIndex,
  detectSpreadsheet,
  extractSheetToCsv,
  isSpreadsheetFileName,
  SpreadsheetError,
} from "../parseSpreadsheet";

// Build an .xlsx buffer in-memory from arrays-of-arrays per sheet.
function buildWorkbookBuffer(sheets: Record<string, unknown[][]>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, matrix] of Object.entries(sheets)) {
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("isSpreadsheetFileName", () => {
  it("recognizes Excel extensions and rejects others", () => {
    expect(isSpreadsheetFileName("Recap_May.xlsx")).toBe(true);
    expect(isSpreadsheetFileName("data.XLS")).toBe(true);
    expect(isSpreadsheetFileName("leads.csv")).toBe(false);
    expect(isSpreadsheetFileName("notes.txt")).toBe(false);
  });
});

describe("detectHeaderRowIndex", () => {
  it("skips a title row and picks the densest header row", () => {
    const matrix = [
      ["May 20-26 Recap", "", "", ""],
      ["SDR Name", "Company", "Contact", "Channel"],
      ["Brittany Nelson", "Acme Corp", "Jane Smith", "Email"],
    ];
    expect(detectHeaderRowIndex(matrix)).toBe(1);
  });

  it("returns 0 when the first row is already the header", () => {
    const matrix = [
      ["SDR Name", "Company", "Contact"],
      ["Liam Patel", "Initech", "Sarah Connor"],
    ];
    expect(detectHeaderRowIndex(matrix)).toBe(0);
  });
});

describe("detectSpreadsheet", () => {
  it("auto-detects the densest sheet, header row, headers, and preview", () => {
    const buffer = buildWorkbookBuffer({
      Cover: [["Internal cover sheet"]],
      Recap_May: [
        ["May 20-26 2025 Recap", "", "", ""],
        ["SDR Name", "Company", "Contact", "Channel"],
        ["Brittany Nelson", "Acme Corp", "Jane Smith", "Email"],
        ["Liam Patel", "Initech", "Sarah Connor", "Call"],
      ],
    });

    const detection = detectSpreadsheet(buffer);

    expect(detection.selectedSheet).toBe("Recap_May");
    expect(detection.headerRow).toBe(1);
    expect(detection.headers).toEqual(["SDR Name", "Company", "Contact", "Channel"]);
    expect(detection.previewRows[0]).toMatchObject({
      "SDR Name": "Brittany Nelson",
      Company: "Acme Corp",
    });
    expect(detection.sheets.map((s) => s.name)).toContain("Cover");
  });

  it("sanitizes blank + duplicate headers from a messy SDR export instead of failing", () => {
    const buffer = buildWorkbookBuffer({
      Export: [
        ["Stage", "Company", "", "Company", "Email 1", "Email 1"],
        ["Linkedin", "Immoderate", "", "Indonesia", "bryan@x.co", "valid"],
      ],
    });

    const detection = detectSpreadsheet(buffer);

    expect(detection.headers).toEqual([
      "Stage",
      "Company",
      "Column 3",
      "Company (2)",
      "Email 1",
      "Email 1 (2)",
    ]);
    expect(detection.previewRows[0]).toMatchObject({
      Company: "Immoderate",
      "Company (2)": "Indonesia",
      "Email 1": "bryan@x.co",
      "Email 1 (2)": "valid",
    });
  });

  it("respects a preferred sheet when provided", () => {
    const buffer = buildWorkbookBuffer({
      SheetA: [["Company"], ["Acme"]],
      SheetB: [["Company"], ["Globex"], ["Initech"], ["Stark"]],
    });
    expect(detectSpreadsheet(buffer, "SheetA").selectedSheet).toBe("SheetA");
  });
});

describe("extractSheetToCsv", () => {
  it("renders the chosen sheet from the header row, preserving Vietnamese names", () => {
    const buffer = buildWorkbookBuffer({
      Recap: [
        ["Quarterly recap", "", ""],
        ["SDR Name", "Company", "Outcome"],
        ["Nguyễn Văn A", "Công ty TNHH ABC", "Positive Reply"],
        ["Trần Thị B", "CP Đại Việt", "No Reply"],
      ],
    });

    const result = extractSheetToCsv(buffer, { selectedSheet: "Recap", headerRow: 1 });
    const lines = result.csvText.split("\n");

    expect(lines[0]).toBe("SDR Name,Company,Outcome");
    expect(lines[1]).toBe("Nguyễn Văn A,Công ty TNHH ABC,Positive Reply");
    expect(result.headers).toEqual(["SDR Name", "Company", "Outcome"]);
  });

  it("quotes cells containing commas", () => {
    const buffer = buildWorkbookBuffer({
      Recap: [
        ["Company", "Note"],
        ["Acme, Inc", "Called, left voicemail"],
      ],
    });
    const result = extractSheetToCsv(buffer, { selectedSheet: "Recap", headerRow: 0 });
    expect(result.csvText.split("\n")[1]).toBe('"Acme, Inc","Called, left voicemail"');
  });

  it("throws a typed error for a missing sheet", () => {
    const buffer = buildWorkbookBuffer({ Recap: [["Company"], ["Acme"]] });
    expect(() => extractSheetToCsv(buffer, { selectedSheet: "Nope", headerRow: 0 })).toThrow(
      SpreadsheetError
    );
  });
});
