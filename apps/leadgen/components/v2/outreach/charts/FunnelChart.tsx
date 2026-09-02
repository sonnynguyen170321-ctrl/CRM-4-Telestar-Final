// Lemlist-style horizontal funnel: Enrolled → Sent → Delivered → Opened → Replied →
// Meetings, each bar width proportional to the top stage, with stage-over-stage
// conversion %. Pure presentational (server component) — no chart lib needed.

const numberFormat = new Intl.NumberFormat("en-US");

export type FunnelStage = { label: string; value: number; color: string };

export function FunnelChart({
  funnel,
  trackingAvailable,
}: {
  funnel: {
    enrolled: number;
    sent: number;
    delivered: number;
    opened: number | null;
    replied: number;
    meetings: number;
  };
  trackingAvailable: boolean;
}) {
  const stages: FunnelStage[] = [
    { label: "Enrolled", value: funnel.enrolled, color: "bg-foreground" },
    { label: "Sent", value: funnel.sent, color: "bg-primary" },
    { label: "Delivered", value: funnel.delivered, color: "bg-sky-500" },
    ...(trackingAvailable && funnel.opened !== null
      ? [{ label: "Opened", value: funnel.opened, color: "bg-violet-500" }]
      : []),
    { label: "Replied", value: funnel.replied, color: "bg-emerald-500" },
    { label: "Meetings", value: funnel.meetings, color: "bg-amber-500" },
  ];
  const top = Math.max(stages[0]?.value ?? 0, 1);

  return (
    <div className="space-y-2.5">
      {stages.map((stage, index) => {
        const prev = index > 0 ? stages[index - 1].value : null;
        const conversion = prev && prev > 0 ? Math.round((stage.value / prev) * 100) : null;
        const width = Math.max((stage.value / top) * 100, stage.value > 0 ? 4 : 0);
        return (
          <div key={stage.label} className="flex items-center gap-3">
            <div className="w-20 shrink-0 text-right text-xs font-medium text-muted-foreground">{stage.label}</div>
            <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-muted">
              <div
                className={`flex h-full items-center rounded-md ${stage.color} px-2 transition-all`}
                style={{ width: `${width}%` }}
              >
                <span className="text-xs font-semibold text-white">{numberFormat.format(stage.value)}</span>
              </div>
            </div>
            <div className="w-12 shrink-0 text-xs text-muted-foreground">
              {conversion !== null ? `${conversion}%` : ""}
            </div>
          </div>
        );
      })}
      {!trackingAvailable ? (
        <p className="pl-[5.75rem] text-[11px] text-muted-foreground">Opens hidden — verify a tracking domain to surface them.</p>
      ) : null}
    </div>
  );
}
