'use client';

import { RefreshCw } from 'lucide-react';
import type { DomainHealthRow } from '@/lib/hooks/useEmailHealth';

/**
 * Domain DNS posture.
 *
 * SPF, DMARC and MX are verified for real via dns/promises. DKIM has no
 * automated check — its record sits under a provider-specific selector that
 * cannot be discovered — so it is labelled "manual" rather than shown as a
 * failure, which would be misleading.
 */

const DNS_CONFIG: Record<string, { label: string; tone: string }> = {
  pass: { label: 'Pass', tone: 'text-channel-whatsapp' },
  manual_verified: { label: 'Manual', tone: 'text-channel-whatsapp' },
  warning: { label: 'Warn', tone: 'text-brand-gold' },
  fail: { label: 'Fail', tone: 'text-brand-red' },
  unknown: { label: 'Unknown', tone: 'text-text-muted' },
};

function DnsCell({ status, isManualOnly = false }: { status: string; isManualOnly?: boolean }) {
  const config = DNS_CONFIG[status] ?? DNS_CONFIG.unknown;
  const label = isManualOnly && status === 'unknown' ? 'Not set' : config.label;
  return <span className={`font-semibold ${config.tone}`}>{label}</span>;
}

type Props = {
  rows: DomainHealthRow[];
  canManage: boolean;
  checkingDomain: string | null;
  onRunCheck: (domain: string) => void;
};

export default function DomainHealthTable({ rows, canManage, checkingDomain, onRunCheck }: Props) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-text-secondary">
        No sending domains found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-card-border text-[10px] uppercase text-text-secondary tracking-wider font-semibold">
            <th scope="col" className="py-2 pr-3">Domain</th>
            <th scope="col" className="py-2 pr-3 text-right">Inboxes</th>
            <th scope="col" className="py-2 pr-3">SPF</th>
            <th scope="col" className="py-2 pr-3">DMARC</th>
            <th scope="col" className="py-2 pr-3">MX</th>
            <th scope="col" className="py-2 pr-3">DKIM</th>
            <th scope="col" className="py-2 pr-3">Last Check</th>
            <th scope="col" className="py-2 pr-3">Notes</th>
            {canManage && <th scope="col" className="py-2 text-right">Action</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border/50">
          {rows.map((row) => (
            <tr key={row.domain} className="hover:bg-card-border/20 transition-colors">
              <td className="py-2.5 pr-3 font-mono text-text-primary">{row.domain}</td>
              <td className="py-2.5 pr-3 text-right font-mono text-text-secondary">{row.activeInboxCount}</td>
              <td className="py-2.5 pr-3"><DnsCell status={row.spfStatus} /></td>
              <td className="py-2.5 pr-3"><DnsCell status={row.dmarcStatus} /></td>
              <td className="py-2.5 pr-3"><DnsCell status={row.mxStatus} /></td>
              <td className="py-2.5 pr-3"><DnsCell status={row.dkimStatus} isManualOnly /></td>
              <td className="py-2.5 pr-3 font-mono text-[11px] text-text-secondary">
                {row.lastCheckedAt
                  ? new Date(row.lastCheckedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : 'Never'}
              </td>
              <td className="py-2.5 pr-3 max-w-[240px]">
                <span className="text-[11px] text-text-muted line-clamp-2" title={row.dnsNotes ?? ''}>
                  {row.dnsNotes ?? '—'}
                </span>
              </td>
              {canManage && (
                <td className="py-2.5 text-right">
                  <button
                    type="button"
                    disabled={checkingDomain === row.domain}
                    onClick={() => onRunCheck(row.domain)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-card-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${checkingDomain === row.domain ? 'animate-spin' : ''}`} />
                    {checkingDomain === row.domain ? 'Checking…' : 'Check DNS'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
