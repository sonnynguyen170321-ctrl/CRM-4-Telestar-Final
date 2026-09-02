import { CircleCheck, CircleSlash, CircleAlert, ShieldX } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { queryProviderReadiness } from "@/lib/v2/settings/queryProviderReadiness";
import { queryOrgUsers, isOrgAdminRole } from "@/lib/v2/tenant/manageUsers";
import { UsersPanel } from "@/components/v2/settings/UsersPanel";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

type Status = "ready" | "partial" | "not_configured" | "blocked";

const STATUS_META: Record<Status, { label: string; cls: string; Icon: typeof CircleCheck }> = {
  ready: { label: "Ready", cls: "bg-emerald-50 text-emerald-700", Icon: CircleCheck },
  partial: { label: "Partial", cls: "bg-amber-50 text-amber-700", Icon: CircleAlert },
  not_configured: { label: "Not configured", cls: "bg-muted text-muted-foreground", Icon: CircleSlash },
  blocked: { label: "Blocked", cls: "bg-red-50 text-red-700", Icon: ShieldX },
};

function StatusChip({ status }: { status: Status }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${m.cls}`}>
      <m.Icon className="h-3.5 w-3.5" />
      {m.label}
    </span>
  );
}

function Row({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={ok ? "text-emerald-600" : "text-muted-foreground/50"}>{ok ? "Configured" : "Missing"}</span>
    </div>
  );
}

export default async function V2SettingsPage() {
  const context = await getSettingsContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-lg border border-border bg-card p-6">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const readiness = await queryProviderReadiness(context.organizationId);
  const { outreach, enrichment, ai } = readiness;
  const users = await queryOrgUsers(context.organizationId);
  const canManage = isOrgAdminRole(context.role);

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Settings"
        title="Provider & transport readiness"
        description="What is configured for outreach, enrichment, and AI. Secrets are never shown \u2014 only configured state."
      />

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-3">
        <PanelCard
          title="Outreach"
          actions={<StatusChip status={outreach.status as Status} />}
          contentClassName="p-5"
        >
          <div className="divide-y divide-hairline">
            <Row label="Credential key (V2_OUTREACH_CREDENTIAL_KEY)" ok={outreach.credentialKey} />
            <Row label="Background worker (V2_WORKER_SECRET)" ok={outreach.worker} />
            <Row label={`Sender accounts (${outreach.senders.relays} relay / ${outreach.senders.mailboxes} mailbox)`} ok={outreach.senders.total > 0} />
            <Row label="Live-send ready" ok={outreach.liveSendReady} />
          </div>
          {outreach.killSwitchEngaged && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm font-semibold text-red-700">
              Kill switch ENGAGED — all live sends are halted.
            </div>
          )}
          {outreach.notes.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {outreach.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </PanelCard>

        <PanelCard title="Enrichment" actions={<StatusChip status={enrichment.searchProvider as Status} />} contentClassName="p-5">
          <p className="text-sm text-muted-foreground">
            Web-search provider for company intelligence. When not configured, enrichment uses website-only
            deterministic facts.
          </p>
        </PanelCard>

        <PanelCard title="AI (advisory-only)" actions={<StatusChip status={ai.status as Status} />} contentClassName="p-5">
          <p className="text-sm text-muted-foreground">
            AI is advisory-only and never overwrites a final qualification.
          </p>
        </PanelCard>
      </div>

      <div className="px-5 pb-6 sm:px-6">
        <UsersPanel users={users} canManage={canManage} currentUserId={context.userId} />
      </div>
    </WorkspaceFrame>
  );
}

async function getSettingsContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
