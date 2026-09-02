// W4: the live-vs-sandbox transport mode for display. Mirrors the three gates that
// decide which provider a send actually uses, so the UI never claims "live" when the
// runtime would sandbox it (and vice-versa). The richer canLiveSend (deliverability /
// warmup / cap / List-Unsubscribe) gates whether a live send is ALLOWED at send time;
// this answers the simpler "which transport" question shown before clicking. Pure.

export type TransportMode = {
  mode: "live" | "sandbox";
  label: string;
  reason: string;
};

export function resolveTransportMode(input: {
  senderLiveSendEnabled: boolean;
  killSwitchEngaged: boolean;
  credentialKeyPresent: boolean;
}): TransportMode {
  if (input.killSwitchEngaged) {
    return { mode: "sandbox", label: "Sandbox", reason: "Kill switch engaged — all live sends are halted." };
  }
  if (!input.credentialKeyPresent) {
    return { mode: "sandbox", label: "Sandbox", reason: "No V2_OUTREACH_CREDENTIAL_KEY — SMTP credentials can't be decrypted." };
  }
  if (!input.senderLiveSendEnabled) {
    return { mode: "sandbox", label: "Sandbox", reason: "Sender is not live-enabled (gated)." };
  }
  return { mode: "live", label: "Live SMTP", reason: "Live SMTP — real email leaves the system (suppression still gates each send)." };
}
