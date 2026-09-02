import { Download, FileDown, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/statusBadges";

const exportLinks = [
  {
    href: "/api/companies/export",
    title: "Export all active companies",
    description:
      "Download active company rows with local predicted values and SDR final overlays.",
  },
  {
    href: "/api/companies/export?qualification=qualified",
    title: "Export final qualified",
    description:
      "Download companies whose final reviewed or predicted qualification is qualified.",
  },
  {
    href: "/api/companies/export?qualification=uncertain",
    title: "Export final uncertain",
    description:
      "Download companies whose final reviewed or predicted qualification is uncertain.",
  },
  {
    href: "/api/companies/export?reviewed=true",
    title: "Export reviewed only",
    description: "Download only companies with saved SDR feedback examples.",
  },
];

const aiExportLinks = exportLinks.map((link) => ({
  ...link,
  href: `${link.href}${link.href.includes("?") ? "&" : "?"}includeAi=true`,
}));

export default function ExportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Company exports"
        title="Exports"
        description="Download DB-backed company results for review or handoff. Exports keep local predicted values and SDR final values separate."
        actions={<StatusBadge tone="info">AI is not export source of truth</StatusBadge>}
        className="rounded-md border shadow-xs"
      />

      <section className="rounded-md border bg-background p-4 shadow-xs">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-emerald-700" />
          <div className="space-y-2 text-sm leading-6 text-muted-foreground">
            <p>
              CSV exports use persisted company records, latest local score
              results, latest website research, and latest SDR feedback overlay.
            </p>
            <p>
              Rows with feedback use SDR final type, score, qualification, and
              note as final values. Predicted fields remain in separate columns
              for auditability. AI assessments are second opinions and are only
              appended when you choose an AI-enriched export.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {exportLinks.map((link) => (
          <a
            key={link.href}
            className="block rounded-md border bg-background p-4 shadow-xs transition-colors hover:bg-slate-50"
            href={link.href}
          >
            <div className="flex items-center gap-2 font-medium">
              <FileDown className="h-4 w-4 text-blue-600" />
              {link.title}
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {link.description}
            </p>
            <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-700">
              Download CSV
              <Download className="h-4 w-4" />
            </div>
          </a>
        ))}
      </div>

      <section className="space-y-3 rounded-md border bg-background p-4 shadow-xs">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Optional AI-enriched exports
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            These links append AI second-opinion columns at the end of the CSV.
            Official final values still come from local scoring plus SDR review.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {aiExportLinks.map((link) => (
            <a
              key={link.href}
              className="block rounded-md border bg-muted/20 p-3 transition-colors hover:bg-slate-50"
              href={link.href}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileDown className="h-4 w-4 text-violet-600" />
                {link.title} + AI columns
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                AI columns are appended as second-opinion metadata only.
              </p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
