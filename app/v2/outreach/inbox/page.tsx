import Link from "next/link";
import { Inbox as InboxIcon, Mail, Send } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { CampaignNav } from "@/components/v2/outreach/CampaignNav";
import { queryConversations, type ConversationSummary, type ConversationTab } from "@/lib/v2/outreach/inbox/queryInbox";
import { replyClassLabel, type ReplyClass } from "@/lib/v2/outreach/inbox/classifyReply";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

// Unibox: one threaded surface across everything you sent AND received, by lead (Invariant 2: the
// unit is the LeadAssignment, not a global company). Tabs narrow to Received (has a reply) or Sent
// (has outbound). Read-only here; reading/replying happens in the thread view. Tenant-scoped (Inv 5).

export default async function V2OutreachInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = normalizeTab(pick(params, "tab"));
  const unreadOnly = pick(params, "unread") === "1";
  const search = pick(params, "q") ?? "";
  const context = await getContext();
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

  const all = await queryConversations(context.organizationId, { tab, limit: 200 });
  const unreadTotal = all.reduce((n, t) => n + t.unreadCount, 0);
  const threads = filterConversations(all, unreadOnly, search);

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Outreach"
        title="Unibox"
        description="Every conversation in one place — what you sent and what came back, threaded by lead. Open a thread to read the full exchange and reply in-app."
      />

      <div className="space-y-5 p-5 sm:p-6">
        <CampaignNav active="inbox" />

        <UniboxFilters tab={tab} unreadOnly={unreadOnly} search={search} unreadTotal={unreadTotal} />

        <PanelCard
          title={`${tabTitle(tab)}${unreadTotal > 0 ? ` · ${unreadTotal} unread` : ""}`}
          contentClassName="p-0"
        >
          {threads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
              <InboxIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <div className="text-sm font-medium text-foreground">{emptyTitle(tab)}</div>
              <p className="max-w-sm text-xs text-muted-foreground">
                {tab === "received"
                  ? "When a prospect replies, the IMAP poller correlates it to the lead and the conversation appears here."
                  : "Send a manual email or launch a campaign and the outbound conversation shows up here."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {threads.map((t) => (
                <ThreadRow key={t.leadAssignmentId} thread={t} />
              ))}
            </ul>
          )}
        </PanelCard>
      </div>
    </WorkspaceFrame>
  );
}

function UniboxFilters({ tab, unreadOnly, search, unreadTotal }: { tab: ConversationTab; unreadOnly: boolean; search: string; unreadTotal: number }) {
  const tabs: { key: ConversationTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "received", label: "Received" },
    { key: "sent", label: "Sent" },
  ];
  const href = (next: Partial<{ tab: ConversationTab; unread: boolean; q: string }>) => {
    const t = next.tab ?? tab;
    const u = next.unread ?? unreadOnly;
    const q = next.q ?? search;
    const parts = [`tab=${t}`];
    if (u) parts.push("unread=1");
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    return `/v2/outreach/inbox?${parts.join("&")}`;
  };
  return (
    <PanelCard title="Filters" contentClassName="p-4">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={href({ tab: item.key })}
            aria-current={tab === item.key ? "page" : undefined}
            className={
              tab === item.key
                ? "inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-semibold text-primary ring-1 ring-primary/20"
                : "inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:bg-muted/40"
            }
          >
            {item.label}
          </Link>
        ))}
        <Link
          href={href({ unread: !unreadOnly })}
          className={
            unreadOnly
              ? "inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-semibold text-primary ring-1 ring-primary/20"
              : "inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:bg-muted/40"
          }
        >
          Unread ({unreadTotal})
        </Link>
        <form className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-sm">
          <input type="hidden" name="tab" value={tab} />
          {unreadOnly ? <input type="hidden" name="unread" value="1" /> : null}
          <input
            name="q"
            defaultValue={search}
            placeholder="Search company, contact, subject, snippet"
            className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/20"
          />
          <button type="submit" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Search
          </button>
        </form>
      </div>
    </PanelCard>
  );
}

function filterConversations(threads: ConversationSummary[], unreadOnly: boolean, search: string) {
  const needle = search.trim().toLowerCase();
  return threads.filter((thread) => {
    if (unreadOnly && thread.unreadCount === 0) return false;
    if (!needle) return true;
    return [thread.companyName, thread.contactName, thread.lastFrom, thread.lastSubject, thread.lastSnippet]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });
}

function ThreadRow({ thread }: { thread: ConversationSummary }) {
  const unread = thread.unreadCount > 0;
  const outboundLast = thread.lastDirection === "OUTBOUND";
  const preview = outboundLast
    ? `You: ${thread.lastSubject?.trim() || "(no subject)"}`
    : thread.lastSnippet ?? formatOutcome(thread.lastOutcome);
  return (
    <li>
      <Link
        href={`/v2/outreach/inbox/${thread.leadAssignmentId}`}
        className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
            <span className={`truncate text-sm ${unread ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
              {thread.companyName ?? "Unknown company"}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {thread.contactName ?? thread.lastFrom ?? "—"}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {outboundLast ? <Send className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Mail className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />}
            <span className="truncate">{preview}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] text-muted-foreground">{formatWhen(thread.lastActivityAt)}</span>
          {thread.replyClass ? (
            <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " + replyClassChipTone(thread.replyClass)}>
              {replyClassLabel(thread.replyClass).label}
            </span>
          ) : thread.lastOutcome && thread.lastOutcome !== "REPLY" ? (
            <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " + outcomeTone(thread.lastOutcome)}>
              {formatOutcome(thread.lastOutcome)}
            </span>
          ) : null}
          {unread ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/70 px-2 py-0.5 text-[11px] font-semibold text-primary">
              <Mail className="h-3 w-3" aria-hidden="true" />
              {thread.unreadCount}
            </span>
          ) : thread.sentCount > 0 ? (
            <span className="text-[11px] text-muted-foreground">{thread.sentCount} sent</span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

function normalizeTab(value: string | undefined): ConversationTab {
  return value === "received" || value === "sent" ? value : "all";
}
function tabTitle(tab: ConversationTab): string {
  return tab === "received" ? "Received" : tab === "sent" ? "Sent" : "All conversations";
}
function emptyTitle(tab: ConversationTab): string {
  return tab === "received" ? "No replies yet" : tab === "sent" ? "Nothing sent yet" : "No conversations yet";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const day = 86_400_000;
  if (diffMs < 0) return "";
  if (diffMs < 3_600_000) return `${Math.max(1, Math.round(diffMs / 60_000))}m`;
  if (diffMs < day) return `${Math.round(diffMs / 3_600_000)}h`;
  if (diffMs < 7 * day) return `${Math.round(diffMs / day)}d`;
  return new Date(iso).toLocaleDateString();
}

function formatOutcome(outcome: string | null) {
  if (outcome === "BOUNCE_DSN") return "Bounced";
  if (outcome === "UNSUBSCRIBE") return "Unsubscribed";
  if (outcome === "REPLY") return "Replied";
  return "No preview";
}

function outcomeTone(outcome: string) {
  if (outcome === "BOUNCE_DSN") return "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300";
  if (outcome === "UNSUBSCRIBE") return "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  return "bg-accent text-primary";
}

function replyClassChipTone(cls: ReplyClass) {
  const tone = replyClassLabel(cls).tone;
  return tone === "green"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
    : tone === "red"
      ? "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
        : tone === "blue"
          ? "bg-accent text-primary"
          : "bg-muted text-muted-foreground";
}

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}

function pick(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}
