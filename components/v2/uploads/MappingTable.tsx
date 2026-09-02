"use client";

import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";

const CANONICAL_FIELDS = [
  // Contact specific
  ["firstName", "First Name"],
  ["lastName", "Last Name"],
  ["contact", "Full Name"],
  ["email", "Email"],
  ["title", "Job Title"],
  ["department", "Department"],
  ["seniority", "Seniority"],
  ["contactPhone", "Contact Phone"],
  ["contactLinkedin", "Contact LinkedIn"],
  ["contactCity", "Contact City"],
  ["contactCountry", "Contact Country"],
  
  // Company specific
  ["company", "Company Name"],
  ["website", "Website"],
  ["domain", "Domain"],
  ["linkedin", "Company LinkedIn"],
  ["companyPhone", "Company Phone"],
  ["companyIndustry", "Industry"],
  ["companyCity", "Company City"],
  ["companyCountry", "Company Country"],
  ["companyRevenue", "Company Revenue"],
  ["companyStaffCount", "Company Staff Count"],
] as const;

export type CanonicalMappingFields = {
  company: string | null;
  website: string | null;
  domain: string | null;
  email: string | null;
  contact: string | null;
  linkedin: string | null;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  department?: string | null;
  seniority?: string | null;
  contactPhone?: string | null;
  contactLinkedin?: string | null;
  contactCity?: string | null;
  contactCountry?: string | null;
  companyPhone?: string | null;
  companyIndustry?: string | null;
  companyCity?: string | null;
  companyCountry?: string | null;
  companyRevenue?: string | null;
  companyStaffCount?: string | null;
};

type MappingTableProps = {
  headers: string[];
  previewRows: Array<Record<string, string>>;
  disabled?: boolean;
  onSubmit: (fields: CanonicalMappingFields) => void;
};

