import { createHmac, timingSafeEqual } from "node:crypto";

// CTD: opaque, server-resolved tracking tokens. Open + unsubscribe tokens are
// HMAC-signed over {kind,messageId} — the value is meaningless to the client and
// cannot be forged or repurposed across kinds. Click targets are NOT in the
// token (a stored V2OutreachTrackingLink maps token -> DB target), so a tracking
// link can never become an open redirect.

export type TrackingTokenKind = "open" | "unsub";
export type TrackingTokenPayload = { kind: TrackingTokenKind; messageId: string };

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signTrackingToken(payload: TrackingTokenPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyTrackingToken(token: string, secret: string): TrackingTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as Partial<TrackingTokenPayload>;
    if ((payload.kind === "open" || payload.kind === "unsub") && typeof payload.messageId === "string" && payload.messageId) {
      return { kind: payload.kind, messageId: payload.messageId };
    }
    return null;
  } catch {
    return null;
  }
}

/** The HMAC secret for tracking tokens. Absent → tracking disabled. */
export function getTrackingSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.V2_TRACKING_SECRET ?? env.V2_OUTREACH_CREDENTIAL_KEY ?? "";
  return secret.length >= 16 ? secret : null;
}
