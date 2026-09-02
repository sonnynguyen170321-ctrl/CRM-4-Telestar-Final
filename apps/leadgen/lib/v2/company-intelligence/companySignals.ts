import type { IntelligenceView } from "./presentIntelligence";

// Derive the premium company-drawer rail (status pill, health rows, key signals)
// from data we ACTUALLY persist: the reasoning IntelligenceView + research/profile
// status + lead count. Nothing here is invented (Invariant 7) — fields the mockup
// shows but we don't store (employees, web traffic, technographics depth) are simply
// not produced. Pure + tenant-agnostic, so it is unit-testable and reusable.

export type CompanyStatusTone = "green" | "amber" | "red" | "slate";
export type CompanyStatusPill = { label: string; tone: CompanyStatusTone };
export type CompanyHealthRow = { label: string; value: string; tone: CompanyStatusTone };

export type CompanySignals = {
  statusPill: CompanyStatusPill;
  health: CompanyHealthRow[];
  positive: string[];
  watchOuts: string[];
};

const RESEARCH_ISSUE = new Set(["BLOCKED", "TIMEOUT", "INVALID_URL", "OFFLINE", "NO_WEBSITE"]);

export function deriveCompanySignals(input: {
  view: IntelligenceView;
  researchStatus: string | null;
  profileStatus: string | null;
  leadAssignmentCount: number;
}): CompanySignals {
  const { view, researchStatus, profileStatus, leadAssignmentCount } = input;

  return {
    statusPill: deriveStatusPill(view, researchStatus, profileStatus),
    health: deriveHealth(view),
    positive: derivePositive(view),
    watchOuts: deriveWatchOuts(view, researchStatus, leadAssignmentCount),
  };
}

function deriveStatusPill(
  view: IntelligenceView,
  researchStatus: string | null,
  profileStatus: string | null
): CompanyStatusPill {
  if (researchStatus && RESEARCH_ISSUE.has(researchStatus)) {
    return { label: "Research issue", tone: "red" };
  }
  if (!view.available || profileStatus === null || researchStatus === "NOT_RUN") {
    return { label: "Needs research", tone: "slate" };
  }
  if (profileStatus === "EXTRACTED" && (view.confidence === "HIGH" || view.confidence === "MEDIUM")) {
    return { label: "Healthy", tone: "green" };
  }
  if (profileStatus === "PARTIAL" || researchStatus === "JS_RENDER_REQUIRED" || view.confidence === "LOW") {
    return { label: "Partial", tone: "amber" };
  }
  return { label: "Enriched", tone: "green" };
}

function deriveHealth(view: IntelligenceView): CompanyHealthRow[] {
  const yes = (label: string, value: string): CompanyHealthRow => ({ label, value, tone: "green" });
  const no = (label: string): CompanyHealthRow => ({ label, value: "—", tone: "slate" });
  return [
    view.growth.hiringReal ? yes("Hiring intent", "Active") : no("Hiring intent"),
    view.maturity.funding ? yes("Funding", "Signal seen") : no("Funding"),
    view.growth.signals.length > 0
      ? yes("Momentum", `${view.growth.signals.length} signal${view.growth.signals.length === 1 ? "" : "s"}`)
      : { label: "Momentum", value: "Quiet", tone: "slate" },
    view.maturity.partnerships ? yes("Partnerships", "Present") : no("Partnerships"),
    view.maturity.customers ? yes("Customer proof", "Present") : no("Customer proof"),
  ];
}

function derivePositive(view: IntelligenceView): string[] {
  const out: string[] = [];
  if (view.growth.hiringReal) out.push("Actively hiring (real roles)");
  for (const signal of view.growth.signals.slice(0, 3)) {
    out.push(`${fmt(signal.kind)}${signal.detail ? ` — ${signal.detail.slice(0, 90)}` : ""}`);
  }
  if (view.maturity.customers) out.push("Customer proof on site");
  if (view.maturity.partnerships) out.push("Has partnerships / integrations");
  if (view.maturity.funding && !view.growth.signals.some((s) => s.kind.includes("fund"))) {
    out.push("Funding signal");
  }
  return dedupe(out);
}

function deriveWatchOuts(
  view: IntelligenceView,
  researchStatus: string | null,
  leadAssignmentCount: number
): string[] {
  const out: string[] = [];
  if (researchStatus === "JS_RENDER_REQUIRED") out.push("Site needs JS render — intelligence is partial");
  if (researchStatus === "BLOCKED") out.push("Crawler was blocked by the site");
  if (researchStatus === "TIMEOUT") out.push("Site timed out during research");
  if (researchStatus === "INVALID_URL" || researchStatus === "NO_WEBSITE") out.push("No usable website to research");
  if (view.available && view.confidence === "LOW") out.push("Low evidence confidence — verify before acting");
  if (view.available && view.whatTheySell.length === 0) out.push("Offering not clearly identified");
  if (leadAssignmentCount === 0) out.push("No active LeadAssignments yet");
  return dedupe(out);
}

function fmt(value: string): string {
  return value
    .split(/[_\s]+/)
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(" ");
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}