export function MappingTable({
  disabled,
  headers,
  onSubmit,
  previewRows,
}: MappingTableProps) {
  const defaultValues = useMemo(() => buildDefaultValues(headers), [headers]);
  const form = useForm<CanonicalMappingFields>({ defaultValues });
  const values = normalizeFields({
    ...defaultValues,
    ...useWatch({ control: form.control }),
  });
  const duplicateHeaders = findDuplicateMappings(values);
  const hasCompanyIdentity = Boolean(values.company || values.website || values.domain);
  const hasContactIdentity = Boolean(values.email || values.contactLinkedin);

  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit((fields) => {
        const duplicates = findDuplicateMappings(fields);

        if (duplicates.length > 0) {
          form.setError("root", {
            message: "A source column can only be mapped once.",
          });
          return;
        }

        if (!fields.company && !fields.website && !fields.domain && !fields.email && !fields.contactLinkedin) {
          form.setError("root", {
            message: "Map at least one company identifier (company name, website, domain) or contact identifier (email, linkedin).",
          });
          return;
        }

        onSubmit(normalizeFields(fields));
      })}
    >
      <div className="rounded-lg border border-border bg-white">
        <div className="border-b border-border px-5 py-4">
          <div className="text-sm font-semibold text-foreground">Column mapping</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Map source CSV headers to canonical ingestion fields.
          </p>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2 lg:grid-cols-3">
          {CANONICAL_FIELDS.map(([field, label]) => (
            <label key={field} className="grid gap-1.5 text-sm">
              <span className="font-medium text-foreground">{label}</span>
              <select
                className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20"
                disabled={disabled}
                {...form.register(field)}
              >
                <option value="">Ignore</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="border-t border-border px-5 py-4 flex flex-col gap-3">
          {!hasCompanyIdentity && !hasContactIdentity ? (
            <div className="text-sm text-red-700">
              Map at least one company identifier or contact identifier.
            </div>
          ) : null}
          {duplicateHeaders.length > 0 ? (
            <div className="mt-1 text-sm text-red-700">
              Duplicate mapping: {duplicateHeaders.join(", ")}
            </div>
          ) : null}
          {form.formState.errors.root?.message ? (
            <div className="mt-1 text-sm text-red-700">
              {form.formState.errors.root.message}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={disabled || (!hasCompanyIdentity && !hasContactIdentity) || duplicateHeaders.length > 0}
            >
              Save mapping and run
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <div className="border-b border-border px-5 py-4">
          <div className="text-sm font-semibold text-foreground">Header preview</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Showing up to five parsed rows from the uploaded CSV.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40">
              <tr>
                {headers.map((header) => (
                  <th
                    key={header}
                    className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-normal text-muted-foreground"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {previewRows.map((row, index) => (
                <tr key={index}>
                  {headers.map((header) => (
                    <td key={header} className="max-w-56 truncate px-3 py-2 text-foreground">
                      {row[header] || "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </form>
  );
}

function buildDefaultValues(headers: string[]): CanonicalMappingFields {
  return {
    firstName: findHeader(headers, ["first name", "contact first name", "given name"]),
    lastName: findHeader(headers, ["last name", "contact last name", "surname"]),
    contact: findHeader(headers, ["contact", "contact name", "full name"]),
    email: findHeader(headers, ["email", "email 1", "work email", "contact email 1", "contact email"]),
    title: findHeader(headers, [
      "title", "job title", "jobtitle", "designation", "position", "role", "job role",
      "current title", "current position", "job function", "contact title", "contact job title",
    ]),
    department: findHeader(headers, ["department", "dept"]),
    seniority: findHeader(headers, ["seniority", "level"]),
    contactPhone: findHeader(headers, ["contact phone", "phone", "mobile", "direct phone"]),
    contactLinkedin: findHeader(headers, ["contact li url", "contact linkedin", "linkedin url"]),
    contactCity: findHeader(headers, ["contact city", "city"]),
    contactCountry: findHeader(headers, ["contact country", "country"]),

    company: findHeader(headers, ["company", "company name", "account name"]),
    website: findHeader(headers, ["website", "company website", "url"]),
    domain: findHeader(headers, ["domain", "canonical domain"]),
    linkedin: findHeader(headers, ["company linkedin", "company li url"]),
    companyPhone: findHeader(headers, ["company phone", "main phone"]),
    companyIndustry: findHeader(headers, ["company industry", "industry"]),
    companyCity: findHeader(headers, ["company city"]),
    companyCountry: findHeader(headers, ["company country"]),
    companyRevenue: findHeader(headers, ["company revenue", "revenue"]),
    companyStaffCount: findHeader(headers, ["company staff count", "staff count", "employees", "size"]),
  };
}

function findHeader(headers: string[], candidates: string[]) {
  const normalized = headers.map((header) => ({
    raw: header,
    key: header.toLowerCase().replace(/[_-]+/g, " ").trim(),
  }));
  const match = normalized.find((header) =>
    candidates.some((candidate) => header.key === candidate)
  );

  return match?.raw ?? null;
}

function findDuplicateMappings(fields: CanonicalMappingFields) {
  const used = new Map<string, number>();

  for (const value of Object.values(fields)) {
    if (!value) continue;
    used.set(value, (used.get(value) ?? 0) + 1);
  }

  return Array.from(used.entries())
    .filter(([, count]) => count > 1)
    .map(([header]) => header);
}

function normalizeFields(fields: CanonicalMappingFields): CanonicalMappingFields {
  return {
    firstName: fields.firstName || null,
    lastName: fields.lastName || null,
    contact: fields.contact || null,
    email: fields.email || null,
    title: fields.title || null,
    department: fields.department || null,
    seniority: fields.seniority || null,
    contactPhone: fields.contactPhone || null,
    contactLinkedin: fields.contactLinkedin || null,
    contactCity: fields.contactCity || null,
    contactCountry: fields.contactCountry || null,

    company: fields.company || null,
    website: fields.website || null,
    domain: fields.domain || null,
    linkedin: fields.linkedin || null,
    companyPhone: fields.companyPhone || null,
    companyIndustry: fields.companyIndustry || null,
    companyCity: fields.companyCity || null,
    companyCountry: fields.companyCountry || null,
    companyRevenue: fields.companyRevenue || null,
    companyStaffCount: fields.companyStaffCount || null,
  };
}
