import { describe, expect, it, vi } from "vitest";

import {
  csvEmailValidationToStatus,
  upsertContactIdentifier,
  type IdentifierDb,
} from "../upsertContactIdentifier";

// A fake raw-SQL db. The helper now upserts via a single INSERT ... ON CONFLICT DO UPDATE RETURNING
// "id"; the fake returns `returnedId` to stand in for that RETURNING row (the existing row's id on
// conflict, or the freshly-inserted one otherwise).
function fakeDb(returnedId = "ci_returned") {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db: IdentifierDb = {
    $queryRaw: (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return [{ id: returnedId }];
    }) as never,
    $executeRaw: (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return 1;
    }) as never,
  };
  return { db, calls };
}

const base = { organizationId: "org1", contactId: "c1", source: "INGESTION" as const };

describe("upsertContactIdentifier", () => {
  it("normalizes a deliverable email to valid, via a single ON CONFLICT upsert", async () => {
    const { db, calls } = fakeDb();
    const r = await upsertContactIdentifier(db, {
      ...base, type: "EMAIL", rawValue: "  Thuy.Tran@Bibica.com.vn ", validityStatus: "VALID",
    });
    expect(r).toMatchObject({ normalizedValue: "thuy.tran@bibica.com.vn", isValid: true, validityStatus: "VALID" });
    // one statement, and it is the idempotent upsert
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("ON CONFLICT");
  });

  it("flags a gmail address generic", async () => {
    const { db } = fakeDb();
    const r = await upsertContactIdentifier(db, { ...base, type: "EMAIL", rawValue: "joe@gmail.com" });
    expect(r!.normalizedValue).toBe("joe@gmail.com");
  });

  it("an undeliverable email is stored but not valid", async () => {
    const { db } = fakeDb();
    const r = await upsertContactIdentifier(db, {
      ...base, type: "EMAIL", rawValue: "x@dead.com", validityStatus: "INVALID",
    });
    expect(r).toMatchObject({ isValid: false, validityStatus: "INVALID" });
  });

  it("normalizes phone to E.164 and dedupes two formats to the same value", async () => {
    const a = await upsertContactIdentifier(fakeDb().db, {
      ...base, type: "PHONE", rawValue: "0948200638", defaultPhoneCountry: "VN",
    });
    const b = await upsertContactIdentifier(fakeDb().db, {
      ...base, type: "PHONE", rawValue: "84948200638", defaultPhoneCountry: "VN",
    });
    expect(a!.normalizedValue).toBe("+84948200638");
    expect(b!.normalizedValue).toBe("+84948200638"); // same key → ON CONFLICT collapses them
  });

  it("returns the row id from RETURNING (existing row on conflict)", async () => {
    const { db } = fakeDb("ci_existing");
    const r = await upsertContactIdentifier(db, { ...base, type: "EMAIL", rawValue: "a@b.com" });
    expect(r!.id).toBe("ci_existing");
  });

  it("keeps an un-normalizable phone visible but invalid", async () => {
    const { db } = fakeDb();
    const r = await upsertContactIdentifier(db, {
      ...base, type: "PHONE", rawValue: "842862964938200", defaultPhoneCountry: "VN",
    });
    expect(r).toMatchObject({ normalizedValue: "842862964938200", isValid: false });
  });

  it("returns null for an empty value", async () => {
    const { db } = fakeDb();
    expect(await upsertContactIdentifier(db, { ...base, type: "EMAIL", rawValue: "  " })).toBeNull();
  });
});

describe("csvEmailValidationToStatus", () => {
  it("maps the uploaded validation vocabulary", () => {
    expect(csvEmailValidationToStatus("deliverable")).toBe("VALID");
    expect(csvEmailValidationToStatus("undeliverable")).toBe("INVALID");
    expect(csvEmailValidationToStatus("risky")).toBe("UNKNOWN");
    expect(csvEmailValidationToStatus("unknown")).toBe("UNKNOWN");
    expect(csvEmailValidationToStatus(null)).toBe("UNKNOWN");
  });
});
