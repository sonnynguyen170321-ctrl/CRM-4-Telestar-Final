import { effectiveDailyCap, isWarmedForSteadyState, wouldExceedCap, type SenderForSelection } from "../senderPool/policy";

// O9 / design: live-send cutover guards. Live SMTP is allowed ONLY when every
// guard passes: kill switch off, org + sender live flags on, per-kind
// deliverability (RELAY: SPF+DKIM+DMARC; Workspace MAILBOX: verified custom-domain
// DKIM; plain @gmail.com allowed but capped + flagged), within the warmup-adjusted
// cap, the mailbox is warmed, and a List-Unsubscribe header is present (B4). Pure.

export type DeliverabilityStatus = {
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  customDomainDkim: boolean; // Workspace custom-domain DKIM verified
  isPlainGmail: boolean; // plain @gmail.com (weak cold deliverability)
};

export type LiveSendGuardInput = {
  killSwitchEngaged: boolean;
  orgLiveSendEnabled: boolean;
  sender: Pick<SenderForSelection, "id" | "kind" | "warmupStage" | "dailyCapCurrent" | "dailyCapTarget" | "sentToday"> & {
    liveSendEnabled: boolean;
  };
  deliverability: DeliverabilityStatus;
  hasListUnsubscribe: boolean;
};

export type LiveSendGuardResult = {
  allowed: boolean;
  reasons: string[];
  flags: string[]; // non-blocking warnings (e.g. plain gmail capped low)
  effectiveCap: number;
};

export function canLiveSend(input: LiveSendGuardInput): LiveSendGuardResult {
  const reasons: string[] = [];
  const flags: string[] = [];
  const { sender, deliverability } = input;
  const cap = effectiveDailyCap(sender);

  if (input.killSwitchEngaged) reasons.push("kill_switch_engaged");
  if (!input.orgLiveSendEnabled) reasons.push("org_live_send_disabled");
  if (!sender.liveSendEnabled) reasons.push("sender_live_send_disabled");
  if (!input.hasListUnsubscribe) reasons.push("missing_list_unsubscribe"); // B4

  if (sender.kind === "RELAY") {
    if (!(deliverability.spf && deliverability.dkim && deliverability.dmarc)) {
      reasons.push("relay_missing_spf_dkim_dmarc");
    }
  } else {
    // MAILBOX
    if (deliverability.isPlainGmail) {
      flags.push("plain_gmail_low_deliverability"); // allowed, but prefer warm/reply traffic + low cap
    } else if (!deliverability.customDomainDkim) {
      reasons.push("mailbox_missing_dkim");
    }
    if (!isWarmedForSteadyState(sender)) {
      reasons.push("mailbox_not_warmed");
    }
  }

  if (wouldExceedCap(sender.sentToday, cap)) {
    reasons.push("daily_cap_exceeded");
  }

  return { allowed: reasons.length === 0, reasons, flags, effectiveCap: cap };
}

/** The kill switch: env flag halts ALL live sends immediately. */
export function isKillSwitchEngaged(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.V2_OUTREACH_KILL_SWITCH ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
