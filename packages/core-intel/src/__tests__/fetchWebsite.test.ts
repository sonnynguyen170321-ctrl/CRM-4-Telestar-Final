import { describe, expect, it } from "vitest";

import {
  extractVisibleText,
  fetchCompanyPages,
  parseRobotsDisallowRules,
  type FetchImpl,
} from "../fetchWebsite";

type RouteResponse =
  | { status: number; body: string }
  | "network_error"
  | "timeout";

function createMockFetch(routes: Record<string, RouteResponse>, defaultBody = ""): FetchImpl {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    const route = routes[path];

    if (route === "network_error") {
      throw new TypeError("network error");
    }

    if (route === "timeout") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }

    const resolved = route ?? { status: 404, body: defaultBody };

    return {
      status: resolved.status,
      url,
      text: async () => resolved.body,
    } as unknown as Response;
  }) as unknown as FetchImpl;
}

const LONG_TEXT = `<html><body><p>${"Example company offers cloud services to enterprises. ".repeat(15)}</p></body></html>`;
const SHORT_TEXT = `<html><body><p>Hi.</p></body></html>`;
const PARKED_TEXT = `<html><body><p>This domain is for sale. Buy this domain today!</p></body></html>`;

describe("fetchCompanyPages", () => {
  it("returns SUCCESS when the homepage is reachable with enough visible text", async () => {
    const result = await fetchCompanyPages({
      canonicalDomain: "example.com",
      fetchImpl: createMockFetch({ "/": { status: 200, body: LONG_TEXT } }),
      rateLimitIntervalMs: 0,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.httpStatus).toBe(200);
    expect(result.pages.some((page) => page.path === "/")).toBe(true);
    expect(result.rawTextHash).toBeTruthy();
    expect(result.contentHash).toBeTruthy();
  });

  it("returns JS_RENDER_REQUIRED when visible text is below the byte threshold", async () => {
    const result = await fetchCompanyPages({
      canonicalDomain: "example.com",
      fetchImpl: createMockFetch({ "/": { status: 200, body: SHORT_TEXT } }),
      rateLimitIntervalMs: 0,
    });

    expect(result.status).toBe("JS_RENDER_REQUIRED");
    expect(result.errorCode).toBe("INSUFFICIENT_VISIBLE_TEXT");
  });

  it("returns OFFLINE when the homepage request fails with a network error", async () => {
    const result = await fetchCompanyPages({
      canonicalDomain: "example.com",
      fetchImpl: createMockFetch({ "/": "network_error" }),
      rateLimitIntervalMs: 0,
    });

    expect(result.status).toBe("OFFLINE");
    expect(result.errorCode).toBe("NETWORK_ERROR");
  });

  it("returns TIMEOUT when the homepage request never resolves before the timeout", async () => {
    const result = await fetchCompanyPages({
      canonicalDomain: "example.com",
      fetchImpl: createMockFetch({ "/": "timeout" }),
      rateLimitIntervalMs: 0,
      timeoutMs: 10,
    });

    expect(result.status).toBe("TIMEOUT");
    expect(result.errorCode).toBe("FETCH_TIMEOUT");
  });

  it("returns BLOCKED when the homepage responds with HTTP 403", async () => {
    const result = await fetchCompanyPages({
      canonicalDomain: "example.com",
      fetchImpl: createMockFetch({ "/": { status: 403, body: "" } }),
      rateLimitIntervalMs: 0,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.errorCode).toBe("HTTP_403");
    expect(result.httpStatus).toBe(403);
  });

  it("returns BLOCKED when robots.txt disallows the homepage", async () => {
    const result = await fetchCompanyPages({
      canonicalDomain: "example.com",
      fetchImpl: createMockFetch({
        "/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n" },
        "/": { status: 200, body: LONG_TEXT },
      }),
      rateLimitIntervalMs: 0,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.errorCode).toBe("ROBOTS_DISALLOWED");
  });

  it("returns PARKED when the homepage matches a parked-domain pattern", async () => {
    const result = await fetchCompanyPages({
      canonicalDomain: "example.com",
      fetchImpl: createMockFetch({ "/": { status: 200, body: PARKED_TEXT } }),
      rateLimitIntervalMs: 0,
    });

    expect(result.status).toBe("PARKED");
    expect(result.pages).toEqual([]);
  });

  it("returns PARTIAL with NO_REACHABLE_PAGES when nothing returns 2xx content", async () => {
    const result = await fetchCompanyPages({
      canonicalDomain: "example.com",
      fetchImpl: createMockFetch({ "/": { status: 500, body: "" } }),
      rateLimitIntervalMs: 0,
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.errorCode).toBe("NO_REACHABLE_PAGES");
  });

  it("requests robots.txt and the homepage at the normalized canonical domain", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = createMockFetch({ "/": { status: 200, body: LONG_TEXT } });

    await fetchCompanyPages({
      canonicalDomain: "example.com",
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        requestedUrls.push(typeof input === "string" ? input : input.toString());
        return fetchImpl(input, init);
      }) as unknown as FetchImpl,
      rateLimitIntervalMs: 0,
    });

    expect(requestedUrls).toContain("https://example.com/robots.txt");
    expect(requestedUrls).toContain("https://example.com/");
    expect(requestedUrls.every((url) => url.startsWith("https://example.com/"))).toBe(true);
  });
});

describe("parseRobotsDisallowRules", () => {
  it("returns the wildcard group's disallow rules", () => {
    const robotsText = "User-agent: *\nDisallow: /admin\nDisallow: /private\n";

    expect(parseRobotsDisallowRules(robotsText, "TeleStarV2EnrichmentBot/1.0")).toEqual([
      "/admin",
      "/private",
    ]);
  });

  it("prefers a group matching the requesting user agent over the wildcard group", () => {
    const robotsText = [
      "User-agent: *",
      "Disallow: /private",
      "",
      "User-agent: TeleStarV2EnrichmentBot",
      "Disallow: /no-bots",
    ].join("\n");

    expect(parseRobotsDisallowRules(robotsText, "TeleStarV2EnrichmentBot/1.0")).toEqual([
      "/no-bots",
    ]);
  });

  it("returns an empty array when there are no matching groups", () => {
    expect(parseRobotsDisallowRules("", "TeleStarV2EnrichmentBot/1.0")).toEqual([]);
  });
});

describe("extractVisibleText", () => {
  it("strips scripts, styles, comments, and tags while decoding entities", () => {
    const html =
      "<html><head><style>.a{color:red}</style><script>var x=1;</script></head>" +
      "<body><!-- comment --><p>Hello&nbsp;&amp;&nbsp;world</p></body></html>";

    expect(extractVisibleText(html)).toBe("Hello & world");
  });
});
