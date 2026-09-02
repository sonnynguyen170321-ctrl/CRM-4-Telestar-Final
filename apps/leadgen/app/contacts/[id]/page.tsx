import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getContact } from "@/lib/server/contacts/contacts";

type ContactDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ContactDetailPage({
  params,
}: ContactDetailPageProps) {
  const { id } = await params;
  const contact = await getContact(id);

  if (!contact) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <PageHeader
        eyebrow="Contacts"
        title={contact.fullName}
        description="Contact activity history from saved SDR activity recap rows. This does not change company scores or feedback."
        actions={
          <Button asChild variant="outline">
            <Link href="/contacts">Back to contacts</Link>
          </Button>
        }
      />

      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>Contact identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Name" value={contact.fullName} />
              <DetailRow label="Title" value={contact.title} />
              <DetailRow label="Email" value={contact.email} />
              <DetailRow label="Phone" value={contact.phone} />
              <DetailLink
                label="LinkedIn"
                value={contact.contactLinkedInUrl}
              />
              <DetailRow label="Owner SDR" value={contact.ownerSdrName} />
              <DetailRow label="Latest SDR" value={contact.latestSdrName} />
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>Company link</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow
                label="Raw company"
                value={contact.companyNameRaw ?? contact.companyRecord?.companyName}
              />
              {contact.companyRecord ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-xs font-medium text-emerald-700">
                    Matched CompanyRecord
                  </div>
                  <div className="mt-1 font-semibold text-slate-900">
                    {contact.companyRecord.companyName}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    {contact.companyRecord.website ?? "No website"}
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="mt-3 bg-white"
                  >
                    <Link
                      href={`/companies?search=${encodeURIComponent(
                        contact.companyRecord.companyName
                      )}`}
                    >
                      Open company search
                    </Link>
                  </Button>
                </div>
              ) : (
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-slate-100 text-slate-600"
                >
                  No company match
                </Badge>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>Activity summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Total" value={contact.activityCount} />
              <Metric label="LinkedIn" value={contact.linkedinCount} />
              <Metric label="Email" value={contact.emailCount} />
              <Metric label="Call" value={contact.callCount} />
              <Metric label="No pick up" value={contact.noPickupCount} />
              <Metric
                label="Manager review"
                value={contact.managerReviewCount}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>Linked activity rows</CardTitle>
          </CardHeader>
          <CardContent>
            {contact.activityRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                No activity rows linked yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead>Date / week</TableHead>
                      <TableHead>SDR</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Channels</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Review</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contact.activityRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs text-slate-600">
                          <div>{row.activityDate || "-"}</div>
                          <div>{row.weekLabel || "-"}</div>
                        </TableCell>
                        <TableCell>{row.sdrName}</TableCell>
                        <TableCell>{row.companyName || "-"}</TableCell>
                        <TableCell className="text-xs text-slate-600">
                          <div>LI: {row.linkedinStageNormalized}</div>
                          <div>Email: {row.emailStageNormalized}</div>
                          <div>Call: {row.callStageNormalized}</div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-sm whitespace-normal text-xs leading-5 text-slate-600">
                            {row.noteCombined || "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.managerReviewFlag ? (
                            <Badge
                              variant="outline"
                              className="border-amber-200 bg-amber-50 text-amber-700"
                            >
                              {row.managerReviewPriority}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-slate-200 bg-slate-100 text-slate-600"
                            >
                              None
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button asChild size="sm" variant="outline">
                            <Link href="/activity-recaps">
                              Recap
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-slate-900">{value || "Not provided"}</div>
    </div>
  );
}

function DetailLink({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      {value ? (
        <a
          className="mt-1 block text-blue-700 hover:underline"
          href={value}
          target="_blank"
          rel="noreferrer"
        >
          {value}
        </a>
      ) : (
        <div className="mt-1 text-slate-900">Not provided</div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
