// O7 / design B3: parse a bounce DSN. Hard bounce = 5.x.x delivery status. The
// original Message-ID is used to correlate the bounce to a message WE sent — a
// forged DSN that cannot name a real outbound Message-ID is ignored. Pure.

export type ParsedDsn = {
  isDsn: boolean;
  dsnStatus: string | null; // e.g. "5.1.1"
  isHardBounce: boolean;
  isSoftBounce: boolean;
  originalMessageId: string | null;
  originalRecipient: string | null;
};

const STATUS_RE = /^\s*Status:\s*([245]\.\d{1,3}\.\d{1,3})/im;
const FINAL_RECIPIENT_RE = /^\s*Final-Recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/im;
const ORIGINAL_MSGID_RE = /^\s*(?:Original-Message-ID|Message-ID):\s*(<[^>\s]+>)/im;

export function looksLikeDsn(headers: string, body: string): boolean {
  const h = headers.toLowerCase();
  return (
    (h.includes("content-type:") && h.includes("multipart/report") && h.includes("report-type=delivery-status")) ||
    h.includes("from: mailer-daemon") ||
    h.includes("from: postmaster") ||
    /auto-submitted:\s*auto-replied/i.test(headers)
  );
}

export function parseDsn(rawHeaders: string, rawBody: string): ParsedDsn {
  const isDsn = looksLikeDsn(rawHeaders, rawBody);
  const text = `${rawHeaders}\n${rawBody}`;

  const statusMatch = STATUS_RE.exec(text);
  const dsnStatus = statusMatch ? statusMatch[1] : null;
  const isHardBounce = !!dsnStatus && dsnStatus.startsWith("5");
  const isSoftBounce = !!dsnStatus && dsnStatus.startsWith("4");

  const recipientMatch = FINAL_RECIPIENT_RE.exec(text);
  const msgIdMatch = ORIGINAL_MSGID_RE.exec(rawBody) ?? ORIGINAL_MSGID_RE.exec(text);

  return {
    isDsn,
    dsnStatus,
    isHardBounce,
    isSoftBounce,
    originalMessageId: msgIdMatch ? msgIdMatch[1] : null,
    originalRecipient: recipientMatch ? recipientMatch[1].toLowerCase() : null,
  };
}
