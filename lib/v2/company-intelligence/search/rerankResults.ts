import "server-only";

import type { NormalizedSearchResult } from "./types";

// R4: optional local neural rerank — approximate Exa's semantic relevance without a paid API.
// Off by default. Enable with SEARCH_RERANK_ENABLED=true AND install the (heavy, optional) model
// runtime: `npm i @huggingface/transformers`. Deliberately a DYNAMIC import of a string spec so the
// package is NOT a hard dependency: if it's absent or fails, we log once and fall back to the
// provider's original order — the run never fails because of rerank. Deterministic given the model.

const MODEL = process.env.SEARCH_RERANK_MODEL || "Xenova/all-MiniLM-L6-v2";

type Embedder = (text: string | string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

let embedderPromise: Promise<Embedder | null> | null = null;
let warned = false;

export function isRerankEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SEARCH_RERANK_ENABLED ?? "").trim().toLowerCase() === "true";
}

async function loadEmbedder(): Promise<Embedder | null> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      try {
        // Opaque dynamic import so the bundler never tries to resolve the OPTIONAL dep at build
        // time (no "module not found" warning). Server-only; resolves at runtime iff installed.
        const dynamicImport = new Function("s", "return import(s)") as (s: string) => Promise<{ pipeline: (task: string, model: string) => Promise<Embedder> }>;
        const mod = await dynamicImport("@huggingface/transformers");
        return await mod.pipeline("feature-extraction", MODEL);
      } catch (error) {
        if (!warned) {
          warned = true;
          console.warn(`[search] rerank disabled — @huggingface/transformers unavailable (${error instanceof Error ? error.message : "load failed"}).`);
        }
        return null;
      }
    })();
  }
  return embedderPromise;
}

function cosine(a: number[], b: number[]): number {
  // Embeddings are already L2-normalized (normalize: true), so cosine == dot product.
  let dot = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) dot += a[i] * b[i];
  return dot;
}

/**
 * Reorder search results by semantic similarity of (title + snippet) to the query.
 * Best-effort: returns the input order unchanged when disabled, when the model can't load,
 * or on any failure. Never throws.
 */
export async function rerankResults(
  query: string,
  results: NormalizedSearchResult[],
  env: NodeJS.ProcessEnv = process.env
): Promise<NormalizedSearchResult[]> {
  if (!isRerankEnabled(env) || results.length < 2 || !query.trim()) return results;
  try {
    const embed = await loadEmbedder();
    if (!embed) return results;
    const docs = results.map((r) => `${r.title ?? ""} ${r.snippet ?? r.highlight ?? ""}`.trim() || r.url);
    const out = await embed([query, ...docs], { pooling: "mean", normalize: true });
    const vecs = out.tolist();
    const q = vecs[0];
    const scored = results.map((r, i) => ({ r, score: cosine(q, vecs[i + 1]) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s, i) => ({ ...s.r, position: i + 1 }));
  } catch {
    return results;
  }
}
