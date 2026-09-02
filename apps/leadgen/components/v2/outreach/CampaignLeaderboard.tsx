import Link from "next/link";

import { CampaignStatusBadge } from "@/components/v2/outreach/CampaignStatusBadge";
import type { CampaignLeaderboardRow } from "@/lib/v2/outreach/reporting/queryCampaignPerformance";

// Per-campaign leaderboard with inline reply-rate bars (Lemlist-style). Presentational.

const numberFormat = new Intl.NumberFormat("en-US");
const pct = (value: number) => `${Math.round(value * 100)}%`;

export function CampaignLeaderboard({ rows }: { rows: CampaignLeaderboardRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Campaign leaderboard</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Sorted by replies. Click a campaign to manage it.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-normal text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3 text-right">Enrolled</th>
              <th className="px-4 py-3 text-right">Sent</th>
              <th className="px-4 py-3 text-right">Delivered</th>
              <th className="px-4 py-3 text-right">Replies</th>
              <th className="px-4 py-3">Reply rate</th>
              <th className="px-4 py-3 text-right">Bounce</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...rows]
              .sort((a, b) => b.repliedCount - a.repliedCount || b.sentCount - a.sentCount)
              .map((row) => (
                <tr key={row.id} className="hover:bg-muted/60">
                  <td className="px-4 py-3">
                    <Link href={`/v2/outreach/campaigns/${row.id}`} className="font-medium text-foreground hover:text-primary">
                      {row.name}
                    </Link>
                    <div className="mt-0.5">
                      <CampaignStatusBadge status={row.status} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{numberFormat.format(row.enrolledCount)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{numberFormat.format(row.sentCount)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{numberFormat.format(row.delivered)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-700">{numberFormat.format(row.repliedCount)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.round(row.replyRate * 100))}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{pct(row.replyRate)}</span>
                    </div>
                  </td>
                  <td className={`px-4 py-3 text-right text-xs ${row.bounceRate > 0.05 ? "font-medium text-red-600" : "text-muted-foreground"}`}>
                    {pct(row.bounceRate)}
                  </td>
                </tr>
              ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No campaigns yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
