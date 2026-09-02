import type { ReactNode } from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Activity, ArrowLeft, Check, CheckCircle2, Gauge, KeyRound, Lock, Plus, RadioTower, Server, X as XIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { ActionQueue, DataState, InsightStrip, OutreachMetricTile, OutreachPanel, OutreachPill, ReadinessChecklist, type ReadinessItem } from "@/components/v2/outreach/OutreachCommandPrimitives";
import { SenderRowMenu } from "@/components/v2/outreach/SenderRowMenu";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";
import { prisma } from "@/lib/server/prisma";
import { createSender, type CreateSenderDb } from "@/lib/v2/outreach/senders/createSender";
import { checkDomainReadiness, type DomainReadiness } from "@/lib/v2/outreach/senders/domainReadiness";
import { resolveTransportMode } from "@/lib/v2/outreach/send/transportMode";
import { isKillSwitchEngaged } from "@/lib/v2/outreach/limits/liveSendGuards";
import {
  verifySenderConnection,
  SENDER_VERIFY_ERROR_LABELS,
  type SenderVerifyError,
} from "@/lib/v2/outreach/senders/verifySenderConnection";
import {
  listTrackingDomains,
  addTrackingDomain,
  verifyTrackingDomain,
  type TrackingDomainRow,
} from "@/lib/v2/outreach/tracking/manageTrackingDomain";

// OL4 write path: add a sender with ENCRYPTED credentials (B1). Gated on
// outreach.admin; new senders always start liveSendEnabled=false.
async function addSenderAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const str = (k: string) => (formData.get(k)?.toString() ?? "").trim();
  const num = (k: string) => Number(formData.get(k)?.toString() ?? "");
  const kind = str("kind") === "RELAY" ? "RELAY" : "MAILBOX";
  try {
    await createSender(prisma as unknown as CreateSenderDb, {
      organizationId: context.organizationId,
      createdByUserId: context.userId,
      kind,
      displayName: str("displayName"),
      fromAddress: str("fromAddress"),
      fromName: str("fromName") || null,
      domain: str("domain"),
      smtpHost: str("smtpHost"),
      smtpPort: num("smtpPort"),
      smtpSecure: str("smtpSecure") !== "false",
      smtpUser: str("smtpUser"),
      smtpPass: str("smtpPass"),
      imapHost: str("imapHost") || null,
      imapPort: str("imapPort") ? num("imapPort") : null,
      imapSecure: str("imapHost") ? str("imapSecure") !== "false" : null,
      imapUser: str("imapUser") || null,
      imapPass: str("imapPass") || null,
      returnPathAddress: str("returnPathAddress") || null,
      dailyCapTarget: str("dailyCapTarget") ? num("dailyCapTarget") : 0,
    });
  } catch {
    // Fail closed (e.g. missing V2_OUTREACH_CREDENTIAL_KEY or invalid input):
    // no plaintext stored. The page reloads without the new sender.
  }
  revalidatePath("/v2/outreach/senders");
}

// O9 cutover toggle: flip liveSendEnabled for one sender. Gated on
// outreach.admin. Going live is refused unless V2_OUTREACH_CREDENTIAL_KEY is
// present - without the master key the send path can't decrypt SMTP creds and
// would fail closed anyway, so we don't pretend a sender is live.
async function setLiveSendAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const senderId = (formData.get("senderId")?.toString() ?? "").trim();
  const enable = formData.get("enable")?.toString() === "1";
  if (!senderId) return;
  if (enable && !process.env.V2_OUTREACH_CREDENTIAL_KEY) {
    // Can't go live without the decryption key - leave it gated.
    revalidatePath("/v2/outreach/senders");
    return;
  }
  if (enable) {
    // S6b: verify-before-activate. A sender cannot go live until its connection
    // has passed (verifiedAt set, no outstanding verify error).
    const vrows = await prisma.$queryRawUnsafe<Array<{ verifiedAt: Date | null }>>(
      `SELECT "verifiedAt" FROM "V2SenderAccount"
       WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL
         AND "verifiedAt" IS NOT NULL AND "lastVerifyError" IS NULL LIMIT 1`,
      senderId,
      context.organizationId
    );
    if (!vrows[0]) {
      revalidatePath("/v2/outreach/senders");
      return;
    }
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "V2SenderAccount" SET "liveSendEnabled" = $3, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL`,
    senderId,
    context.organizationId,
    enable
  );
  revalidatePath("/v2/outreach/senders");
}

// Warmup + cap controls (outreach.admin). Warmup ramps sending volume; the cap
// bounds daily sends. Both are sender-health levers, not a send path.
const DEFAULT_BULK_WARMUP_CAP = 30;

async function enableSenderFleetDefaultsAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }

  const requestedCap = Math.trunc(Number(formData.get("cap")?.toString() ?? DEFAULT_BULK_WARMUP_CAP));
  const cap = Number.isFinite(requestedCap) ? Math.max(1, Math.min(100000, requestedCap)) : DEFAULT_BULK_WARMUP_CAP;
  const trackingRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "V2TrackingDomain"
     WHERE "organizationId" = $1 AND "status" = 'VERIFIED' AND "deletedAt" IS NULL
     ORDER BY "createdAt" ASC
     LIMIT 1`,
    context.organizationId
  );
  const trackingDomainId = trackingRows[0]?.id ?? null;
  const canEnableLive = Boolean(process.env.V2_OUTREACH_CREDENTIAL_KEY);

  await prisma.$executeRawUnsafe(
    `UPDATE "V2SenderAccount"
       SET "warmupStartedAt" = COALESCE("warmupStartedAt", CURRENT_TIMESTAMP),
           "warmupStage" = CASE WHEN "warmupStage" < 1 THEN 1 ELSE "warmupStage" END,
           "dailyCapTarget" = CASE WHEN "dailyCapTarget" = 0 THEN $2 ELSE "dailyCapTarget" END,
           "trackingDomainId" = CASE
             WHEN "trackingDomainId" IS NULL AND $3::text IS NOT NULL THEN $3
             ELSE "trackingDomainId"
           END,
           "liveSendEnabled" = CASE
             WHEN $4 = true AND "verifiedAt" IS NOT NULL AND "lastVerifyError" IS NULL THEN true
             ELSE "liveSendEnabled"
           END,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = $1 AND "deletedAt" IS NULL AND "status" = 'ACTIVE'`,
    context.organizationId,
    cap,
    trackingDomainId,
    canEnableLive
  );
  revalidatePath("/v2/outreach/senders");
}

