import { History, Clock, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const timeline = [
  { event: "Bulk scoring completed", detail: "187 leads scored against ICP v3", time: "2 hours ago", type: "scoring" },
  { event: "Leads ingested", detail: "312 leads from Data acquisition job #42", time: "4 hours ago", type: "ingestion" },
  { event: "ICP v3 published", detail: "Updated hard rules for B2B SaaS VP Sales", time: "1 day ago", type: "icp" },
  { event: "Enrichment run", detail: "68 companies enriched via Apollo", time: "2 days ago", type: "enrichment" },
  { event: "Project created", detail: "Project initialized with 3 products", time: "5 days ago", type: "project" },
];

export default function ProjectActivityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Activity timeline</h2>
        <p className="text-sm text-muted-foreground">Recent events and changes across this project.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent events</CardTitle>
          <CardDescription>Chronological log of scoring runs, ingestion jobs, ICP changes, and more.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {timeline.map((item, i) => (
              <div key={i} className="relative flex gap-4 pb-6 last:pb-0">
                <div className="flex flex-col items-center">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                    item.type === "scoring" ? "border-primary/20 bg-accent text-primary" :
                    item.type === "ingestion" ? "border-emerald-200 bg-emerald-50 text-emerald-600" :
                    item.type === "icp" ? "border-indigo-200 bg-indigo-50 text-indigo-600" :
                    item.type === "enrichment" ? "border-amber-200 bg-amber-50 text-amber-600" :
                    "border-border bg-muted/40 text-muted-foreground"
                  }`}>
                    <History className="h-3.5 w-3.5" />
                  </div>
                  {i < timeline.length - 1 && <div className="mt-1 w-px flex-1 bg-border" />}
                </div>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.event}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {item.time}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-center border-t pt-4">
            <Link
              href="#"
              className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80"
            >
              View full activity log
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
