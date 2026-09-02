import "server-only";

import { resolveCname } from "node:dns/promises";

// CTD: verify a custom tracking domain by checking its CNAME points at our
// tracking host. Tracking cannot be enabled until this passes (contract §5).
// The resolver is injectable so the policy is unit-testable without real DNS.

export type TrackingVerifyResult =
  | { ok: true }
  | { ok: false; reason: "NO_CNAME" | "CNAME_MISMATCH" | "DNS_LOOKUP_FAILED" };

function normalizeHost(value: string): string {
  return value.trim().replace(/\.$/, "").toLowerCase();
}

export async function verifyTrackingDomainCname(
  hostname: string,
  expectedTarget: string,
  resolver: (host: string) => Promise<string[]> = resolveCname
): Promise<TrackingVerifyResult> {
  const target = normalizeHost(expectedTarget);
  let records: string[];
  try {
    records = await resolver(hostname);
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "";
    if (/ENOTFOUND|ENODATA|ESERVFAIL/.test(code)) {
      return { ok: false, reason: "NO_CNAME" };
    }
    return { ok: false, reason: "DNS_LOOKUP_FAILED" };
  }

  if (!records || records.length === 0) {
    return { ok: false, reason: "NO_CNAME" };
  }
  if (records.some((record) => normalizeHost(record) === target)) {
    return { ok: true };
  }
  return { ok: false, reason: "CNAME_MISMATCH" };
}
