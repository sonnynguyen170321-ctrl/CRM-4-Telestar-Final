import { describe, expect, it } from "vitest";

import { isLowQualityPage } from "../reasoning/pageQuality";

const REAL_CONTENT =
  "Acme Robotics builds autonomous warehouse robots for mid-market logistics operators across " +
  "Southeast Asia. Our platform integrates with existing WMS systems and reduces pick times by 40%.";

describe("isLowQualityPage", () => {
  it("keeps a real content page", () => {
    expect(isLowQualityPage({ title: "About Acme", h1: "About us", mainText: REAL_CONTENT })).toBe(false);
  });

  it("drops a soft-404 by its heading (HTTP 200, body over the thin threshold)", () => {
    expect(
      isLowQualityPage({
        title: "Page not found",
        h1: "404 — Page not found",
        mainText:
          "The page you are looking for doesn't exist. It may have been moved or deleted. " +
          "Go back to the homepage to continue browsing our products, pricing, and support resources.",
      })
    ).toBe(true);
  });

  it("drops a soft-404 whose not-found phrasing leads the body", () => {
    expect(
      isLowQualityPage({
        title: "Careers",
        h1: "Careers",
        mainText:
          "Oops! Sorry, we couldn't find the page you requested. Please check the URL and try again, " +
          "or use the navigation above to find what you were looking for on our website.",
      })
    ).toBe(true);
  });

  it("drops a thin nav/footer-only page", () => {
    expect(isLowQualityPage({ title: "Home", h1: null, mainText: "Home Products Pricing Contact" })).toBe(true);
  });

  it("keeps a long article that merely mentions 'not found' in passing", () => {
    const article =
      "Our research team investigated why so many enterprise search queries return not found errors, " +
      "and built a semantic layer that resolves them. " +
      REAL_CONTENT +
      " We now serve hundreds of customers with this approach across the region.";
    expect(isLowQualityPage({ title: "Blog", h1: "Solving not found errors", mainText: article })).toBe(false);
  });
});
