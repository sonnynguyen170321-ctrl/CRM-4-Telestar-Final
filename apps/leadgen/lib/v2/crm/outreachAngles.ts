import type { IntelligenceView } from "@telestar/core-intel/presentIntelligence";

// Deterministic outreach-angle generator. Derives 2-4 concrete "here's how to open this" hooks
// from the company-intelligence signals the drawer already has, so a fresh SDR can pitch without
// reading the whole profile. Crucially it NEVER dumps a raw website meta-description verbatim —
// free-text signals are distilled to a short, clean phrase first (the "copied from the web" look).
// Only emits angles backed by real signals; thin intelligence returns nothing (UI shows a prompt).
// An optional AI paraphrase layer (paraphraseOutreachAngles) can polish the wording server-side.

export type OutreachAngle = { title: string; detail: string };

/** Distill a raw website string into a short, clean noun-phrase — first clause, no trailing
 *  boilerplate, capped. Turns "AnyMind Group provides individuals and businesses with a suite of
 *  best-in-class technolog…" into "a suite of best-in-class technology". */
function phrase(raw: string | null | undefined, max = 60): string | null {
  if (!raw) return null;
  let t = raw.replace(/\s+/g, " ").trim();
  // strip a leading "<Company> is/provides/offers/helps" preamble so the phrase is the substance
  t = t.replace(/^[A-Z][\w&.,'-]*(?:\s+[A-Z][\w&.,'-]*){0,4}\s+(?:is|are|provides?|offers?|helps?|builds?|enables?|delivers?)\s+(?:a|an|the|leading|best-in-class)?\s*/i, "");
  // cut at the first sentence/clause boundary
  t = t.split(/[.!?;•|]| - /)[0].trim();
  if (t.length > max) t = `${t.slice(0, max - 1).trim()}…`;
  return t.length >= 3 ? t : null;
}

function titleCasePhrase(raw: string | null | undefined, max = 42): string | null {
  const p = phrase(raw, max);
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : null;
}

function isGenericBoilerplate(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("keep up to date") ||
         lower.includes("newsletter") ||
         lower.includes("subscribe") ||
         lower.includes("cookie") ||
         lower.includes("privacy policy") ||
         lower.includes("copyright") ||
         lower.includes("announcement") ||
         lower.includes("all rights reserved");
}

function isSlogan(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.startsWith("your trusted") ||
         lower.startsWith("we are") ||
         lower.startsWith("welcome to") ||
         lower.startsWith("the leading") ||
         lower.startsWith("specialized in") ||
         lower.includes("all things") ||
         lower.length > 50;
}

function isSelfPartnership(partnerName: string, companyName: string): boolean {
  const pLower = partnerName.toLowerCase();
  const cLower = companyName.toLowerCase();
  if (pLower.includes(cLower) || cLower.includes(pLower)) return true;
  const pWords = pLower.split(/[\s,.-]+/).filter(w => w.length >= 3);
  const cWords = cLower.split(/[\s,.-]+/).filter(w => w.length >= 3);
  const common = pWords.filter(w => cWords.includes(w) && w !== "and" && w !== "the" && w !== "for" && w !== "ltd" && w !== "inc" && w !== "co");
  return common.length > 0;
}

export function deriveOutreachAngles(
  view: IntelligenceView,
  opts: { companyName: string; contactTitle?: string | null }
): OutreachAngle[] {
  if (!view.available) return [];
  const angles: OutreachAngle[] = [];
  const company = opts.companyName || "This company";

  // 1. Growth / funding / hiring / expansion — the most time-sensitive hook.
  const funding = view.growth.signals.find((s) => s.kind === "funding");
  const expansion = view.growth.signals.find((s) => s.kind === "new_market" && !isGenericBoilerplate(s.detail));
  if (funding) {
    const raised = phrase(funding.detail, 48);
    angles.push({ title: "Fresh funding", detail: raised ? `They ${raised} — the budget is live now. Name the raise in line one and a payback they'd see this quarter.` : `${company} raised recently — the budget is live now. Name the raise and a fast payback.` });
  } else if (view.growth.hiringReal) {
    angles.push({ title: "Actively hiring", detail: `${company} is adding headcount right now. Open on getting those new hires productive faster.` });
  }
  if (expansion) {
    const where = phrase(expansion.detail, 50);
    angles.push({ title: "Expanding", detail: where ? `They're moving into ${where} — new region, new budget. Name it in your first line.` : `They're entering a new market — name the expansion in your first line.` });
  }

  // 2. Who they sell to — anchor the pitch to THEIR customer.
  const audience = [...view.likelyBuyers, ...view.targetMarket].filter(Boolean);
  if (audience.length > 0) {
    const who = audience.slice(0, 2).join(" and ");
    angles.push({ title: `Sells to ${audience.slice(0, 2).join(" / ")}`, detail: `Their customers are ${who}. Frame your value as helping ${company} win more of that segment.` });
  }

  // 3. What they sell — a distilled phrase, never the raw meta description.
  const validProduct = view.whatTheySell.find(s => !isSlogan(s));
  const product = validProduct ? titleCasePhrase(validProduct, 40) : null;
  if (product) {
    const verb = product.toLowerCase().startsWith("a ") || product.toLowerCase().startsWith("an ") ? "offer" : "do";
    angles.push({ title: `Anchor to "${product}"`, detail: `They ${verb} ${product.toLowerCase()}. Reference it directly so your opener proves you actually read what they ship.` });
  }

  // 4. Partnerships / ecosystem.
  const validPartnership = view.partnerships.find(p => !isSelfPartnership(p.name, company));
  if (validPartnership) {
    angles.push({ title: `Works with ${validPartnership.name}`, detail: `They partner with ${validPartnership.name}. A shared-ecosystem or integration angle earns a warmer reply.` });
  }

  // 5. Fallback to category context when nothing sharper exists.
  if (angles.length === 0) {
    const ctx = titleCasePhrase(view.companySummary, 80) ?? view.category;
    if (ctx) angles.push({ title: view.category ? `${view.category} play` : "Company context", detail: `Open with what ${company} does — ${ctx.toLowerCase()} — and a specific outcome you drive for companies like them.` });
  }

  // Persona-aware nudge when we know the contact's role.
  if (opts.contactTitle && angles.length > 0 && angles.length < 4) {
    angles.push({ title: `Frame for a ${opts.contactTitle}`, detail: `Lead with what a ${opts.contactTitle} is measured on — the outcome they own, not your feature list.` });
  }

  return angles.slice(0, 4);
}
