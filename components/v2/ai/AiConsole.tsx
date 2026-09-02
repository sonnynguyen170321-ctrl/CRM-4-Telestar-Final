"use client";

import { useActionState, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Cpu,
  Gauge,
  KeyRound,
  Plug,
  Timer,
  Zap,
} from "lucide-react";

import { PanelCard } from "@/components/shared/PanelCard";
import { formatDateTime } from "@/lib/v2/format/datetime";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shared/Tabs";
import { V2ActionButton } from "@/components/shared/V2ActionButton";
import {
  saveAiRateLimitAction,
  saveAiSettingsAction,
  testConnectionAction,
  type ActionResult,
  type TestConnectionState,
} from "@/app/v2/ai/actions";
import { AI_PROVIDERS, type AiModelDef, type AiProviderKind } from "@/lib/v2/ai/types";
import type { AiConsoleData, AiProviderView } from "@/lib/v2/ai/queryAiConsole";

const PROVIDER_LABEL: Record<AiProviderKind, string> = { GEMINI: "Google Gemini", OPENAI: "OpenAI", ANTHROPIC: "Anthropic" };
const MODE_LABEL: Record<string, string> = { OFF: "Off", UNCERTAIN_ONLY: "Uncertain only", ALL: "All companies" };

const STATUS_CLS: Record<string, string> = {
  OK: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  SKIPPED: "bg-muted text-muted-foreground ring-border/20",
  TIMEOUT: "bg-amber-50 text-amber-700 ring-amber-600/20",
  RATE_LIMITED: "bg-amber-50 text-amber-700 ring-amber-600/20",
  ERROR: "bg-red-50 text-red-700 ring-red-600/20",
};

