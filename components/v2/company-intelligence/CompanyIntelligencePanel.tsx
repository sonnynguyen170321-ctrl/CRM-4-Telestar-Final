import type { ReactNode } from "react";
import { Sparkles, Trophy, AlertTriangle, ExternalLink, Check, Loader2 } from "lucide-react";

import type { IntelligenceView } from "@/lib/v2/company-intelligence/presentIntelligence";
import { toExternalHref } from "@/lib/v2/format/url";

// CINT5: the ONE shared intelligence presenter component. Business identity first;
// evidence + debug collapsed; advisory maturity demoted. Server-component safe
// (native <details>, no hooks). Consumed by Company drawer / Lead drawer / Manager
// Review / Compose so they never drift. Real persisted data only.

const CONFIDENCE_TONE: Record<string, string> = {
  HIGH: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  MEDIUM: "bg-amber-50 text-amber-700 ring-amber-100",
  LOW: "bg-muted text-muted-foreground ring-border",
};

function fmtLabel(value: string): string {
  return value.split(/[_\s]+/).map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(" ");
}

export function CompanyIntelligencePanel({
  view,
  extractSlot,
  isPending = false,
}: {
  view: IntelligenceView;
  extractSlot?: ReactNode;
  isPending?: boolean;
}) {
  if (!view.available) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-primary">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <h3 className="text-sm font-semibold text-foreground">Company intelligence</h3>
          </div>
          {extractSlot}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          No intelligence profile yet. Run extraction to enrich what this company does, sells, and who it sells to.
        </p>
      </section>
    );
  }

  const confident = view.confidence === "HIGH";

  const filteredClaims = view.claims.filter(claim => {
    const labelLower = claim.label.toLowerCase();
    if (labelLower.includes("what they sell") || labelLower.includes("offering")) return false;
    if (labelLower.includes("business model") || labelLower.includes("model")) return false;
    if (labelLower.includes("hq") || labelLower.includes("headquarter") || labelLower.includes("location")) return false;
    if (labelLower.includes("industry") || labelLower.includes("vertical")) return false;
    return true;
  });

  const shortSellTags = view.whatTheySell.filter(s => s.length < 50);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {isPending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm animate-in fade-in duration-200">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      {/* Header strip */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-gradient-to-br from-muted/40 to-card px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-primary">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <h3 className="text-sm font-semibold text-foreground">Company intelligence</h3>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {view.industryDetail ? (
              <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-primary">{view.industryDetail}</span>
            ) : view.category ? (
              <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-primary">{view.category}</span>
            ) : null}
            {view.vertical ? <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{fmtLabel(view.vertical)}</span> : null}
            {view.confidence ? (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${CONFIDENCE_TONE[view.confidence]}`}>
                {confident ? <Trophy className="h-3 w-3" aria-hidden="true" /> : <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                {view.confidence} confidence
              </span>
            ) : null}
          </div>
        </div>
        {extractSlot}
      </div>

      <div className="space-y-4 p-4">
        {/* One-line summary */}
        {view.companySummary ? <p className="text-sm font-medium leading-6 text-foreground">{view.companySummary}</p> : null}

        {/* Cited claims — each answer expandable to its grounding + per-claim confidence */}
        {filteredClaims.length > 0 ? (
          <Block label="Key facts">
            <div className="space-y-1.5">
              {filteredClaims.map((claim) => (
                <details key={claim.label} className="group rounded-lg border border-border bg-muted/60">
                  <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 text-xs">
                      <span className="font-semibold text-foreground">{claim.label}:</span>{" "}
                      <span className="text-muted-foreground">{claim.value}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {claim.confidence ? (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${CONFIDENCE_TONE[claim.confidence]}`}>{claim.confidence}</span>
                      ) : null}
                      <span className="text-[10px] text-muted-foreground">{claim.citations.length} cite{claim.citations.length === 1 ? "" : "s"}</span>
                    </span>
                  </summary>
                  {claim.citations.length > 0 ? (
                    <ul className="space-y-1.5 border-t border-border px-3 py-2">
                      {claim.citations.map((c, i) => (
                        <li key={i} className="text-[11px]">
                          <p className="text-muted-foreground">&ldquo;{c.text.slice(0, 180)}&rdquo;</p>
                          {toExternalHref(c.url) ? (
                            <a href={toExternalHref(c.url)!} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 break-all text-primary hover:text-primary/80">
                              <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />{shortUrl(c.url)}{c.pageType ? ` · ${fmtLabel(c.pageType)}` : ""}
                            </a>
                          ) : (
                            <span className="mt-0.5 inline-flex items-center gap-1 break-all text-muted-foreground">{shortUrl(c.url)}{c.pageType ? ` · ${fmtLabel(c.pageType)}` : ""}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </details>
              ))}
            </div>
          </Block>
        ) : null}

        {/* What they sell */}
        {shortSellTags.length > 0 ? (
          <Block label="What they sell">
            <ul className="flex flex-wrap gap-1.5">
              {shortSellTags.slice(0, 6).map((s, i) => (
                <li key={`${s}-${i}`} className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground">{s}</li>
              ))}
            </ul>
          </Block>
        ) : null}

        {/* Profile & Footprint Bento Block */}
        {(view.footprint.hqCountries.length > 0 || view.footprint.officeCountries.length > 0 || view.footprint.marketCountries.length > 0 || view.footprint.factoryCountries.length > 0 || view.footprint.revenueUsd || view.footprint.locationCount || view.footprint.multiLocation || view.businessModel || view.channels.length > 0) ? (
          <Block label="Profile & Footprint">
            <div className="grid gap-3 text-xs bg-muted/30 border border-border/50 rounded-xl p-3 sm:grid-cols-2">
              {view.businessModel ? (
                <div>
                  <span className="text-muted-foreground font-semibold">Business Model:</span>{" "}
                  <span className="font-semibold text-foreground">{view.businessModel}</span>
                </div>
              ) : null}
              {view.channels.length > 0 ? (
                <div>
                  <span className="text-muted-foreground font-semibold">Channels:</span>{" "}
                  <span className="font-semibold text-foreground">{view.channels.map(fmtLabel).join(", ")}</span>
                </div>
              ) : null}
              {view.footprint.hqCountries.length > 0 ? (
                <div>
                  <span className="text-muted-foreground font-semibold">HQ:</span>{" "}
                  <span className="font-semibold text-foreground">{view.footprint.hqCountries.map(fmtLabel).join(", ")}</span>
                </div>
              ) : null}
              {view.footprint.officeCountries.length > 0 ? (
                <div>
                  <span className="text-muted-foreground font-semibold">Offices:</span>{" "}
                  <span className="font-semibold text-foreground">{view.footprint.officeCountries.map(fmtLabel).join(", ")}</span>
                </div>
              ) : null}
              {view.footprint.marketCountries.length > 0 ? (
                <div>
                  <span className="text-muted-foreground font-semibold">Markets:</span>{" "}
                  <span className="font-semibold text-foreground">{view.footprint.marketCountries.map(fmtLabel).join(", ")}</span>
                </div>
              ) : null}
              {view.footprint.revenueUsd ? (
                <div>
                  <span className="text-muted-foreground font-semibold">Revenue:</span>{" "}
                  <span className="font-semibold text-foreground">~${view.footprint.revenueUsd.toLocaleString()}</span>
                </div>
              ) : null}
              {view.footprint.locationCount ? (
                <div>
                  <span className="text-muted-foreground font-semibold">Locations:</span>{" "}
                  <span className="font-semibold text-foreground">{view.footprint.locationCount}{view.footprint.multiLocation ? "+" : ""}</span>
                </div>
              ) : view.footprint.multiLocation ? (
                <div>
                  <span className="text-muted-foreground font-semibold">Locations:</span>{" "}
                  <span className="font-semibold text-foreground">multiple</span>
                </div>
              ) : null}
            </div>
          </Block>
        ) : null}
        {/* Risks — riskSignalsJson + risk.* tokens (previously dead to the UI) */}
        {view.risks.length > 0 ? (
          <Block label="Risks">
            <ul className="space-y-1 text-xs text-foreground">
              {view.risks.slice(0, 4).map((r, i) => (
                <li key={i} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden="true" />{fmtLabel(r)}</li>
              ))}
            </ul>
          </Block>
        ) : null}

        {/* Company size + target market — size LEVEL from a real headcount, never a
            keyword, so "serves small businesses" can't read as company size. */}
        {(view.companySize || view.targetMarket.length > 0) ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {view.companySize ? (
              <span>
                <span className="text-muted-foreground">Size:</span>{" "}
                <span className="font-medium text-foreground">{view.companySize.level ?? "Unknown"}</span>
                {view.companySize.employees ? <span className="text-muted-foreground"> · ~{view.companySize.employees.toLocaleString()} employees</span> : null}
              </span>
            ) : null}
            {view.targetMarket.length > 0 ? (
              <span><span className="text-muted-foreground">Serves:</span> {view.targetMarket.join(", ")}</span>
            ) : null}
          </div>
        ) : null}

        {/* Likely buyers */}
        {view.likelyBuyers.length > 0 ? (
          <Block label="Likely buyers">
            <div className="flex flex-wrap gap-1.5">
              {view.likelyBuyers.map((b, i) => (
                <span key={`${b}-${i}`} className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">{b}</span>
              ))}
            </div>
          </Block>
        ) : null}

        {/* Growth (real) */}
        {(view.growth.hiringReal || view.growth.signals.length > 0) ? (
          <Block label="Growth signals">
            <ul className="space-y-1 text-xs text-foreground">
              {view.growth.hiringReal ? (
                <li className="flex items-start gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />Actively hiring (real roles)</li>
              ) : null}
              {view.growth.signals.slice(0, 3).map((s, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span><span className="font-medium">{fmtLabel(s.kind)}</span>{s.detail ? ` — ${s.detail.slice(0, 100)}` : ""}</span>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {/* Partners — with kind badges (partner / integration / customer) */}
        {view.partnershipsCited.length > 0 || view.partnerships.length > 0 ? (
          <Block label="Partners / integrations">
            <div className="flex flex-wrap gap-1.5">
              {(view.partnershipsCited.length > 0 ? view.partnershipsCited : view.partnerships.map((p) => ({ ...p, confidence: null }))).slice(0, 10).map((p, i) => (
                <span key={`${p.name}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs text-foreground">
                  {p.name}
                  <span className="rounded bg-muted px-1 text-[9px] font-semibold uppercase text-muted-foreground">{p.kind}</span>
                </span>
              ))}
            </div>
          </Block>
        ) : null}

        {/* Evidence quality — sufficiency + conflicts (previously hidden) */}
        {view.quality ? (
          <Block label="Evidence quality">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {view.quality.score !== null ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                    <span className={`block h-full rounded-full ${view.quality.score >= 70 ? "bg-emerald-500" : view.quality.score >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${Math.max(0, Math.min(100, view.quality.score))}%` }} />
                  </span>
                  <span className="font-semibold tabular-nums">{view.quality.score}</span>
                </span>
              ) : null}
              {view.quality.usefulPages !== null ? <span>{view.quality.usefulPages} useful pages</span> : null}
              {view.quality.uniqueSources !== null ? <span>{view.quality.uniqueSources} sources</span> : null}
            </div>
            {view.quality.conflicts.length > 0 ? (
              <ul className="mt-1.5 space-y-0.5 text-[11px] text-amber-700">
                {view.quality.conflicts.slice(0, 3).map((c, i) => <li key={i}>⚠ {c}</li>)}
              </ul>
            ) : null}
          </Block>
        ) : null}

        {/* Evidence (collapsed) */}
        {view.evidence.length > 0 ? (
          <details className="rounded-lg border border-border bg-muted/60 p-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Evidence ({view.evidence.length})</summary>
            <ul className="mt-2 space-y-2">
              {view.evidence.map((e, i) => (
                <li key={i} className="text-xs">
                  <p className="text-foreground">{e.text.slice(0, 200)}</p>
                  {toExternalHref(e.url) ? (
                    <a href={toExternalHref(e.url)!} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 break-all text-primary hover:text-primary/80">
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />{shortUrl(e.url)}{e.pageType ? ` · ${fmtLabel(e.pageType)}` : ""}
                    </a>
                  ) : (
                    <span className="mt-0.5 inline-flex items-center gap-1 break-all text-muted-foreground">{shortUrl(e.url)}{e.pageType ? ` · ${fmtLabel(e.pageType)}` : ""}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {/* Debug (collapsed, secondary) */}
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Debug</summary>
          <div className="mt-1 space-y-0.5">
            <div>engine: {view.debug.engine ?? "—"}{view.debug.llmUsed ? " (llm)" : ""}</div>
            <div>provider: {view.debug.providerUsed ?? "—"} · pages: {view.debug.pagesFetched ?? "—"} · search: {view.debug.searchSufficient === null ? "—" : view.debug.searchSufficient ? "sufficient" : "insufficient"}</div>
            <div>fetch: {view.debug.fetchStatus ?? "—"} · status: {view.profileStatus ?? "—"}</div>
          </div>
        </details>
      </div>
    </section>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Pill({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${on ? "bg-emerald-50 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
      {on ? "✓" : "·"} {children}
    </span>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

// Default trigger styling for the "Extract intelligence" button (rendered by the
// Company drawer as a form posting to the extract action).
export const EXTRACT_TRIGGER_CLASS =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-primary/20 bg-accent px-2.5 text-xs font-medium text-primary hover:bg-accent/70";

export { Sparkles as ExtractIcon };
