import "server-only";

import { readSearchProviderConfigFromEnv } from "@telestar/core-intel/searchProvider";
import { isKillSwitchEngaged } from "@/lib/v2/outreach/limits/liveSendGuards";
import { buildProviderReadiness, type ProviderReadiness } from "./buildProviderReadiness";

// R7: thin tenant-scoped loader for provider/transport readiness. Reads ENV
// presence (booleans, never values — Invariant 9) + sender counts, then shapes
// via buildProviderReadiness.

async function loadSenderCounts(organizationId: string) {
  const { prisma } = await import("@/lib/server/prisma");
  const rows = await prisma.$queryRawUnsafe<Array<{ total: number; live: number; relays: number; mailboxes: number }>>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE "liveSendEnabled" = true)::int AS live,
       COUNT(*) FILTER (WHERE "kind" = 'RELAY')::int AS relays,
       COUNT(*) FILTER (WHERE "kind" = 'MAILBOX')::int AS mailboxes
     FROM "V2SenderAccount"
     WHERE "organizationId" = $1 AND "deletedAt" IS NULL`,
    organizationId
  );
  const r = rows[0] ?? { total: 0, live: 0, relays: 0, mailboxes: 0 };
  return { total: Number(r.total), liveEnabled: Number(r.live), relays: Number(r.relays), mailboxes: Number(r.mailboxes) };
}

export async function queryProviderReadiness(
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ProviderReadiness> {
  const senderCounts = await loadSenderCounts(organizationId);
  return buildProviderReadiness({
    hasOutreachCredentialKey: !!(env.V2_OUTREACH_CREDENTIAL_KEY ?? "").trim(),
    hasWorkerSecret: !!(env.V2_WORKER_SECRET ?? "").trim(),
    killSwitchEngaged: isKillSwitchEngaged(env),
    searchProviderConfigured: readSearchProviderConfigFromEnv(env) !== null,
    aiEnabled: (env.AI_ENABLED ?? "").trim().toLowerCase() === "true",
    senderCounts,
  });
}
