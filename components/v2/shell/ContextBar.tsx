"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import type { LeadContextOptions } from "@/lib/v2/crm";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon } from "lucide-react";

type ContextBarProps = {
  options: LeadContextOptions;
  organizationName: string;
};

const HIDDEN_PATHS = new Set(["/v2/login", "/v2/logout"]);
const RESET_ON_CONTEXT_CHANGE = new Set(["page", "selectedLeadId", "companyId", "leadPage"]);

export function ContextBar({ options, organizationName }: ContextBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientAccountId = searchParams.get("clientAccountId") ?? "";
  const projectId = searchParams.get("projectId") ?? "";
  const offerId = searchParams.get("offerId") ?? "";
  const icpVersionId = searchParams.get("icpVersionId") ?? "";

  const selectedAccount =
    options.accounts.find((account) => account.id === clientAccountId) ?? null;
  const availableProjects = selectedAccount?.projects ?? [];
  const selectedProject =
    availableProjects.find((project) => project.id === projectId) ?? null;
  const availableOffers = selectedProject?.offers ?? [];
  const selectedOffer =
    availableOffers.find((offer) => offer.id === offerId) ?? null;
  const availableIcpVersions = selectedOffer
    ? selectedOffer.icpVersions
    : selectedProject?.icpVersions ?? [];

  const hasFullContext = Boolean(
    clientAccountId && projectId && icpVersionId
  );

  if (HIDDEN_PATHS.has(pathname)) {
    return null;
  }

  function updateContext(
    updates: Partial<{
      clientAccountId: string;
      projectId: string;
      offerId: string;
      icpVersionId: string;
    }>
  ) {
    const params = new URLSearchParams(searchParams.toString());

    for (const key of RESET_ON_CONTEXT_CHANGE) {
      params.delete(key);
    }

    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }

    const nextQuery = params.toString();
    router.push(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  function useFirstCompleteContext() {
    for (const account of options.accounts) {
      for (const project of account.projects) {
        if (project.icpVersions && project.icpVersions.length > 0) {
          const firstIcp = project.icpVersions[0];
          updateContext({
            clientAccountId: account.id,
            projectId: project.id,
            offerId: firstIcp.offerId,
            icpVersionId: firstIcp.id,
          });
          return;
        }
      }
    }
  }

  const hasAnyCompleteContext = options.accounts.some((acc) =>
    acc.projects.some((proj) => proj.icpVersions && proj.icpVersions.length > 0)
  );

  return (
    <section className="flex flex-col border-b border-border bg-white">
      {/* Context Selection */}
      <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex-1 min-w-[280px]">
          <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
            Context
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground flex flex-wrap gap-2 items-center">
            {hasFullContext ? (
              <span>Scores scoped by Account, Project, Offer, and ICP</span>
            ) : (
              <span>Choose a full context to make lead scores meaningful</span>
            )}
            {!hasFullContext && hasAnyCompleteContext && (
              <Button onClick={useFirstCompleteContext} size="sm" variant="secondary" className="h-7 text-xs">
                Use first complete context
              </Button>
            )}
          </div>
          {!hasFullContext && !hasAnyCompleteContext && (
            <div className="mt-2 flex items-center gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 border border-amber-200">
              <AlertCircleIcon className="h-4 w-4 shrink-0" />
              <span>No complete context available. You must create an</span>
              <Link href="/v2/workspace/accounts" className="font-semibold hover:underline">Account</Link>
              <span>{'>'}</span>
              <Link href="/v2/workspace/accounts?view=projects" className="font-semibold hover:underline">Project</Link>
              <span>{'>'}</span>
              <Link href="/v2/workspace/accounts?view=offers" className="font-semibold hover:underline">Offer</Link>
              <span>{'>'}</span>
              <Link href="/v2/icp-library" className="font-semibold hover:underline">ICP</Link>
            </div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            Organization: {organizationName}
          </div>
        </div>
        <div className="grid w-full gap-2 md:w-auto md:grid-cols-4">
          <ContextSelect
            label="Account"
            value={clientAccountId}
            placeholder="Select account"
            options={options.accounts.map((account) => ({
              value: account.id,
              label: account.name,
            }))}
            onChange={(value) =>
              updateContext({
                clientAccountId: value,
                projectId: "",
                offerId: "",
                icpVersionId: "",
              })
            }
          />
          <ContextSelect
            label="Project"
            value={projectId}
            placeholder={
              clientAccountId ? "Select project" : "Select account first"
            }
            disabled={!clientAccountId}
            options={availableProjects.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
            onChange={(value) =>
              updateContext({
                clientAccountId,
                projectId: value,
                offerId: "",
                icpVersionId: "",
              })
            }
          />
          <ContextSelect
            label="Offer"
            value={offerId}
            placeholder={
              projectId ? "Select offer" : "Select project first"
            }
            disabled={!projectId}
            options={availableOffers.map((offer) => ({
              value: offer.id,
              label: offer.name,
            }))}
            onChange={(value) =>
              updateContext({
                clientAccountId,
                projectId,
                offerId: value,
                icpVersionId: "",
              })
            }
          />
          <ContextSelect
            label="ICP"
            value={icpVersionId}
            placeholder={projectId ? "Select ICP" : "Select project first"}
            disabled={!projectId}
            options={availableIcpVersions.map((version) => ({
              value: version.id,
              label: version.label,
            }))}
            onChange={(value) => {
              const selectedVersion = availableIcpVersions.find((v) => v.id === value);
              updateContext({
                clientAccountId,
                projectId,
                offerId: selectedVersion?.offerId ?? offerId,
                icpVersionId: value,
              });
            }}
          />
        </div>
      </div>
    </section>
  );
}

function ContextSelect({
  label,
  value,
  placeholder,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-48 text-xs font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-input bg-white px-2 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
