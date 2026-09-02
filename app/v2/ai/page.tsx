import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { AiConsole } from "@/components/v2/ai/AiConsole";
import { queryAiConsole } from "@/lib/v2/ai/queryAiConsole";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

// AI4: the AI engine console. Admin-gated (ai.admin). Governs the optional, advisory
// LLM enrichment/reasoning engine — enable/disable, provider + model, daily credit
// budget, per-provider rate limits, connection health, usage, and the run log. Keys
// are never shown (only "key set" booleans); secrets live in server env (Invariant 9).

export default async function V2AiPage() {
  const context = await getAiContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-xl border border-hairline bg-surface p-6 shadow-premium">
          <div className="text-sm font-bold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const data = await queryAiConsole(context.organizationId);

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="AI engine"
        title="AI enrichment & reasoning"
        description="Optional, advisory AI that grounds company intelligence in real evidence. It never overwrites a final qualification, and never runs once the daily budget is spent."
      />
      <div className="p-5 sm:p-6">
        <AiConsole data={data} canManage />
      </div>
    </WorkspaceFrame>
  );
}

async function getAiContext() {
  try {
    return await requirePermission("ai.admin");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
