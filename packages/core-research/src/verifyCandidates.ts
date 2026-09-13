import "server-only";

import { safeFetch } from "@telestar/core-search/safeFetch";
import type { ParsedCandidate } from "./parseDiscoveryResults";

// Liveness gate. The SERP harvester happily returns dead/404/parked domains; before we persist a
// company candidate we do a cheap HEAD/GET probe (SSRF-safe via safeFetch) and drop anything that
// is unreachable (DNS fail / network error / timeout) or returns HTTP >= 400. Bounded concurrency,
// per-run cache. Contacts (LinkedIn) are never probed. Env `RESEARCH_LIVENESS_CHECK` (default on).

const PROBE_TIMEOUT_MS = 6000;
const PROBE_CONCURRENCY = 6;

export function isLivenessEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.RESEARCH_LIVENESS_CHECK ?? "1").trim() !== "0";
}

/** True when the domain answered with a non-error status. Any transport failure or HTTP>=400 → dead. */
export async function probeDomain(domain: string): Promise<boolean> {
  const url = `https://${domain}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, { method: "GET", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; TelestarResearchBot/1.0)" } });
    if (!res.ok) return false;
    return res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Keep only company candidates whose domain is live. Contacts pass through untouched. Uses a
 *  shared cache so a domain seen across batches is probed once per run. */
export async function filterLiveCandidates(
  candidates: ParsedCandidate[],
  cache: Map<string, boolean>,
  env: NodeJS.ProcessEnv = process.env
): Promise<ParsedCandidate[]> {
  if (!isLivenessEnabled(env)) return candidates;

  const companies = candidates.filter((c) => c.kind === "COMPANY" && c.domain);
  const domains = Array.from(new Set(companies.map((c) => c.domain!).filter((d) => !cache.has(d))));
  for (let i = 0; i < domains.length; i += PROBE_CONCURRENCY) {
    const slice = domains.slice(i, i + PROBE_CONCURRENCY);
    const results = await Promise.all(slice.map((d) => probeDomain(d)));
    slice.forEach((d, idx) => cache.set(d, results[idx]));
  }

  return candidates.filter((c) => {
    if (c.kind !== "COMPANY" || !c.domain) return true;
    return cache.get(c.domain) !== false;
  });
}
