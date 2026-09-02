import type { RecapSummary } from "@/lib/v2/activity-recaps/queryRecapSummary";

// "Recap Summary by SDR" table (mock). Presentational — counts come from
// queryRecapSummary (per-job aggregation over the uploaded rows).

const COLUMNS: Array<{ key: keyof RecapSummary["totals"]; label: string }> = [
  { key: "emails", label: "Emails" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "calls", label: "Calls" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "meetings", label: "Meetings" },
  { key: "flagged", label: "Flagged" },
  { key: "total", label: "Total" },
];

const numberFormat = new Intl.NumberFormat("en-US");

export function RecapSummaryBySdr({ summary }: { summary: RecapSummary }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Recap Summary by SDR</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Based on mapped data</p>
        </div>
        <span className="text-xs text-muted-foreground">{summary.sdrCount} SDRs</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-normal text-muted-foreground">
            <tr>
              <th className="px-4 py-3">SDR</th>
              {COLUMNS.map((column) => (
                <th key={column.key} className="px-4 py-3 text-right">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summary.rows.map((row) => (
              <tr key={row.sdr} className="hover:bg-muted/60">
                <td className="px-4 py-3 font-medium text-foreground">{row.sdr}</td>
                {COLUMNS.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 text-right ${
                      column.key === "total"
                        ? "font-semibold text-foreground"
                        : column.key === "flagged" && row.flagged > 0
                          ? "font-medium text-amber-700"
                          : "text-muted-foreground"
                    }`}
                  >
                    {numberFormat.format(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
            {summary.rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-8 text-center text-muted-foreground">
                  No mapped activity rows yet.
                </td>
              </tr>
            ) : null}
          </tbody>
          {summary.rows.length > 0 ? (
            <tfoot className="border-t border-border bg-muted/40 text-sm font-semibold text-foreground">
              <tr>
                <td className="px-4 py-3">Total</td>
                {COLUMNS.map((column) => (
                  <td key={column.key} className="px-4 py-3 text-right">
                    {numberFormat.format(summary.totals[column.key])}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
