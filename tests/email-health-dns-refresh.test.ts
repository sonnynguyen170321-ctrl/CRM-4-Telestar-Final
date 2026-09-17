/**
 * The DNS check has to actually run.
 *
 * `checkDomainDns` is reachable only from `POST /api/email-health/domains/[domain]/check`, a route
 * a human has to press. Nothing calls it on a schedule, so `EmailDomainHealth` for itelestar.com
 * sat at spf/dkim/dmarc/mx = `unknown` with `lastCheckedAt` NULL from the day the row was created,
 * while the domain's SPF and DMARC were in fact correct and published.
 *
 * The hourly health pass already upserts that row with volume rollups and never touched the DNS
 * columns, which makes it the obvious place. The check is injected so this test does no DNS I/O,
 * and it is rate-limited, because an hourly cron must not become an hourly resolver query.
 */
import { describe, expect, it, vi } from 'vitest';

import { shouldRefreshDns, DNS_RECHECK_MS } from '@/lib/email-health/snapshots';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('shouldRefreshDns', () => {
  it('refreshes a domain nobody has ever checked', () => {
    expect(shouldRefreshDns(null, NOW)).toBe(true);
  });

  it('refreshes a check that has gone stale', () => {
    expect(shouldRefreshDns(ago(DNS_RECHECK_MS + 60_000), NOW)).toBe(true);
  });

  it('leaves a recent check alone, so an hourly cron is not an hourly resolver query', () => {
    expect(shouldRefreshDns(ago(60 * 60_000), NOW)).toBe(false);
  });

  it('treats the boundary as still fresh rather than re-checking on every tick', () => {
    expect(shouldRefreshDns(ago(DNS_RECHECK_MS), NOW)).toBe(false);
  });

  it('rechecks at most once a day', () => {
    expect(DNS_RECHECK_MS).toBe(24 * 60 * 60_000);
  });
});

describe('refreshDomainDns', () => {
  it('records what the check found, with the time it was taken', async () => {
    const { refreshDomainDns } = await import('@/lib/email-health/snapshots');
    const check = vi.fn(async () => ({
      spfStatus: 'pass' as const,
      dmarcStatus: 'pass' as const,
      mxStatus: 'pass' as const,
      notes: ['spf: found'],
      checkedAt: NOW,
    }));

    const result = await refreshDomainDns('itelestar.com', check);

    expect(check).toHaveBeenCalledWith('itelestar.com');
    expect(result).toMatchObject({
      spfStatus: 'pass',
      dmarcStatus: 'pass',
      mxStatus: 'pass',
      lastCheckedAt: NOW,
    });
    expect(result?.dnsNotes).toContain('spf: found');
  });

  it('returns nothing when the resolver itself fails, rather than recording a false failure', async () => {
    // An unreachable resolver is not evidence the domain is misconfigured. Writing `fail` here is
    // the same mistake as scoring `unknown` as risky — it turns our own outage into their problem.
    const { refreshDomainDns } = await import('@/lib/email-health/snapshots');
    const check = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });

    await expect(refreshDomainDns('itelestar.com', check)).resolves.toBeNull();
  });
});
