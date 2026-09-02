import { describe, expect, it } from "vitest";

import { qualitativeSizeToBand } from "../dictionaries/sizeBands";
import { normalizeSize } from "../normalize/normalizeSize";

// Uploaded / LinkedIn size cells are numeric ranges ("5,001 - 10,000 employees"), which the
// qualitative parser did not understand — so a company whose only size signal was the uploaded range
// scored size_unknown. Parsing the range's lower bound feeds the size dimension (F4 qualification
// unlock). Word aliases must keep working.

describe("qualitativeSizeToBand — numeric ranges", () => {
  it("resolves LinkedIn-style ranges via the lower bound", () => {
    expect(qualitativeSizeToBand("11 - 50 employees")).toBe("SMALL");
    expect(qualitativeSizeToBand("51 - 200 employees")).toBe("MEDIUM");
    expect(qualitativeSizeToBand("201 - 500 employees")).toBe("MID_MARKET");
    expect(qualitativeSizeToBand("501 - 1,000 employees")).toBe("MID_MARKET");
    expect(qualitativeSizeToBand("1,001 - 5,000 employees")).toBe("ENTERPRISE");
    expect(qualitativeSizeToBand("5,001 - 10,000 employees")).toBe("LARGE_ENTERPRISE");
    expect(qualitativeSizeToBand("10,001+ employees")).toBe("LARGE_ENTERPRISE");
  });

  it("still resolves prose sizes and rejects noise", () => {
    expect(qualitativeSizeToBand("small business")).toBe("SMALL");
    expect(qualitativeSizeToBand("enterprise")).toBe("ENTERPRISE");
    expect(qualitativeSizeToBand("")).toBeNull();
    expect(qualitativeSizeToBand("no idea")).toBeNull();
  });

  it("normalizeSize turns an uploaded range into a known band", () => {
    const r = normalizeSize(null, "5,001 - 10,000 employees");
    expect(r.sizeKnown).toBe(true);
    expect(r.sizeBand).toBe("LARGE_ENTERPRISE");
  });
});