async function setWarmupAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const senderId = (formData.get("senderId")?.toString() ?? "").trim();
  const enable = formData.get("enable")?.toString() === "1";
  if (!senderId) return;
  await prisma.$executeRawUnsafe(
    `UPDATE "V2SenderAccount"
       SET "warmupStartedAt" = $3, "warmupStage" = $4, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL`,
    senderId,
    context.organizationId,
    enable ? new Date() : null,
    enable ? 1 : 0
  );
  revalidatePath("/v2/outreach/senders");
}

async function setDailyCapAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const senderId = (formData.get("senderId")?.toString() ?? "").trim();
  const cap = Math.max(0, Math.min(100000, Math.trunc(Number(formData.get("cap")?.toString() ?? "0"))));
  if (!senderId || !Number.isFinite(cap)) return;
  await prisma.$executeRawUnsafe(
    `UPDATE "V2SenderAccount" SET "dailyCapTarget" = $3, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL`,
    senderId,
    context.organizationId,
    cap
  );
  revalidatePath("/v2/outreach/senders");
}

async function setSenderSignatureAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const senderId = (formData.get("senderId")?.toString() ?? "").trim();
  const raw = (formData.get("signatureHtml")?.toString() ?? "").trim();
  if (!senderId) return;
  const signature = raw ? raw.slice(0, 10000) : null;
  await prisma.$executeRawUnsafe(
    `UPDATE "V2SenderAccount" SET "signatureHtml" = $3, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL`,
    senderId,
    context.organizationId,
    signature
  );
  revalidatePath("/v2/outreach/senders");
}

// CTD: add + verify a tracking domain (outreach.admin). Verify checks the CNAME
// and flips status; tracking can only be enabled once VERIFIED (contract section 5).
async function addTrackingDomainAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const hostname = (formData.get("hostname")?.toString() ?? "").trim();
  if (!hostname) return;
  await addTrackingDomain({
    organizationId: context.organizationId,
    hostname,
    createdByUserId: context.userId,
  });
  revalidatePath("/v2/outreach/senders");
}

async function verifyTrackingDomainAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const id = (formData.get("trackingDomainId")?.toString() ?? "").trim();
  if (!id) return;
  await verifyTrackingDomain({ organizationId: context.organizationId, id });
  revalidatePath("/v2/outreach/senders");
}

// Attach (or detach) a VERIFIED tracking domain to a sender. Only a verified
// domain enables open/click tracking on this sender's sends (outreach.admin).
async function setSenderTrackingDomainAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const senderId = (formData.get("senderId")?.toString() ?? "").trim();
  const trackingDomainId = (formData.get("trackingDomainId")?.toString() ?? "").trim() || null;
  if (!senderId) return;
  if (trackingDomainId) {
    const ok = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "V2TrackingDomain"
       WHERE "id" = $1 AND "organizationId" = $2 AND "status" = 'VERIFIED' AND "deletedAt" IS NULL LIMIT 1`,
      trackingDomainId,
      context.organizationId
    );
    if (!ok[0]) {
      revalidatePath("/v2/outreach/senders");
      return;
    }
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "V2SenderAccount" SET "trackingDomainId" = $3, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL`,
    senderId,
    context.organizationId,
    trackingDomainId
  );
  revalidatePath("/v2/outreach/senders");
}

