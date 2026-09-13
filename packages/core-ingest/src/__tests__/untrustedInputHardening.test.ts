import { describe, expect, it } from "vitest";

import { normalizeHeaderName, trimUnderscores } from "../hash";

const BUDGET_MS = 500;
const N = 100_000;

describe("header normalisation stays linear on uploaded headers", () => {
  it("a header that is a long run of punctuation followed by a letter", () => {
    const start = performance.now();
    const out = normalizeHeaderName(`${"-".repeat(N)}a${"-".repeat(N)}`);
    expect(performance.now() - start).toBeLessThan(BUDGET_MS);
    expect(out).toBe("a");
  });

  it("trimUnderscores strips both ends and keeps the middle", () => {
    expect(trimUnderscores("___a_b___")).toBe("a_b");
    expect(trimUnderscores("____")).toBe("");
    expect(trimUnderscores("")).toBe("");
    expect(trimUnderscores("a")).toBe("a");
  });

  it("normalizeHeaderName output is unchanged for ordinary headers", () => {
    expect(normalizeHeaderName("﻿ Company Name ")).toBe("company_name");
    expect(normalizeHeaderName("E-mail (work)")).toBe("e_mail_work");
  });
});
