import "server-only";

import { promises as dns } from "node:dns";

// OL4: sending-domain readiness. Checks SPF + DMARC via DNS TXT lookups. DKIM
// cannot be auto-detected without the provider's selector, so it stays a manual
// attestation. This is advisory display data for the senders surface; the real
// send-time gate is canLiveSend (O9/OL7), which a sender must satisfy before it
// can be flipped live.

export type DomainReadiness = {
  domain: string;
  spf: boolean;
  dmarc: boolean;
  dkimNote: string;
  checkedAt: string;
};

export async function checkDomainReadiness(
  domain: string,
  timeoutMs = 2500
): Promise<DomainReadiness> {
  const [spf, dmarc] = await Promise.all([
    withTimeout(hasSpf(domain), timeoutMs),
    withTimeout(hasDmarc(domain), timeoutMs),
  ]);
  return {
    domain,
    spf,
    dmarc,
    dkimNote: "DKIM requires the selector your provider publishes — verify it manually.",
    checkedAt: new Date().toISOString(),
  };
}

async function hasSpf(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(domain);
    return records.some((parts) => parts.join("").toLowerCase().startsWith("v=spf1"));
  } catch {
    return false;
  }
}

async function hasDmarc(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    return records.some((parts) => parts.join("").toLowerCase().includes("v=dmarc1"));
  } catch {
    return false;
  }
}

function withTimeout(promise: Promise<boolean>, ms: number): Promise<boolean> {
  return Promise.race([
    promise,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}