// S6b: verify a sender's SMTP/IMAP connection on demand and record the result.
// Gated on outreach.admin (sender connection is an admin action, contract section 3.1).
// Decrypted creds live only inside verifySenderConnection; only a fixed category
// is persisted - never the credential (Invariant 9).
async function testSenderConnectionAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("outreach.admin");
  } catch {
    return;
  }
  const senderId = (formData.get("senderId")?.toString() ?? "").trim();
  if (!senderId) return;

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      smtpHost: string;
      smtpPort: number;
      smtpSecure: boolean;
      smtpAuthEnc: unknown;
      imapHost: string | null;
      imapPort: number | null;
      imapSecure: boolean | null;
      imapAuthEnc: unknown;
      fromAddress: string;
    }>
  >(
    `SELECT "smtpHost", "smtpPort", "smtpSecure", "smtpAuthEnc",
            "imapHost", "imapPort", "imapSecure", "imapAuthEnc", "fromAddress"
     FROM "V2SenderAccount"
     WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
    senderId,
    context.organizationId
  );
  const sender = rows[0];
  if (!sender) return;

  let error: SenderVerifyError | null = "VERIFY_FAILED";
  let ok = false;
  try {
    const result = await verifySenderConnection(sender, {});
    ok = result.ok;
    error = result.ok ? null : result.smtp.error ?? result.imap?.error ?? "VERIFY_FAILED";
  } catch {
    ok = false;
    error = "VERIFY_FAILED";
  }

  // Fail-closed: clear verifiedAt on any failure so live-send stays gated.
  await prisma.$executeRawUnsafe(
    `UPDATE "V2SenderAccount"
     SET "verifiedAt" = $3, "lastVerifyError" = $4,
         "lastVerifyCheckedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL`,
    senderId,
    context.organizationId,
    ok ? new Date() : null,
    error
  );
  revalidatePath("/v2/outreach/senders");
}

// NS4: /v2/outreach/senders - read-only sender accounts view on the existing
// outreach runtime. SECRETS ARE NEVER SELECTED OR DISPLAYED (smtpAuthEnc /
// imapAuthEnc are encrypted envelopes, Invariant 9 / B1). liveSendEnabled is the
// O9 cutover gate; senders stay non-live until verified + warmed.

type SenderRow = {
  id: string;
  kind: string;
  displayName: string;
  fromName: string | null;
  fromAddress: string;
  domain: string;
  status: string;
  liveSendEnabled: boolean;
  warmupStage: number;
  warmupStartedAt: Date | string | null;
  dailyCapCurrent: number;
  dailyCapTarget: number;
  bounceRate: number;
  complaintRate: number;
  lastSendAt: Date | string | null;
  verifiedAt: Date | string | null;
  lastVerifyError: string | null;
  lastVerifyCheckedAt: Date | string | null;
  trackingDomainId: string | null;
  signatureHtml: string | null;
};

