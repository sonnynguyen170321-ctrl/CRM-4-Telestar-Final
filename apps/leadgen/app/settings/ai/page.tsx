import { Bot, CheckCircle2, CircleAlert } from "lucide-react";

import { AiConnectionTest } from "@/app/settings/ai/AiConnectionTest";
import { AiRuntimeSettingsForm } from "@/app/settings/ai/AiRuntimeSettingsForm";
import { MetricCard } from "@/components/shared/MetricCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/statusBadges";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getEffectiveAiStatus } from "@/lib/server/ai/runtimeSettings";

// DB-backed page — render per request, never prerender at build (no DB in CI/Docker build).
export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const status = await getEffectiveAiStatus();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operator status"
        title="AI settings"
        description="AI runtime usage can be toggled here. Provider, model, and API key remain server-side environment configuration."
        actions={
          <StatusBadge
            tone={status.usable ? "success" : status.enabled ? "danger" : "neutral"}
          >
            {status.usable ? "Usable" : status.enabled ? "Needs config" : "Disabled"}
          </StatusBadge>
        }
        className="rounded-md border shadow-xs"
      />

      <Card className="rounded-md">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Runtime status</CardTitle>
            <Badge variant={status.usable ? "secondary" : "outline"}>
              {status.usable ? "Usable" : "Not usable"}
            </Badge>
          </div>
          <CardDescription>
            Safe configuration snapshot. GEMINI_API_KEY remains server-side
            only and is never shown in the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="AI enabled" value={yesNo(status.enabled)} icon={Bot} />
            <MetricCard label="Provider" value={status.provider} icon={Bot} />
            <MetricCard label="Model" value={status.model} icon={Bot} />
            <MetricCard label="Mode" value={formatMode(status.mode)} icon={Bot} />
            <MetricCard
              label="Max rows per upload"
              value={status.maxRowsPerUpload.toLocaleString()}
              icon={Bot}
            />
            <MetricCard
              label="API key configured"
              value={yesNo(status.keyConfigured)}
              icon={Bot}
            />
            <MetricCard label="Usable" value={yesNo(status.usable)} icon={Bot} />
          </div>

          <div
            className={`flex gap-3 rounded-md border p-3 text-sm ${
              status.usable
                ? "bg-muted/30 text-muted-foreground"
                : "border-destructive/40 bg-destructive/5 text-destructive"
            }`}
          >
            {status.usable ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <p>
              {status.usable
                ? "AI provider configuration is usable for a small connection test."
                : status.reason}
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
            AI can run for all companies or uncertain rows only depending on
            runtime mode, remains capped per upload/provider/model/prompt/mode,
            and is displayed as a second opinion. The companies table and CSV
            export continue to use local score results plus SDR feedback
            overlays.
          </div>
          <div className="rounded-md border bg-background p-3 text-sm leading-6 text-muted-foreground">
            Use the controls below to enable or disable runtime AI usage and
            choose the assessment mode. Provider, model, and raw API keys are
            still configured in the server environment and are never rendered
            in this UI.
          </div>
          <div className="rounded-md border bg-blue-50 p-3 text-sm leading-6 text-blue-800">
            Company drawer actions queue AI assessment jobs only. A separate
            server-side worker must be running to complete them. Gemini
            quota/rate limits can pause jobs for retry; local scoring and SDR
            review remain official while jobs wait.
          </div>
          <div className="rounded-md border bg-background p-3 text-sm leading-6 text-muted-foreground">
            <p className="font-medium text-foreground">
              Queue worker commands
            </p>
            <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs text-foreground">
              npm run ai:worker
            </code>
            <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs text-foreground">
              npm run ai:worker -- --uploadJobId=&lt;upload-id&gt;
            </code>
            <p className="mt-2">
              The worker reads server-side environment values, including the
              protected job secret. Do not put AI job secrets or provider keys
              in browser-visible variables.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Runtime controls</CardTitle>
          <CardDescription>
            Toggle AI usage for uploads without exposing provider secrets. These
            settings override AI_ENABLED, AI_SCORING_MODE, and
            AI_MAX_ROWS_PER_UPLOAD at runtime.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AiRuntimeSettingsForm
            initialEnabled={status.enabled}
            initialMode={status.mode}
            initialMaxRowsPerUpload={status.maxRowsPerUpload}
          />
        </CardContent>
      </Card>

      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Connection test</CardTitle>
          <CardDescription>
            Sends one tiny generic prompt through the configured provider when
            AI is enabled and usable. It does not persist data or score
            companies.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AiConnectionTest />
        </CardContent>
      </Card>
    </div>
  );
}

function yesNo(value: boolean) {
  return value ? "yes" : "no";
}

function formatMode(value: string) {
  if (value === "all_companies") {
    return "all companies";
  }

  if (value === "uncertain_only") {
    return "uncertain only";
  }

  return value;
}
