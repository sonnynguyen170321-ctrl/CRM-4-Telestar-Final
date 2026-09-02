// Pure prompt builder + response parser for the AI-fit layer. No server-only / prisma import,
// so it stays offline-unit-testable. The live orchestration lives in scoreCandidatesWithAi.ts.

export type AiFitInput = {
  name: string;
  title: string | null;
  companyName: string | null;
  domain: string | null;
  snippet: string | null;
};

export type AiFit = { fitScore: number; fitReason: string; location: string | null };

export const MAX_CANDIDATES_PER_CALL = 30;

/** Assemble the scoring prompt. Compact JSON in / JSON out so it is cheap + parseable. */
export function buildFitPrompt(kind: "COMPANY" | "CONTACT", targetSignals: string[], candidates: AiFitInput[]): string {
  const signals = targetSignals.filter(Boolean).slice(0, 40).join(", ") || "(none provided)";
  const rows = candidates.slice(0, MAX_CANDIDATES_PER_CALL).map((c, i) => ({
    i,
    name: c.name,
    ...(kind === "CONTACT" ? { title: c.title ?? "", company: c.companyName ?? "" } : { domain: c.domain ?? "" }),
    snippet: (c.snippet ?? "").slice(0, 240),
  }));
  return [
    `ICP target signals (${kind.toLowerCase()} search): ${signals}.`,
    `Score each candidate 0-100 for how well it fits the ICP based only on the evidence given.`,
    `Be strict: aggregators, directories, or off-target results score low.`,
    `Return ONLY a JSON array, one object per candidate: {"i": <index>, "score": <0-100>, "reason": "<short reason>", "location": "<city/country or empty>"}.`,
    `Candidates:`,
    JSON.stringify(rows),
  ].join("\n");
}

/** Parse the model's JSON array back into per-index fit. Tolerates code fences + extra prose;
 *  drops malformed entries; clamps scores. Returns a map keyed by candidate index. */
export function parseFitResponse(text: string, count: number): Map<number, AiFit> {
  const out = new Map<number, AiFit>();
  const json = extractJsonArray(text);
  if (!Array.isArray(json)) return out;
  for (const entry of json) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const index = Number(obj.i ?? obj.index);
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    const rawScore = Number(obj.score ?? obj.fitScore);
    if (!Number.isFinite(rawScore)) continue;
    const fitScore = Math.max(0, Math.min(100, Math.round(rawScore)));
    const reason = typeof obj.reason === "string" ? obj.reason.slice(0, 300) : "";
    const location = typeof obj.location === "string" && obj.location.trim() ? obj.location.trim().slice(0, 120) : null;
    out.set(index, { fitScore, fitReason: reason || "AI-scored ICP fit", location });
  }
  return out;
}

function extractJsonArray(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
