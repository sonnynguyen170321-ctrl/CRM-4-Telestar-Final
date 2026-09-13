import { buildFetchUrl } from "./canonicalDomain";
import { extractVisibleText } from "./fetchWebsite";
import type { FetchedPage } from "./extractFacts";

export const DEFAULT_PLAYWRIGHT_TIMEOUT_MS = 10_000;

export type PlaywrightFallbackResult =
  | { ok: true; pages: FetchedPage[] }
  | {
      ok: false;
      reason: "DISABLED" | "UNAVAILABLE" | "TIMEOUT" | "ERROR";
      errorMessage?: string;
    };

export type PlaywrightRenderer = (
  url: string,
  timeoutMs: number
) => Promise<{ html: string }>;

export type RunPlaywrightFallbackInput = {
  canonicalDomain: string;
  path?: string;
  timeoutMs?: number;
  isEnabled?: () => boolean;
  renderer?: PlaywrightRenderer;
};

/**
 * Playwright fallback is only invoked when the initial fetch returns
 * JS_RENDER_REQUIRED. It is env-gated and OFF by default; if disabled or
 * unavailable, callers must degrade to JS_RENDER_REQUIRED/PARTIAL rather than
 * failing the whole enrichment job.
 */
export function isPlaywrightFallbackEnabled(): boolean {
  return process.env.V2_ENRICHMENT_PLAYWRIGHT_ENABLED === "true";
}

export async function runPlaywrightFallback(
  input: RunPlaywrightFallbackInput
): Promise<PlaywrightFallbackResult> {
  const isEnabled = input.isEnabled ?? isPlaywrightFallbackEnabled;

  if (!isEnabled()) {
    return { ok: false, reason: "DISABLED" };
  }

  const renderer = input.renderer ?? defaultPlaywrightRenderer;
  const timeoutMs = input.timeoutMs ?? DEFAULT_PLAYWRIGHT_TIMEOUT_MS;
  const path = input.path ?? "/";
  const url = buildFetchUrl(input.canonicalDomain, path);

  try {
    const result = await withTimeout(renderer(url, timeoutMs), timeoutMs);

    return {
      ok: true,
      pages: [{ url, path, text: extractVisibleText(result.html) }],
    };
  } catch (error) {
    if (error instanceof Error && error.message === "PLAYWRIGHT_UNAVAILABLE") {
      return { ok: false, reason: "UNAVAILABLE" };
    }

    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, reason: "TIMEOUT" };
    }

    return {
      ok: false,
      reason: "ERROR",
      errorMessage: error instanceof Error ? error.message : "Unknown Playwright error.",
    };
  }
}

async function defaultPlaywrightRenderer(
  url: string,
  timeoutMs: number
): Promise<{ html: string }> {
  let playwrightModule: PlaywrightModule;

  try {
    const optionalImport = new Function(
      "specifier",
      "return import(specifier)"
    ) as (specifier: string) => Promise<unknown>;
    playwrightModule = (await optionalImport("playwright")) as PlaywrightModule;
  } catch {
    throw new Error("PLAYWRIGHT_UNAVAILABLE");
  }

  const browser = await playwrightModule.chromium.launch();

  try {
    const page = await browser.newPage();
    await page.goto(url, { timeout: timeoutMs });
    const html = await page.content();
    return { html };
  } finally {
    await browser.close();
  }
}

type PlaywrightBrowser = {
  newPage: () => Promise<{
    goto: (url: string, options: { timeout: number }) => Promise<unknown>;
    content: () => Promise<string>;
  }>;
  close: () => Promise<void>;
};

type PlaywrightModule = {
  chromium: {
    launch: () => Promise<PlaywrightBrowser>;
  };
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("Playwright fallback timed out.");
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