export default async function V2OutreachSendersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const addOpen = (Array.isArray(params.add) ? params.add[0] : params.add) === "1";
  const notice = typeof params.notice === "string" ? params.notice : undefined;
  const context = await getContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-md border border-border bg-card p-6">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const senders = await loadSenders(context.organizationId);
  const trackingDomains = await listTrackingDomains(context.organizationId);
  const verifiedDomains = trackingDomains.filter((d) => d.status === "VERIFIED");
  const trackingHostConfigured = Boolean(process.env.V2_TRACKING_HOST);
  const readinessList = await Promise.all(senders.map((sender) => checkDomainReadiness(sender.domain)));
  const readinessByDomain = new Map<string, DomainReadiness>(readinessList.map((r) => [r.domain, r]));
  const hasCredentialKey = Boolean(process.env.V2_OUTREACH_CREDENTIAL_KEY);
  const killSwitchEngaged = isKillSwitchEngaged();
  const senderFleet = senders.map((sender) => buildSenderFleetRow({
    sender,
    domainReadiness: readinessByDomain.get(sender.domain),
    hasCredentialKey,
    killSwitchEngaged,
    hasVerifiedTrackingDomain: verifiedDomains.length > 0,
  }));
  const liveCapable = senderFleet.filter((row) => row.liveEligible).length;
  const verifiedSenderCount = senderFleet.filter((row) => row.verified).length;
  const warmingCount = senders.filter((sender) => Boolean(sender.warmupStartedAt)).length;
  const cappedOutCount = senders.filter((sender) => sender.dailyCapTarget > 0 && sender.dailyCapCurrent >= sender.dailyCapTarget).length;
  const globalGateItems = buildGlobalGateItems({
    hasCredentialKey,
    killSwitchEngaged,
    trackingHostConfigured,
    verifiedTrackingCount: verifiedDomains.length,
    liveCapable,
  });
  const globalBlockers = globalGateItems.filter((item) => !item.ok && !item.neutral).map((item) => String(item.label));

  const senderColumns: DataTableColumn<SenderFleetRow>[] = [
    {
      key: "sender",
      header: "Sender",
      cell: (row) => (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold text-foreground">{row.sender.displayName}</div>
            <SenderRowMenu senderId={row.sender.id} displayName={row.sender.displayName} fromName={row.sender.fromName} fromAddress={row.sender.fromAddress} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{row.sender.fromAddress}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <OutreachPill tone={row.sender.status === "ACTIVE" ? "green" : "slate"} className="min-h-6 px-2 text-[11px]">{formatLabel(row.sender.status)}</OutreachPill>
            <OutreachPill tone="slate" className="min-h-6 px-2 text-[11px]">{formatLabel(row.sender.kind)}</OutreachPill>
          </div>
        </>
      ),
    },
    {
      key: "readiness",
      header: "Readiness",
      cell: (row) => (
        <div className="space-y-2">
          <DomainAuthBadges readiness={readinessByDomain.get(row.sender.domain)} />
          <ConnectionCell sender={row.sender} verifiedDomains={verifiedDomains} />
        </div>
      ),
    },
    {
      key: "live",
      header: "Live eligibility",
      cell: (row) => (
        <div className="flex flex-col items-start gap-2">
          <LiveToggle sender={row.sender} hasCredentialKey={hasCredentialKey} />
          <TransportBadge mode={row.transport} />
          <OutreachPill tone={row.liveEligible ? "green" : "amber"} className="min-h-6 px-2 text-[11px]">
            {row.liveEligible ? "Eligible" : "Not live-ready"}
          </OutreachPill>
        </div>
      ),
    },
    {
      key: "cap",
      header: "Cap / warmup",
      cell: (row) => (
        <>
          <form action={setDailyCapAction} className="flex items-center gap-1">
            <input type="hidden" name="senderId" value={row.sender.id} />
            <span className="text-xs tabular-nums text-muted-foreground">{row.sender.dailyCapCurrent} /</span>
            <input
              name="cap"
              type="number"
              min={0}
              max={100000}
              defaultValue={row.sender.dailyCapTarget}
              className="h-9 w-20 rounded-md border border-border bg-white px-2 text-xs tabular-nums text-foreground outline-none focus:border-primary/20"
            />
            <button type="submit" className="min-h-9 cursor-pointer px-2 text-xs font-semibold text-primary hover:text-primary">Set</button>
          </form>
          <div className="mt-2"><WarmupControl sender={row.sender} /></div>
          <div className="mt-2 text-xs tabular-nums text-muted-foreground">Bounce / complaint: {pct(row.sender.bounceRate)} / {pct(row.sender.complaintRate)}</div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-primary">Signature{row.sender.signatureHtml ? " ✓" : ""}</summary>
            <form action={setSenderSignatureAction} className="mt-2 space-y-1">
              <input type="hidden" name="senderId" value={row.sender.id} />
              <textarea
                name="signatureHtml"
                rows={4}
                defaultValue={row.sender.signatureHtml ?? ""}
                placeholder={"<p>Best,<br/>Your name — Company</p>"}
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/20"
              />
              <div className="flex justify-end">
                <button type="submit" className="min-h-8 cursor-pointer rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90">Save signature</button>
              </div>
            </form>
          </details>
        </>
      ),
    },
    {
      key: "tracking",
      header: "Tracking",
      cell: (row) => (
        <>
          <div className="text-sm font-medium text-foreground">{row.sender.trackingDomainId ? "Domain attached" : "No tracking"}</div>
          <div className="mt-1 text-xs text-muted-foreground">{verifiedDomains.length} verified domains available</div>
        </>
      ),
    },
    {
      key: "nextfix",
      header: "Next fix",
      cell: (row) => <ActionQueue items={row.actions} emptyLabel="No sender fix needed" />,
    },
  ];

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Outreach"
        title="Sender fleet"
        description="Live-readiness, warmup, domain health, and encrypted sender setup without exposing credentials."
      />

      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/v2/outreach" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to outreach
          </Link>
          {addOpen ? (
            <Link href="/v2/outreach/senders" className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted/40">
              <XIcon className="h-4 w-4" aria-hidden="true" />
              Cancel setup
            </Link>
          ) : (
            <Link href="/v2/outreach/senders?add=1" className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-white hover:bg-primary">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add sender
            </Link>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OutreachMetricTile label="Live-capable" value={liveCapable} description="Verified, active, live, and not globally blocked" icon={RadioTower} tone={liveCapable > 0 ? "green" : "amber"} />
          <OutreachMetricTile label="Verified" value={verifiedSenderCount} description={`${senders.length} total sender accounts`} icon={CheckCircle2} tone={verifiedSenderCount > 0 ? "green" : "neutral"} />
          <OutreachMetricTile label="Warming" value={warmingCount} description="Warmup currently enabled" icon={Activity} tone={warmingCount > 0 ? "amber" : "neutral"} />
          <OutreachMetricTile label="Cap pressure" value={cappedOutCount} description="Senders at daily cap" icon={Gauge} tone={cappedOutCount > 0 ? "amber" : "neutral"} />
        </div>

        {killSwitchEngaged ? (
          <InsightStrip tone="red" icon={Lock}>
            <span className="font-semibold">Kill switch engaged</span> (V2_OUTREACH_KILL_SWITCH). Every sender resolves to SANDBOX transport; no real email leaves until it is cleared.
          </InsightStrip>
        ) : !hasCredentialKey ? (
          <InsightStrip tone="amber" icon={KeyRound}>
            No <code className="rounded bg-amber-100 px-1 text-xs">V2_OUTREACH_CREDENTIAL_KEY</code>. Credentials cannot be decrypted, so every sender stays on the SANDBOX transport regardless of its live toggle.
          </InsightStrip>
        ) : null}

        {notice?.startsWith("oauth-") ? <OAuthNotice notice={notice} /> : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <OutreachPanel
              title="Fleet readiness gates"
              description="These checks explain why live send is available, sandboxed, or blocked. They do not bypass runtime guards."
              actions={<OutreachPill tone={globalBlockers.length === 0 ? "green" : "amber"}>{globalBlockers.length === 0 ? "Global gates pass" : `${globalBlockers.length} blockers`}</OutreachPill>}
            >
              <div className="p-4">
                <ReadinessChecklist items={globalGateItems} footer="Sender live toggles remain secondary to credential key, kill switch, connection verification, and the final suppression check in the send handler." />
              </div>
            </OutreachPanel>

            <OutreachPanel title="SMTP/app-password first" description="Supported live path for the first production auto-run.">
              <div className="p-4 text-sm leading-6 text-muted-foreground">
                First live campaign auto-run is supported through the encrypted SMTP/IMAP setup below. OAuth mailbox connection is intentionally deferred for live sending until the XOAUTH2 transport hookup is verified with real provider credentials; do not use OAuth senders for the first production auto-run.
              </div>
            </OutreachPanel>

            <TrackingDomainsPanel domains={trackingDomains} configured={trackingHostConfigured} />

            {addOpen ? <AddSenderForm hasCredentialKey={hasCredentialKey} /> : null}

            <OutreachPanel
              title="Sender accounts"
              description="Human-readable sender identity, readiness blockers, cap pressure, tracking, and the next fix. Secrets are never selected or displayed."
              actions={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <form action={enableSenderFleetDefaultsAction}>
                    <input type="hidden" name="cap" value={DEFAULT_BULK_WARMUP_CAP} />
                    <button
                      type="submit"
                      disabled={senders.length === 0}
                      title="Start warmup, set empty caps, attach verified tracking, and enable live only for verified senders"
                      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:bg-foreground"
                    >
                      <RadioTower className="h-4 w-4" aria-hidden="true" />
                      Enable ready senders
                    </button>
                  </form>
                  <OutreachPill tone="blue">{senders.length} senders</OutreachPill>
                </div>
              }
            >
              {senders.length === 0 ? (
                <DataState icon={Server} title="No sender accounts yet" description="Add a sender with encrypted SMTP credentials, then test connection before enabling live send." />
              ) : (
                <DataTable
                  columns={senderColumns}
                  rows={senderFleet}
                  getRowId={(row) => row.sender.id}
                  verticalAlign="top"
                  minWidth="min-w-[1120px]"
                  className="rounded-none border-0 bg-transparent shadow-none"
                  ariaLabel="Sender accounts"
                />
              )}
            </OutreachPanel>
          </div>

          <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
            <OutreachPanel title="Live-send truth" description="The UI never grants live send by itself.">
              <div className="p-4 text-sm leading-6 text-muted-foreground">
                A sender is live-capable only when it is active, connection-verified, liveSendEnabled is true, the credential key exists, and the kill switch is off. Provider delivery still goes through the worker path and final synchronous suppression checks.
              </div>
            </OutreachPanel>
            <OutreachPanel title="Fleet next actions" description="Highest-impact fixes across the sender fleet.">
              <div className="p-4">
                <ActionQueue items={buildFleetActions(globalBlockers, senderFleet)} emptyLabel="Fleet is ready for controlled sending." />
              </div>
            </OutreachPanel>
          </aside>
        </div>
      </div>
    </WorkspaceFrame>
  );
}

type SenderFleetRow = {
  sender: SenderRow;
  verified: boolean;
  liveEligible: boolean;
  transport: ReturnType<typeof resolveTransportMode>;
  actions: Array<{ label: ReactNode; detail?: ReactNode; tone?: "neutral" | "blue" | "green" | "amber" | "red" | "slate"; action?: ReactNode }>;
};

function buildGlobalGateItems({
  hasCredentialKey,
  killSwitchEngaged,
  trackingHostConfigured,
  verifiedTrackingCount,
  liveCapable,
}: {
  hasCredentialKey: boolean;
  killSwitchEngaged: boolean;
  trackingHostConfigured: boolean;
  verifiedTrackingCount: number;
  liveCapable: number;
}): ReadinessItem[] {
  return [
    { ok: hasCredentialKey, label: "Credential key present", detail: hasCredentialKey ? "Encrypted credentials can be decrypted by the send path." : "Set V2_OUTREACH_CREDENTIAL_KEY before any sender can go live." },
    { ok: !killSwitchEngaged, label: "Kill switch off", detail: killSwitchEngaged ? "V2_OUTREACH_KILL_SWITCH forces sandbox transport." : "Global kill switch is not engaged." },
    { ok: liveCapable > 0, label: "At least one live-capable sender", detail: liveCapable > 0 ? `${liveCapable} sender(s) are live-capable.` : "Verify a sender connection and enable live send when ready." },
    { ok: trackingHostConfigured, label: "Tracking host configured", detail: trackingHostConfigured ? "Custom tracking domains can be added." : "V2_TRACKING_HOST is missing; open/click metrics stay unavailable.", neutral: !trackingHostConfigured },
    { ok: verifiedTrackingCount > 0, label: "Verified tracking domain", detail: verifiedTrackingCount > 0 ? `${verifiedTrackingCount} verified domain(s).` : "Open/click metrics remain hidden until a CTD is verified.", neutral: verifiedTrackingCount === 0 },
  ];
}

function buildSenderFleetRow({
  sender,
  domainReadiness,
  hasCredentialKey,
  killSwitchEngaged,
  hasVerifiedTrackingDomain,
}: {
  sender: SenderRow;
  domainReadiness?: DomainReadiness;
  hasCredentialKey: boolean;
  killSwitchEngaged: boolean;
  hasVerifiedTrackingDomain: boolean;
}): SenderFleetRow {
  const verified = Boolean(sender.verifiedAt) && !sender.lastVerifyError;
  const transport = resolveTransportMode({
    senderLiveSendEnabled: sender.liveSendEnabled,
    killSwitchEngaged,
    credentialKeyPresent: hasCredentialKey,
  });
  const liveEligible = sender.status === "ACTIVE" && verified && sender.liveSendEnabled && hasCredentialKey && !killSwitchEngaged;
  const actions: SenderFleetRow["actions"] = [];
  if (sender.status !== "ACTIVE") actions.push({ label: "Activate sender status", detail: "Only ACTIVE senders are eligible for live sends.", tone: "amber" });
  if (!verified) actions.push({ label: "Test connection", detail: sender.lastVerifyError ? "Last verification failed. Fix credentials or provider access, then test again." : "Connection must pass before live can be enabled.", tone: "amber" });
  if (!hasCredentialKey) actions.push({ label: "Set credential key", detail: "Without V2_OUTREACH_CREDENTIAL_KEY, encrypted SMTP credentials cannot be decrypted.", tone: "red" });
  if (killSwitchEngaged) actions.push({ label: "Clear kill switch", detail: "The global kill switch forces sandbox transport for every sender.", tone: "red" });
  if (!sender.liveSendEnabled) actions.push({ label: "Enable live toggle", detail: "Allowed only after credential key and connection verification pass.", tone: "amber" });
  if (sender.dailyCapTarget > 0 && sender.dailyCapCurrent >= sender.dailyCapTarget) actions.push({ label: "Daily cap reached", detail: "Increase cap intentionally or wait for reset.", tone: "amber" });
  if (domainReadiness && (!domainReadiness.spf || !domainReadiness.dmarc)) actions.push({ label: "Fix domain auth", detail: "SPF/DMARC readiness improves sender safety before scale.", tone: "amber" });
  if (!sender.trackingDomainId && hasVerifiedTrackingDomain) actions.push({ label: "Attach tracking domain", detail: "Verified CTD exists but is not attached to this sender.", tone: "blue" });
  return { sender, verified, liveEligible, transport, actions: actions.slice(0, 3) };
}

function buildFleetActions(globalBlockers: string[], rows: SenderFleetRow[]) {
  const actions: Array<{ label: ReactNode; detail?: ReactNode; tone?: "neutral" | "blue" | "green" | "amber" | "red" | "slate"; action?: ReactNode }> = [];
  for (const blocker of globalBlockers.slice(0, 2)) {
    actions.push({ label: blocker, detail: "Resolve this global gate before trusting live-readiness.", tone: blocker.includes("Kill") ? "red" : "amber" });
  }
  const unverified = rows.filter((row) => !row.verified).length;
  if (unverified > 0) actions.push({ label: `${unverified} sender(s) need connection test`, detail: "Run test connection after provider credentials and mailbox access are ready.", tone: "amber" });
  const liveReady = rows.filter((row) => row.liveEligible).length;
  if (liveReady === 0 && rows.length > 0) actions.push({ label: "No live-capable sender", detail: "At least one sender must be active, verified, live-enabled, and not globally blocked.", tone: "red" });
  return actions.slice(0, 4);
}
const OAUTH_NOTICE_LABELS: Record<string, { ok: boolean; text: string }> = {
  "oauth-connected": { ok: true, text: "Mailbox connected via OAuth. The sender is gated until you flip it live." },
  "oauth-forbidden": { ok: false, text: "Only outreach admins (OWNER/ADMIN) can connect a sender." },
  "oauth-provider_not_configured": { ok: false, text: "This provider's OAuth client is not configured on the server." },
  "oauth-no_master_key": { ok: false, text: "V2_OUTREACH_CREDENTIAL_KEY is not set; credentials cannot be encrypted." },
  "oauth-invalid_state": { ok: false, text: "The authorization link expired or was already used. Try again." },
  "oauth-token_exchange_failed": { ok: false, text: "Token exchange failed. Re-authorize the mailbox." },
  "oauth-no_email": { ok: false, text: "Could not read the mailbox address from the grant." },
  "oauth-denied": { ok: false, text: "Authorization was denied at the provider." },
  "oauth-missing-params": { ok: false, text: "The callback was missing the code or state." },
  "oauth-unknown-provider": { ok: false, text: "Unknown OAuth provider." },
};

function OAuthNotice({ notice }: { notice: string }) {
  const info = OAUTH_NOTICE_LABELS[notice] ?? { ok: false, text: "OAuth connection could not be completed." };
  return (
    <div
      className={
        info.ok
          ? "rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          : "rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      }
    >
      {info.text}
    </div>
  );
}

function TrackingDomainsPanel({
  domains,
  configured,
}: {
  domains: TrackingDomainRow[];
  configured: boolean;
}) {
  return (
    <PanelCard
      title="Custom tracking domain (open / click)"
      description="CNAME a subdomain to our tracking host, then Verify. Open/click metrics stay hidden until a domain is verified - no fake numbers."
    >
      {!configured ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <code className="rounded bg-amber-100 px-1 text-xs">V2_TRACKING_HOST</code> is not set on the
          server, so a tracking domain cannot be added yet.
        </div>
      ) : null}
      {domains.length > 0 ? (
        <ul className="mb-3 divide-y divide-border rounded-md border border-border">
          {domains.map((d) => {
            const verified = d.status === "VERIFIED";
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{d.hostname}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    CNAME &rarr; {d.cnameTarget}
                    {d.status === "FAILED" && d.failureReason ? ` - ${d.failureReason}` : ""}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    verified
                      ? "bg-emerald-50 text-emerald-700"
                      : d.status === "FAILED"
                        ? "bg-red-50 text-red-700"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {formatLabel(d.status)}
                </span>
                <form action={verifyTrackingDomainAction}>
                  <input type="hidden" name="trackingDomainId" value={d.id} />
                  <button type="submit" className="cursor-pointer text-xs font-medium text-primary hover:text-primary">
                    Verify
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : null}
      <form action={addTrackingDomainAction} className="flex flex-wrap items-end gap-2">
        <label className="flex-1 text-xs font-medium text-muted-foreground">
          Tracking subdomain
          <input
            name="hostname"
            placeholder="inst.yourdomain.com"
            disabled={!configured}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <button
          type="submit"
          disabled={!configured}
          className="inline-flex h-9 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary disabled:cursor-not-allowed disabled:bg-foreground"
        >
          Add domain
        </button>
      </form>
    </PanelCard>
  );
}

function WarmupControl({ sender }: { sender: SenderRow }) {
  const active = Boolean(sender.warmupStartedAt);
  return (
    <form action={setWarmupAction} className="flex items-center gap-2">
      <input type="hidden" name="senderId" value={sender.id} />
      <input type="hidden" name="enable" value={active ? "0" : "1"} />
      <span className="text-xs text-muted-foreground">Stage {sender.warmupStage}</span>
      <button
        type="submit"
        className={`cursor-pointer rounded-full px-2 py-0.5 text-xs font-semibold ${
          active ? "bg-amber-50 text-amber-700 hover:bg-amber-100" : "bg-muted text-muted-foreground hover:bg-muted"
        }`}
        title={active ? "Pause warmup" : "Start warmup"}
      >
        {active ? "Warming" : "Start"}
      </button>
    </form>
  );
}

function ConnectionCell({ sender, verifiedDomains }: { sender: SenderRow; verifiedDomains: TrackingDomainRow[] }) {
  const verified = Boolean(sender.verifiedAt) && !sender.lastVerifyError;
  const errorLabel = sender.lastVerifyError
    ? SENDER_VERIFY_ERROR_LABELS[sender.lastVerifyError as SenderVerifyError] ?? sender.lastVerifyError
    : null;
  return (
    <div className="flex flex-col items-start gap-1">
      {verified ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
          <Check className="h-3 w-3" aria-hidden="true" />
          Verified
        </span>
      ) : errorLabel ? (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"
          title={errorLabel}
        >
          <XIcon className="h-3 w-3" aria-hidden="true" />
          Failed
        </span>
      ) : (
        <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          Untested
        </span>
      )}
      <form action={testSenderConnectionAction}>
        <input type="hidden" name="senderId" value={sender.id} />
        <button
          type="submit"
          className="cursor-pointer text-xs font-medium text-primary hover:text-primary"
        >
          Test connection
        </button>
      </form>
      {verifiedDomains.length > 0 ? (
        <form action={setSenderTrackingDomainAction} className="flex items-center gap-1">
          <input type="hidden" name="senderId" value={sender.id} />
          <select
            name="trackingDomainId"
            defaultValue={sender.trackingDomainId ?? ""}
            className="h-7 max-w-[10rem] rounded-md border border-border bg-white px-1 text-[11px] text-foreground outline-none focus:border-primary/20"
            title="Custom tracking domain (open/click) for this sender"
          >
            <option value="">No tracking</option>
            {verifiedDomains.map((d) => (
              <option key={d.id} value={d.id}>{d.hostname}</option>
            ))}
          </select>
          <button type="submit" className="cursor-pointer text-[11px] font-medium text-primary hover:text-primary">
            Set
          </button>
        </form>
      ) : null}
    </div>
  );
}

function TransportBadge({ mode }: { mode: ReturnType<typeof resolveTransportMode> }) {
  const live = mode.mode === "live";
  return (
    <span
      title={mode.reason}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        live ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
      }`}
    >
      {live ? <Check className="h-3 w-3" aria-hidden="true" /> : <Lock className="h-3 w-3" aria-hidden="true" />}
      {mode.label}
    </span>
  );
}

function LiveToggle({ sender, hasCredentialKey }: { sender: SenderRow; hasCredentialKey: boolean }) {
  const live = sender.liveSendEnabled;
  const verified = Boolean(sender.verifiedAt) && !sender.lastVerifyError;
  // Enabling requires the credential key AND a passing connection test
  // (verify-before-activate). Disabling is always allowed (kill path).
  const disabled = !live && (!hasCredentialKey || !verified);
  return (
    <form action={setLiveSendAction} className="inline-flex">
      <input type="hidden" name="senderId" value={sender.id} />
      <input type="hidden" name="enable" value={live ? "0" : "1"} />
      <button
        type="submit"
        disabled={disabled}
        title={
          disabled
            ? !verified
              ? "Pass a connection test before this sender can go live"
              : "Set V2_OUTREACH_CREDENTIAL_KEY before a sender can go live"
            : live
              ? "Click to gate this sender (stops live sends)"
              : "Click to enable live sending for this sender"
        }
        className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          live
            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "bg-muted text-muted-foreground hover:bg-muted"
        }`}
      >
        {live ? (
          <>
            <Check className="h-3 w-3" aria-hidden="true" />
            Live
          </>
        ) : (
          <>
            <Lock className="h-3 w-3" aria-hidden="true" />
            Gated
          </>
        )}
      </button>
    </form>
  );
}

function DomainAuthBadges({ readiness }: { readiness?: DomainReadiness }) {
  if (!readiness) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <AuthPill label="SPF" ok={readiness.spf} />
      <AuthPill label="DMARC" ok={readiness.dmarc} />
      <span
        className="inline-flex rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
        title={readiness.dkimNote}
      >
        DKIM manual
      </span>
    </div>
  );
}

function AuthPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
    >
      {ok ? <Check className="h-3 w-3" aria-hidden="true" /> : <XIcon className="h-3 w-3" aria-hidden="true" />}
      {label}
    </span>
  );
}

function AddSenderForm({ hasCredentialKey }: { hasCredentialKey: boolean }) {
  return (
    <PanelCard title="Add sender" contentClassName="p-5">
      {!hasCredentialKey ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <code className="rounded bg-amber-100 px-1 text-xs">V2_OUTREACH_CREDENTIAL_KEY</code> is not set.
          Credentials cannot be encrypted, so a sender cannot be saved until the master key exists
          (the form fails closed - no plaintext is ever stored).
        </div>
      ) : null}
      <form action={addSenderAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Kind">
            <select name="kind" className={inputCls} defaultValue="MAILBOX">
              <option value="MAILBOX">Mailbox</option>
              <option value="RELAY">Relay</option>
            </select>
          </Field>
          <Field label="Display name"><input name="displayName" className={inputCls} required /></Field>
          <Field label="Sending domain"><input name="domain" placeholder="example.com" className={inputCls} required /></Field>
          <Field label="From address"><input name="fromAddress" type="email" placeholder="ada@example.com" className={inputCls} required /></Field>
          <Field label="From name"><input name="fromName" className={inputCls} /></Field>
          <Field label="Return-path (optional)"><input name="returnPathAddress" type="email" className={inputCls} /></Field>
        </div>

        <div className="border-t border-border pt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">SMTP (send)</div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Host"><input name="smtpHost" className={inputCls} required /></Field>
            <Field label="Port"><input name="smtpPort" type="number" defaultValue={587} className={inputCls} required /></Field>
            <Field label="TLS">
              <select name="smtpSecure" className={inputCls} defaultValue="false">
                <option value="false">STARTTLS (587)</option>
                <option value="true">SSL (465)</option>
              </select>
            </Field>
            <Field label="Daily cap"><input name="dailyCapTarget" type="number" defaultValue={0} className={inputCls} /></Field>
            <Field label="Username"><input name="smtpUser" autoComplete="off" className={inputCls} required /></Field>
            <Field label="Password"><input name="smtpPass" type="password" autoComplete="new-password" className={inputCls} required /></Field>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">IMAP (inbound - optional)</div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Host"><input name="imapHost" className={inputCls} /></Field>
            <Field label="Port"><input name="imapPort" type="number" defaultValue={993} className={inputCls} /></Field>
            <Field label="TLS">
              <select name="imapSecure" className={inputCls} defaultValue="true">
                <option value="true">SSL (993)</option>
                <option value="false">STARTTLS (143)</option>
              </select>
            </Field>
            <div />
            <Field label="Username"><input name="imapUser" autoComplete="off" className={inputCls} /></Field>
            <Field label="Password"><input name="imapPass" type="password" autoComplete="new-password" className={inputCls} /></Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <span className="mr-auto text-xs text-muted-foreground">New senders start gated (liveSendEnabled = false) until verified at cutover.</span>
          <button
            type="submit"
            disabled={!hasCredentialKey}
            className="inline-flex h-9 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:bg-foreground"
          >
            Save sender (encrypted)
          </button>
        </div>
      </form>
    </PanelCard>
  );
}

const inputCls =
  "h-9 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

async function loadSenders(organizationId: string): Promise<SenderRow[]> {
  // Explicit non-secret column list - never select smtpAuthEnc / imapAuthEnc.
  const rows = await prisma.$queryRawUnsafe<SenderRow[]>(
    `
      SELECT
        "id", "kind"::text AS "kind", "displayName", "fromName", "fromAddress", "domain",
        "status"::text AS "status", "liveSendEnabled", "warmupStage", "warmupStartedAt",
        "dailyCapCurrent", "dailyCapTarget", "bounceRate", "complaintRate", "lastSendAt",
        "verifiedAt", "lastVerifyError", "lastVerifyCheckedAt", "trackingDomainId", "signatureHtml"
      FROM "V2SenderAccount"
      WHERE "organizationId" = $1 AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC
    `,
    organizationId
  );
  return rows.map((row) => ({
    ...row,
    warmupStage: Number(row.warmupStage),
    dailyCapCurrent: Number(row.dailyCapCurrent),
    dailyCapTarget: Number(row.dailyCapTarget),
    bounceRate: Number(row.bounceRate),
    complaintRate: Number(row.complaintRate),
  }));
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
