"use client";

import { Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { CompanyScoreResult, CompanyType, Qualification } from "@/lib/types";

type CompanyDetailDrawerProps = {
  company: CompanyScoreResult | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const companyTypes: CompanyType[] = [
  "Not Relevant",
  "PAAS",
  "SAAS",
  "Cloud",
  "ITO",
  "Data Solution",
  "AI Solution",
  "AI Service",
  "Cyber Security",
  "Blockchain Solution",
];

const qualifications: Qualification[] = ["qualified", "unqualified", "uncertain"];

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatFlagName(value: string) {
  return value.replaceAll("_", " ");
}

function displayValue(value: string | number | undefined) {
  if (value === undefined || value === "") {
    return "Not provided";
  }

  return String(value);
}

export function CompanyDetailDrawer({
  company,
  open,
  onOpenChange,
}: CompanyDetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[min(100vw,40rem)] overflow-y-auto sm:max-w-xl"
      >
        {company ? (
          <>
            <SheetHeader className="border-b">
              <SheetTitle>{company.company_name}</SheetTitle>
              <SheetDescription>
                Static company review preview. Feedback saving is not connected.
              </SheetDescription>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="secondary">{company.type}</Badge>
                <Badge variant="outline">{company.qualification}</Badge>
                <Badge variant="outline">Score {company.company_score}</Badge>
                <Badge variant="outline">
                  Confidence {formatConfidence(company.confidence)}
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                <span>{displayValue(company.website)}</span>
                <span>{displayValue(company.company_country)}</span>
              </div>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              <section className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">
                  Score explanation
                </h3>
                <DetailBlock label="Reason" value={company.reason} />
                <DetailBlock
                  label="Summary"
                  value={company.one_sentence_company_summary}
                />
                <DetailBlock
                  label="Internal note"
                  value={displayValue(company.note)}
                />
                <DetailBlock label="Review state" value={company.review_state} />
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">
                  Hard rule flags
                </h3>
                <div className="grid gap-2">
                  {Object.entries(company.hard_rule_flags).map(
                    ([flag, triggered]) => (
                      <div
                        key={flag}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                      >
                        <span className="capitalize">{formatFlagName(flag)}</span>
                        <Badge variant={triggered ? "destructive" : "outline"}>
                          {triggered ? "triggered" : "clear"}
                        </Badge>
                      </div>
                    )
                  )}
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">
                  Raw company snapshot
                </h3>
                <div className="grid gap-2 rounded-md border p-3 text-sm">
                  <SnapshotRow label="Company Name" value={company.company_name} />
                  <SnapshotRow label="Website" value={company.website} />
                  <SnapshotRow
                    label="Company Country"
                    value={company.company_country}
                  />
                  <SnapshotRow label="Type" value={company.type} />
                  <SnapshotRow label="Note" value={company.note} />
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">
                  Review correction preview
                </h3>
                <div className="grid gap-3 rounded-md border p-3">
                  <div className="grid gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Final qualification
                    </label>
                    <Select disabled defaultValue={company.qualification}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {qualifications.map((qualification) => (
                          <SelectItem key={qualification} value={qualification}>
                            {qualification}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Final company type
                    </label>
                    <Select disabled defaultValue={company.type}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {companyTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Final score
                    </label>
                    <Input disabled value={company.company_score} readOnly />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Reviewer note
                    </label>
                    <Textarea
                      disabled
                      value="Feedback capture will be enabled in a later prompt."
                      readOnly
                    />
                  </div>
                  <Button disabled type="button" variant="secondary">
                    Save feedback - coming later
                  </Button>
                </div>
              </section>

              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex gap-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-sm leading-6 text-muted-foreground">
                    Prompt 11 will handle local feedback. Prompt 14 will handle
                    API routes later. This drawer is currently a static review
                    preview only.
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>No company selected</SheetTitle>
            <SheetDescription>
              Select a company row to preview review details.
            </SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm leading-6 text-foreground">{value}</p>
    </div>
  );
}

function SnapshotRow({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{displayValue(value)}</span>
    </div>
  );
}
