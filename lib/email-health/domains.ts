import { promises as dns } from 'node:dns';
import type { DnsCheckStatus } from '@prisma/client';

/**
 * DNS posture checks using Node's built-in resolver — no new dependencies.
 *
 * SPF, DMARC and MX are checked for real. DKIM is not: the record lives at
 * `<selector>._domainkey.<domain>` and the selector is provider- and
 * tenant-specific with no discovery mechanism, so guessing it would produce
 * confident-looking false failures. DKIM stays manually verified.
 */

/** Per-record timeout. A hung resolver must not stall the hourly cron. */
const DNS_TIMEOUT_MS = 5000;

export interface DomainDnsResult {
  spfStatus: DnsCheckStatus;
  dmarcStatus: DnsCheckStatus;
  mxStatus: DnsCheckStatus;
  notes: string[];
  checkedAt: Date;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('DNS lookup timed out')), ms)),
  ]);
}

/** Flattens the chunked strings Node returns for a TXT record. */
function flattenTxt(records: string[][]): string[] {
  return records.map((chunks) => chunks.join(''));
}

async function checkSpf(domain: string, notes: string[]): Promise<DnsCheckStatus> {
  try {
    const txt = flattenTxt(await withTimeout(dns.resolveTxt(domain), DNS_TIMEOUT_MS));
    const spf = txt.filter((r) => r.toLowerCase().startsWith('v=spf1'));

    if (spf.length === 0) {
      notes.push('No SPF record found');
      return 'fail';
    }
    if (spf.length > 1) {
      // More than one SPF record is a hard failure per RFC 7208 §3.2.
      notes.push('Multiple SPF records found — receivers will treat this as permerror');
      return 'fail';
    }
    if (spf[0].includes('+all')) {
      notes.push('SPF uses +all, which permits any sender');
      return 'warning';
    }
    return 'pass';
  } catch (err) {
    notes.push(`SPF lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'unknown';
  }
}

async function checkDmarc(domain: string, notes: string[]): Promise<DnsCheckStatus> {
  try {
    const txt = flattenTxt(await withTimeout(dns.resolveTxt(`_dmarc.${domain}`), DNS_TIMEOUT_MS));
    const dmarc = txt.find((r) => r.toLowerCase().startsWith('v=dmarc1'));

    if (!dmarc) {
      notes.push('No DMARC record found');
      return 'fail';
    }
    if (/p\s*=\s*none/i.test(dmarc)) {
      notes.push('DMARC policy is p=none — monitoring only, not enforcing');
      return 'warning';
    }
    return 'pass';
  } catch (err) {
    // NXDOMAIN on _dmarc is a definitive "no DMARC", not an inconclusive lookup.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      notes.push('No DMARC record found');
      return 'fail';
    }
    notes.push(`DMARC lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'unknown';
  }
}

async function checkMx(domain: string, notes: string[]): Promise<DnsCheckStatus> {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), DNS_TIMEOUT_MS);
    if (mx.length === 0) {
      notes.push('No MX records found — this domain cannot receive mail');
      return 'fail';
    }
    return 'pass';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      notes.push('No MX records found — this domain cannot receive mail');
      return 'fail';
    }
    notes.push(`MX lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'unknown';
  }
}

/**
 * Runs all three automated checks. Never throws — an unreachable resolver yields
 * `unknown`, which the scorer treats as risky but distinguishable from `fail`.
 */
export async function checkDomainDns(domain: string): Promise<DomainDnsResult> {
  const notes: string[] = [];

  const [spfStatus, dmarcStatus, mxStatus] = await Promise.all([
    checkSpf(domain, notes),
    checkDmarc(domain, notes),
    checkMx(domain, notes),
  ]);

  return { spfStatus, dmarcStatus, mxStatus, notes, checkedAt: new Date() };
}

/** Rejects obviously invalid input before it reaches the resolver. */
export function isPlausibleDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i.test(domain);
}
