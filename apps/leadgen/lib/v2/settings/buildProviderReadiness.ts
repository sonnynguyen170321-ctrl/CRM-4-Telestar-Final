// R7: read-only provider/transport readiness for /v2/settings. Reports which
// subsystems are CONFIGURED (boolean presence only — never a secret value,
// Invariant 9). The thin loader passes env-presence booleans + sender counts.

export type ReadinessInput = {
  hasOutreachCredentialKey: boolean; // V2_OUTREACH_CREDENTIAL_KEY present
  hasWorkerSecret: boolean; // V2_WORKER_SECRET present
  killSwitchEngaged: boolean; // V2_OUTREACH_KILL_SWITCH
  searchProviderConfigured: boolean; // V2_SEARCH_PROVIDER + V2_SEARCH_API_KEY
  aiEnabled: boolean; // AI_ENABLED + a provider key
  senderCounts: { total: number; liveEnabled: number; relays: number; mailboxes: number };
};

export type ReadinessStatus = "ready" | "partial" | "not_configured" | "blocked";

export type ProviderReadiness = {
  outreach: {
    status: ReadinessStatus;
    credentialKey: boolean;
    worker: boolean;
    senders: ReadinessInput["senderCounts"];
    liveSendReady: boolean;
    killSwitchEngaged: boolean;
    notes: string[];
  };
  enrichment: { searchProvider: ReadinessStatus };
  ai: { status: ReadinessStatus };
};

export function buildProviderReadiness(input: ReadinessInput): ProviderReadiness {
  const notes: string[] = [];
  if (!input.hasOutreachCredentialKey) notes.push("Set V2_OUTREACH_CREDENTIAL_KEY to store sender credentials.");
  if (!input.hasWorkerSecret) notes.push("Set V2_WORKER_SECRET to run the background worker (sequences).");
  if (input.senderCounts.total === 0) notes.push("Add a sender account (RELAY or MAILBOX).");
  if (input.killSwitchEngaged) notes.push("Kill switch is ENGAGED — all live sends are halted.");

  // Live send needs: cred key + a worker + at least one live-enabled sender, and the kill switch off.
  const liveSendReady =
    input.hasOutreachCredentialKey &&
    input.hasWorkerSecret &&
    input.senderCounts.liveEnabled > 0 &&
    !input.killSwitchEngaged;

  const outreachStatus: ReadinessStatus = input.killSwitchEngaged
    ? "blocked"
    : liveSendReady
    ? "ready"
    : input.hasOutreachCredentialKey || input.senderCounts.total > 0
    ? "partial"
    : "not_configured";

  return {
    outreach: {
      status: outreachStatus,
      credentialKey: input.hasOutreachCredentialKey,
      worker: input.hasWorkerSecret,
      senders: input.senderCounts,
      liveSendReady,
      killSwitchEngaged: input.killSwitchEngaged,
      notes,
    },
    enrichment: { searchProvider: input.searchProviderConfigured ? "ready" : "not_configured" },
    ai: { status: input.aiEnabled ? "ready" : "not_configured" },
  };
}
