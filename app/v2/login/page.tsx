import { redirect } from "next/navigation";
import { Activity, Database, KeyRound, ShieldCheck } from "lucide-react";

import {
  getTenantErrorMessage,
  requireTenantContext,
  V2TenantError,
} from "@/lib/v2/tenant";
import { LoginForm } from "./LoginForm";

export default async function V2LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const returnTo = sanitizeReturnTo(params.returnTo ?? "");

  try {
    await requireTenantContext();
    redirect(returnTo);
  } catch (error) {
    if (error instanceof V2TenantError && error.code !== "UNAUTHENTICATED") {
      return <DeniedState error={error} />;
    }
    if (!(error instanceof V2TenantError)) throw error;
  }

  return (
    <main className="-m-6 min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh lg:grid-cols-[1.08fr_0.92fr]">
        {/* Brand panel — a fixed premium dark surface (does not invert with theme). */}
        <section className="relative flex min-h-[420px] flex-col justify-between overflow-hidden bg-[#0a0f1c] px-6 py-8 text-white sm:px-10 lg:px-12">
          <div className="absolute inset-0 opacity-70" aria-hidden="true">
            <div className="h-full w-full bg-[radial-gradient(60%_50%_at_15%_10%,rgba(20,184,166,0.20),transparent_60%),radial-gradient(55%_45%_at_85%_100%,rgba(59,130,246,0.18),transparent_60%)]" />
          </div>
          <div className="relative z-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 backdrop-blur">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm font-semibold">Leadger</div>
              <div className="text-xs text-white/50">v2.0 platform access</div>
            </div>
          </div>

          <div className="relative z-10 max-w-2xl py-12 lg:py-0">
            <p className="text-sm font-medium text-cyan-300">Self-hosted identity</p>
            <h1 className="mt-4 max-w-xl text-4xl font-semibold leading-tight text-white sm:text-5xl">
              Sign in to your outbound command center.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-white/70">
              Local email/password auth, tenant-scoped access, and revocable database sessions built for VPS and AWS deployments.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <Signal icon={ShieldCheck} label="Tenant gated" />
              <Signal icon={Database} label="DB sessions" />
              <Signal icon={KeyRound} label="Admin provisioned" />
            </div>
          </div>

          <div className="relative z-10 grid gap-3 border-t border-white/10 pt-6 text-sm text-white/60 sm:grid-cols-3">
            <Metric label="Session" value="Revocable" />
            <Metric label="Deploy" value="VPS ready" />
            <Metric label="Access" value="CLI managed" />
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
              <div className="mb-6">
                <p className="text-sm font-medium text-muted-foreground">Welcome back</p>
                <h2 className="mt-2 text-2xl font-semibold text-foreground">Sign in</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Use the email and password provisioned by your Leadger admin CLI.
                </p>
              </div>
              <LoginForm returnTo={returnTo} />
            </div>
            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
              No public signup on this deployment. Ask an owner to run <code className="rounded bg-muted px-1 py-0.5">npm run v2:signup</code>.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Signal({ icon: Icon, label }: { icon: typeof ShieldCheck; label: string }) {
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white/75 backdrop-blur">
      <Icon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-1 font-medium text-white">{value}</div>
    </div>
  );
}

function DeniedState({ error }: { error: V2TenantError }) {
  const message = getTenantErrorMessage(error);

  return (
    <main className="-m-6 flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="mt-5 text-xs font-medium uppercase tracking-wide text-red-600 dark:text-red-400">Access denied</div>
        <h1 className="mt-2 text-xl font-semibold text-foreground">{message.title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{message.message}</p>
        {message.actionHref && message.actionLabel && (
          <a
            href={message.actionHref}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted/50 focus:outline-none focus:ring-4 focus:ring-border"
          >
            {message.actionLabel}
          </a>
        )}
        <p className="mt-4 text-[11px] text-muted-foreground/60">Ref: {message.technicalCode}</p>
      </div>
    </main>
  );
}

function sanitizeReturnTo(value: string): string {
  if (!value || !value.startsWith("/v2/") || value.startsWith("/v2/login") || value.startsWith("/v2/logout")) {
    return "/v2/workspace/leads";
  }
  return value;
}
