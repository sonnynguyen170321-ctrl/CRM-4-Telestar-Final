import { Badge } from "@/components/ui/badge";
import type { V2IcpRuleSummaryItem, V2IcpRulesSummary } from "@/lib/v2/icp";

type IcpRulesSummaryProps = {
  summary: V2IcpRulesSummary;
};

export function IcpRulesSummary({ summary }: IcpRulesSummaryProps) {
  if (!summary.rawAvailable) {
    return (
      <div className="rounded-xl border border-dashed border-hairline bg-surface p-4 text-sm text-muted-foreground shadow-sm">
        No rulesJson is recorded for this ICP version.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Rules identity</h3>
          {summary.schemaVersion && (
            <Badge variant="outline" className="bg-secondary text-secondary-foreground border-border">Schema {summary.schemaVersion}</Badge>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {summary.displayName ?? "Rules display name is not recorded."}
        </p>
      </div>
      <RuleGroup title="Hard gates" items={summary.hardGates} empty="No hard gates recorded." />
      <RuleGroup
        title="Positive signals"
        items={summary.positiveSignals}
        empty="No positive signals recorded."
      />
      <RuleGroup
        title="Negative signals"
        items={summary.negativeSignals}
        empty="No negative signals recorded."
      />
      <RuleGroup
        title="Company type rules"
        items={summary.companyTypeRules}
        empty="No company type rules recorded."
      />
      <PolicyGroup
        title="Missing data policy"
        lines={summary.missingDataPolicy}
        empty="No missing data policy recorded."
      />
      <PolicyGroup
        title="Confidence policy"
        lines={summary.confidencePolicy}
        empty="No confidence policy recorded."
      />
      <PolicyGroup
        title="Source reliability priors"
        lines={summary.sourceReliability}
        empty="No source reliability priors recorded."
      />
      <PolicyGroup
        title="Score policy"
        lines={summary.scorePolicy}
        empty="No score policy recorded."
      />
    </div>
  );
}

function RuleGroup({
  title,
  items,
  empty,
}: {
  title: string;
  items: V2IcpRuleSummaryItem[];
  empty: string;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {items.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {items.map((item, index) => (
            <div key={`${item.label}-${index}`} className="rounded-md bg-secondary p-3 border border-hairline/50">
              <div className="text-sm font-medium text-foreground">{item.label}</div>
              {item.detail && (
                <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function PolicyGroup({
  title,
  lines,
  empty,
}: {
  title: string;
  lines: string[];
  empty: string;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {lines.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground list-disc pl-5">
          {lines.map((line, index) => (
            <li key={`${line}-${index}`}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}
