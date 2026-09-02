import {
  AlertTriangle,
  CalendarClock,
  Building2,
  UserX,
  TrendingUp,
  Copy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ReviewFlagCounts } from "@/lib/v2/activity-recaps/queryReviewFlags";

// "Manager Review Rules & Flags" cards (mock). Read-only data-quality dashboard; the
// counts come from queryReviewFlags. Match-quality routing to Manager Review already
// happens in the ACTIVITY_APPLY stage — these cards surface quality signals.

type FlagCard = {
  key: keyof ReviewFlagCounts;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: "red" | "amber" | "blue" | "emerald";
};

const CARDS: FlagCard[] = [
  {
    key: "activityDateInFuture",
    title: "Activity Date in Future",
    description: "Rows with activity date > today",
    icon: CalendarClock,
    tone: "red",
  },
  {
    key: "missingOutcome",
    title: "Missing / Unknown Outcome",
    description: "Outcome is blank or 'N/A'",
    icon: AlertTriangle,
    tone: "amber",
  },
  {
    key: "unmatchedCompany",
    title: "Unmatched Company",
    description: "Company not matched to Telestar",
    icon: Building2,
    tone: "amber",
  },
  {
    key: "unmatchedContact",
    title: "Unmatched Contact",
    description: "Contact not matched to Telestar",
    icon: UserX,
    tone: "amber",
  },
  {
    key: "highVolumeOutlier",
    title: "High Volume Outlier",
    description: "Activity count > 250 for a single day",
    icon: TrendingUp,
    tone: "emerald",
  },
  {
    key: "duplicateContacts",
    title: "Duplicate Contacts",
    description: "Possible duplicate contact entries",
    icon: Copy,
    tone: "blue",
  },
];

const TONE_STYLES: Record<FlagCard["tone"], { icon: string; badge: string }> = {
  red: { icon: "bg-red-50 text-red-600", badge: "bg-red-50 text-red-700" },
  amber: { icon: "bg-amber-50 text-amber-600", badge: "bg-amber-50 text-amber-700" },
  blue: { icon: "bg-accent text-primary", badge: "bg-accent text-primary" },
  emerald: { icon: "bg-emerald-50 text-emerald-600", badge: "bg-emerald-50 text-emerald-700" },
};

const numberFormat = new Intl.NumberFormat("en-US");

export function ManagerReviewFlags({ counts }: { counts: ReviewFlagCounts }) {
  const activeRules = CARDS.filter((card) => counts[card.key] > 0).length;

  return (
    <section className="rounded-xl border border-border bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Review Rules &amp; Flags</h2>
        <span className="text-xs text-muted-foreground">
          Triggered by {activeRules} active rule{activeRules === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CARDS.map((card) => {
          const count = counts[card.key];
          const tone = TONE_STYLES[card.tone];
          const Icon = card.icon;
          return (
            <div
              key={card.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white p-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{card.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{card.description}</div>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  count > 0 ? tone.badge : "bg-muted/40 text-muted-foreground"
                }`}
              >
                {numberFormat.format(count)} rows
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