export function AiConsole({ data, canManage }: { data: AiConsoleData; canManage: boolean }) {
  return (
    <div className="space-y-5">
      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5">
          <OverviewTab data={data} canManage={canManage} />
        </TabsContent>
        <TabsContent value="providers" className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-3">
            {data.providers.map((p) => (
              <ProviderCard key={p.provider} provider={p} canManage={canManage} />
            ))}
          </div>
        </TabsContent>
        <TabsContent value="models" className="space-y-5">
          <ModelsTab models={data.models} defaultModelId={data.settings.defaultModelId} />
        </TabsContent>
        <TabsContent value="history" className="space-y-5">
          <HistoryTab data={data} />
        </TabsContent>
        <TabsContent value="logs" className="space-y-5">
          <LogsTab data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------- Overview ----------------
function OverviewTab({ data, canManage }: { data: AiConsoleData; canManage: boolean }) {
  const { settings, health } = data;
  const successPct = health.successRate == null ? null : Math.round(health.successRate * 100);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Zap} label="AI engine" value={settings.enabled ? "Enabled" : "Disabled"} tone={settings.enabled ? "ok" : "muted"} sub={`Mode: ${MODE_LABEL[settings.mode] ?? settings.mode}`} />
        <Metric icon={Gauge} label="Credits today" value={`${data.creditsUsedToday} / ${settings.dailyCreditBudget}`} tone={data.budgetPercentUsed >= 90 ? "warn" : "default"} sub={`${data.budgetPercentUsed}% of daily budget`} />
        <Metric icon={Activity} label="Success (24h)" value={successPct == null ? "—" : `${successPct}%`} tone={successPct != null && successPct < 80 ? "warn" : "default"} sub={`${health.total} calls`} />
        <Metric icon={Timer} label="Avg latency (24h)" value={health.avgLatencyMs == null ? "—" : `${health.avgLatencyMs}ms`} tone="default" sub={`${health.errors} errors · ${health.timeouts} timeouts`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <PanelCard title="Daily credit budget" description="1 credit = 1 AI request. AI never runs once the budget is spent." className="lg:col-span-1" contentClassName="p-5">
          <BudgetGauge percent={data.budgetPercentUsed} used={data.creditsUsedToday} remaining={data.creditsRemaining} />
        </PanelCard>
        <PanelCard title="Usage — last 14 days" description="Requests per day" className="lg:col-span-2" contentClassName="p-5">
          <UsageChart points={data.usage} />
        </PanelCard>
      </div>

      <PanelCard title="Engine settings" description="AI is advisory only and never overwrites a final qualification." contentClassName="p-5">
        {canManage ? <SettingsForm data={data} /> : <p className="text-sm text-muted-foreground">You need the AI admin permission to change these settings.</p>}
      </PanelCard>
    </>
  );
}

function SettingsForm({ data }: { data: AiConsoleData }) {
  const { settings, models } = data;
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveAiSettingsAction, null);
  const [provider, setProvider] = useState<AiProviderKind>(settings.provider);
  const providerModels = models.filter((m) => m.provider === provider);

  return (
    <form action={action} className="space-y-5">
      <label className="flex items-center gap-3">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="h-4 w-4 rounded border-border text-[#0F5BF4]" />
        <span className="text-sm font-medium text-foreground">Enable AI enrichment + reasoning</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="When to run AI">
          <select name="mode" defaultValue={settings.mode} className={inputCls}>
            <option value="OFF">Off</option>
            <option value="UNCERTAIN_ONLY">Uncertain only (recommended)</option>
            <option value="ALL">All companies</option>
          </select>
        </Field>
        <Field label="Provider">
          <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value as AiProviderKind)} className={inputCls}>
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
            ))}
          </select>
        </Field>
        <Field label="Default model">
          <select name="defaultModelId" defaultValue={settings.defaultModelId ?? providerModels[0]?.modelId} key={provider} className={inputCls}>
            {providerModels.map((m) => (
              <option key={m.modelId} value={m.modelId}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Daily credit budget">
          <input type="number" name="dailyCreditBudget" min={0} defaultValue={settings.dailyCreditBudget} className={inputCls} />
        </Field>
        <Field label="Max AI rows / upload">
          <input type="number" name="maxRowsPerUpload" min={1} defaultValue={settings.maxRowsPerUpload} className={inputCls} />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <V2ActionButton type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</V2ActionButton>
        {state ? <span className={`text-sm ${state.ok ? "text-emerald-600" : "text-red-600"}`}>{state.message}</span> : null}
      </div>
    </form>
  );
}

// ---------------- Providers ----------------
function ProviderCard({ provider, canManage }: { provider: AiProviderView; canManage: boolean }) {
  const [test, testAction, testing] = useActionState<TestConnectionState | null, FormData>(testConnectionAction, null);
  const [rate, rateAction, savingRate] = useActionState<ActionResult | null, FormData>(saveAiRateLimitAction, null);

  return (
    <PanelCard
      title={
        <span className="inline-flex items-center gap-2">
          <Plug className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {PROVIDER_LABEL[provider.provider]}
        </span>
      }
      actions={<KeyChip present={provider.keyPresent} />}
      contentClassName="space-y-4 p-5"
    >
      <dl className="space-y-1.5 text-sm">
        <Row label="API key env" value={<code className="text-xs text-muted-foreground">{provider.envKey}</code>} />
        <Row label="Last health" value={<HealthValue v={provider} />} />
      </dl>

      {canManage && provider.keyPresent ? (
        <form action={testAction}>
          <input type="hidden" name="provider" value={provider.provider} />
          <V2ActionButton type="submit" variant="secondary" size="sm" disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </V2ActionButton>
          {test ? <span className={`ml-3 text-xs ${test.ok ? "text-emerald-600" : "text-red-600"}`}>{test.message}</span> : null}
        </form>
      ) : null}

      {canManage ? (
        <form action={rateAction} className="space-y-3 border-t border-border pt-4">
          <input type="hidden" name="provider" value={provider.provider} />
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rate limit</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Requests / min"><input type="number" name="rpmSoftLimit" min={0} defaultValue={provider.rateLimit.rpmSoftLimit} className={inputCls} /></Field>
            <Field label="Tokens / min"><input type="number" name="tpmSoftLimit" min={0} defaultValue={provider.rateLimit.tpmSoftLimit} className={inputCls} /></Field>
            <Field label="Max retries"><input type="number" name="maxRetries" min={0} max={10} defaultValue={provider.rateLimit.maxRetries} className={inputCls} /></Field>
            <Field label="Request delay (ms)"><input type="number" name="requestDelayMs" min={0} defaultValue={provider.rateLimit.requestDelayMs} className={inputCls} /></Field>
          </div>
          <div className="flex items-center gap-3">
            <V2ActionButton type="submit" variant="secondary" size="sm" disabled={savingRate}>{savingRate ? "Saving…" : "Save limits"}</V2ActionButton>
            {rate ? <span className={`text-xs ${rate.ok ? "text-emerald-600" : "text-red-600"}`}>{rate.message}</span> : null}
          </div>
        </form>
      ) : null}
    </PanelCard>
  );
}

function HealthValue({ v }: { v: AiProviderView }) {
  if (v.lastHealthOk == null) return <span className="text-muted-foreground">Never tested</span>;
  return (
    <span className={v.lastHealthOk ? "text-emerald-600" : "text-red-600"}>
      {v.lastHealthOk ? "OK" : "Failed"}
      {v.lastHealthLatencyMs != null ? ` · ${v.lastHealthLatencyMs}ms` : ""}
      {v.lastHealthAt ? ` · ${formatDateTime(v.lastHealthAt)}` : ""}
    </span>
  );
}

// ---------------- Models ----------------
function ModelsTab({ models, defaultModelId }: { models: AiModelDef[]; defaultModelId: string | null }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {AI_PROVIDERS.map((provider) => (
        <PanelCard key={provider} title={PROVIDER_LABEL[provider]} contentClassName="divide-y divide-border p-0">
          {models.filter((m) => m.provider === provider).map((m) => (
            <div key={m.modelId} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Cpu className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  {m.label}
                  {m.modelId === defaultModelId ? <span className="rounded-full bg-[#0F5BF4]/10 px-2 py-0.5 text-[10px] font-semibold text-[#0F5BF4]">Default</span> : null}
                </div>
                <code className="text-xs text-muted-foreground">{m.modelId}</code>
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                <div>{m.maxOutputTokens} tok</div>
                <div>temp {m.defaultTemperature}</div>
              </div>
            </div>
          ))}
        </PanelCard>
      ))}
    </div>
  );
}

