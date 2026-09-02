import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_MAX_CRAWL_PAGES, PRIORITY_PATHS, maxCrawlPages } from "../fetchWebsite";

const original = process.env.COMPANY_INTEL_MAX_CRAWL_PAGES;
afterEach(() => {
  if (original === undefined) delete process.env.COMPANY_INTEL_MAX_CRAWL_PAGES;
  else process.env.COMPANY_INTEL_MAX_CRAWL_PAGES = original;
});

describe("maxCrawlPages — env-tunable crawl cap", () => {
  it("defaults to DEFAULT_MAX_CRAWL_PAGES when unset", () => {
    delete process.env.COMPANY_INTEL_MAX_CRAWL_PAGES;
    expect(maxCrawlPages()).toBe(DEFAULT_MAX_CRAWL_PAGES);
  });

  it("honors a valid override", () => {
    process.env.COMPANY_INTEL_MAX_CRAWL_PAGES = "3";
    expect(maxCrawlPages()).toBe(3);
  });

  it("clamps to the number of priority paths", () => {
    process.env.COMPANY_INTEL_MAX_CRAWL_PAGES = "999";
    expect(maxCrawlPages()).toBe(PRIORITY_PATHS.length);
  });

  it("falls back to the default on garbage / <1", () => {
    process.env.COMPANY_INTEL_MAX_CRAWL_PAGES = "0";
    expect(maxCrawlPages()).toBe(DEFAULT_MAX_CRAWL_PAGES);
    process.env.COMPANY_INTEL_MAX_CRAWL_PAGES = "abc";
    expect(maxCrawlPages()).toBe(DEFAULT_MAX_CRAWL_PAGES);
  });
});
