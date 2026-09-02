import { describe, expect, it } from "vitest";

import { normalizePhoneIdentifier, countryNameToIso } from "../phone";
import { splitPersonName, isVietnameseSurnameFirst } from "../personName";

describe("normalizePhoneIdentifier", () => {
  it("normalizes bare national numbers with the default country", () => {
    expect(normalizePhoneIdentifier("2838154064", "VN").e164).toBe("+842838154064");
    expect(normalizePhoneIdentifier("0948200638", "VN").e164).toBe("+84948200638");
  });

  it("dedupes: the same number in two formats collapses to one E.164", () => {
    const a = normalizePhoneIdentifier("84948200638", "VN").e164;
    const b = normalizePhoneIdentifier("0948200638", "VN").e164;
    expect(a).toBe(b);
    expect(a).toBe("+84948200638");
  });

  it("recovers a foreign number lacking '+' via the country-code fallback", () => {
    expect(normalizePhoneIdentifier("6493749000", "VN").e164).toBe("+6493749000"); // NZ pasted in a VN sheet
    expect(normalizePhoneIdentifier("310337133333", "NL").e164).toBe("+31337133333");
  });

  it("marks genuinely malformed numbers invalid instead of faking validity", () => {
    expect(normalizePhoneIdentifier("842862964938200", "VN")).toEqual({ e164: null, isValid: false });
    expect(normalizePhoneIdentifier("not a phone", "VN")).toEqual({ e164: null, isValid: false });
    expect(normalizePhoneIdentifier("", "VN")).toEqual({ e164: null, isValid: false });
  });
});

describe("countryNameToIso", () => {
  it("maps upload country names to ISO codes", () => {
    expect(countryNameToIso("Vietnam")).toBe("VN");
    expect(countryNameToIso("viet nam")).toBe("VN");
    expect(countryNameToIso("Netherlands")).toBe("NL");
    expect(countryNameToIso("United States")).toBe("US");
  });
  it("passes through a 2-letter code and returns null for unknowns", () => {
    expect(countryNameToIso("vn")).toBe("VN");
    expect(countryNameToIso("Atlantis")).toBeNull();
    expect(countryNameToIso("")).toBeNull();
  });
});

describe("splitPersonName", () => {
  it("keeps Western order", () => {
    expect(splitPersonName("Anna Tran")).toEqual({ firstName: "Anna", lastName: "Tran" });
    expect(splitPersonName("John Michael Smith")).toEqual({ firstName: "John", lastName: "Michael Smith" });
  });

  it("respects Vietnamese Surname-first order (Inv 11)", () => {
    // family = leading token, given = trailing token
    expect(splitPersonName("Nguyễn Văn Minh")).toEqual({ firstName: "Minh", lastName: "Nguyễn" });
    expect(splitPersonName("Trần Thị Hương")).toEqual({ firstName: "Hương", lastName: "Trần" });
  });

  it("handles single tokens and empties", () => {
    expect(splitPersonName("Madonna")).toEqual({ firstName: "Madonna", lastName: null });
    expect(splitPersonName("  ")).toEqual({ firstName: null, lastName: null });
  });

  it("detects Vietnamese surname-first names", () => {
    expect(isVietnameseSurnameFirst("Nguyễn Văn Minh")).toBe(true);
    expect(isVietnameseSurnameFirst("Anna Tran")).toBe(false); // "Anna" is not a VN surname → Western
  });
});