// ---------------- History ----------------
function HistoryTab({ data }: { data: AiConsoleData }) {
  if (data.usage.length === 0) return <Empty label="No AI usage recorded yet." />;
  return (
    <PanelCard title="Daily usage" contentClassName="p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-5 py-2.5 font-semibold">Date</th>
            <th className="px-5 py-2.5 text-right font-semibold">Requests</th>
            <th className="px-5 py-2.5 text-right font-semibold">Credits</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {[...data.usage].reverse().map((u) => (
            <tr key={u.date}>
              <td className="px-5 py-2.5 text-foreground">{u.date}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-foreground">{u.requests}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-foreground">{u.credits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PanelCard>
  );
}

// ---------------- Logs ----------------
function LogsTab({ data }: { data: AiConsoleData }) {
  if (data.runLog.length === 0) return <Empty label="No AI runs logged yet." />;
  return (
    <PanelCard title="Recent AI runs" description="Append-only run log (latest 50)" contentClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-2.5 font-semibold">Time</th>
              <th className="px-4 py-2.5 font-semibold">Provider</th>
              <th className="px-4 py-2.5 font-semibold">Model</th>
              <th className="px-4 py-2.5 font-semibold">Purpose</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 text-right font-semibold">Latency</th>
              <th className="px-5 py-2.5 text-right font-semibold">Credits</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.runLog.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2.5 whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                <td className="px-4 py-2.5 text-foreground">{r.provider}</td>
                <td className="px-4 py-2.5"><code className="text-xs text-muted-foreground">{r.modelId}</code></td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.purpose}</td>
                <td className="px-4 py-2.5"><StatusChip status={r.status} code={r.errorCode} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{r.latencyMs != null ? `${r.latencyMs}ms` : "—"}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">{r.creditsUsed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelCard>
  );
}

// ---------------- shared bits ----------------
const inputCls = "h-9 w-full rounded-md border border-hairline bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground font-medium">{value}</dd>
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, tone = "default" }: { icon: typeof Zap; label: string; value: string; sub?: string; tone?: "default" | "ok" | "warn" | "muted" }) {
  const toneCls = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "muted" ? "text-muted-foreground/60" : "text-foreground";
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tracking-tight ${toneCls}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function BudgetGauge({ percent, used, remaining }: { percent: number; used: number; remaining: number }) {
  return (
    <div>
      <div className="flex items-end justify-between">
        <div className="text-3xl font-semibold text-foreground">{percent}%</div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{used} used</div>
          <div>{remaining} left</div>
        </div>
      </div>
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className={`h-full rounded-full ${percent >= 90 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}

function UsageChart({ points }: { points: AiConsoleData["usage"] }) {
  if (points.length === 0) return <Empty label="No usage in the last 14 days." />;
  const max = Math.max(1, ...points.map((p) => p.requests));
  return (
    <div className="flex h-40 items-end gap-1.5">
      {points.map((p) => (
        <div key={p.date} className="group flex flex-1 flex-col items-center gap-1.5" title={`${p.date}: ${p.requests} req · ${p.credits} credits`}>
          <div className="flex w-full flex-1 items-end">
            <div className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(2, (p.requests / max) * 100)}%` }} />
          </div>
          <div className="text-[9px] text-muted-foreground">{p.date.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}

function KeyChip({ present }: { present: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${present ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-secondary text-muted-foreground ring-border"}`}>
      {present ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
      {present ? "Key set" : "No key"}
    </span>
  );
}

function StatusChip({ status, code }: { status: string; code: string | null }) {
  const cls = STATUS_CLS[status] ?? STATUS_CLS.ERROR;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`} title={code ?? undefined}>
      {status === "OK" ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : status === "SKIPPED" ? <CircleSlash className="h-3 w-3" aria-hidden="true" /> : <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
      {status}
    </span>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-hairline bg-surface px-5 py-10 text-center text-sm text-muted-foreground shadow-sm">
      {label}
    </div>
  );
}
