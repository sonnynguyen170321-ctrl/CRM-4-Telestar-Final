// Pure paraphrase helpers: deterministic distillation (fallback when AI is off) + the AI prompt
// builder + response parser. No server-only/prisma import so it stays offline-testable. The live
// orchestration (provider call + gating) lives in ./paraphrase.

export type ParaphrasePurpose = "role_summary" | "company_oneliner" | "outreach_angle";

const PURPOSE_INSTRUCTION: Record<ParaphrasePurpose, string> = {
  role_summary: "Summarize this person's role + focus for an SDR in ONE sentence (max 22 words). No fluff, no 'experienced professional' filler.",
  company_oneliner: "Summarize what this company does in ONE plain sentence (max 20 words). Say what they sell + to whom.",
  outreach_angle: "Rewrite this cold-outreach angle into ONE natural, specific sentence a rep could say (max 26 words).",
};

/** Deterministic distillation: strip boilerplate preamble, cut to the first clause, cap length.
 *  Used verbatim when AI is off, and as the never-empty fallback. */
export function distill(raw: string | null | undefined, maxChars = 160): string | null {
  if (!raw) return null;
  let t = raw.replace(/\s+/g, " ").trim();
  // drop generic LinkedIn/bio filler
  t = t.replace(/\b(experienced|seasoned|results?-driven|passionate|motivated|dynamic|proven track record|demonstrated history)\b/gi, "").replace(/\s+/g, " ").trim();
  // first sentence / clause
  const firstStop = t.search(/[.!?]\s/);
  if (firstStop > 30) t = t.slice(0, firstStop + 1).trim();
  if (t.length > maxChars) t = `${t.slice(0, maxChars - 1).trim()}…`;
  return t.length >= 4 ? t : null;
}

export function buildParaphrasePrompt(purpose: ParaphrasePurpose, text: string): string {
  return [
    PURPOSE_INSTRUCTION[purpose],
    "Return ONLY the sentence, no quotes, no preamble.",
    "---",
    text.slice(0, 1200),
  ].join("\n");
}

/** Parse the model's reply into a single clean sentence. */
export function parseParaphrase(text: string): string | null {
  const line = text.replace(/```/g, "").split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return null;
  const cleaned = line.replace(/^["'`]+|["'`]+$/g, "").trim();
  return cleaned.length >= 4 ? cleaned.slice(0, 320) : null;
}
