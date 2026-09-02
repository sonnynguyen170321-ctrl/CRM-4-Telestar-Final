import { randomBytes } from "node:crypto";

// O4 / design B3+B4: high-entropy outbound Message-ID (so inbound correlation
// cannot be forged) + List-Unsubscribe header. Pure.

/** `<128-bit-hex@domain>` — unguessable, so a forged DSN cannot claim it (B3). */
export function generateMessageId(domain: string): string {
  const token = randomBytes(16).toString("hex");
  const host = String(domain || "mail.local").trim().toLowerCase().replace(/^@+/, "");
  return `<${token}@${host}>`;
}

/** RFC 8058 List-Unsubscribe header value (mailto + optional one-click URL) (B4). */
export function buildListUnsubscribe(input: {
  unsubscribeMailto: string;
  oneClickUrl?: string;
}): string {
  const parts = [`<mailto:${input.unsubscribeMailto}>`];
  if (input.oneClickUrl) {
    parts.push(`<${input.oneClickUrl}>`);
  }
  return parts.join(", ");
}

export function generateUnsubscribeToken(): string {
  return randomBytes(16).toString("hex");
}
