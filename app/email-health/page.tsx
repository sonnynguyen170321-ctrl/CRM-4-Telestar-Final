'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import EmailHealthOverviewCards from '@/components/email-health/EmailHealthOverviewCards';
import InboxHealthTable from '@/components/email-health/InboxHealthTable';
import EmailHealthAlertsPanel from '@/components/email-health/EmailHealthAlertsPanel';
import CampaignEmailHealthTable from '@/components/email-health/CampaignEmailHealthTable';
import DomainHealthTable from '@/components/email-health/DomainHealthTable';
import {
  useEmailHealthOverview,
  useInboxHealth,
  useEmailHealthAlerts,
  useCampaignEmailHealth,
  useDomainHealth,
  usePauseInbox,
  useResumeInbox,
  useUpdateDailyCap,
  useAlertTransition,
  useRunDnsCheck,
  type InboxHealthRow,
} from '@/lib/hooks/useEmailHealth';

/**
 * Deliverability / Email Health.
 *
 * Managers see every inbox in their pod; SDRs see only their own, read-only.
 * Desktop-only per brand-design.md — no responsive breakpoint utilities.
 */

const PauseSendingModal = dynamic(() => import('@/components/email-health/PauseSendingModal'), { ssr: false });
const InboxHealthDetailPanel = dynamic(
  () => import('@/components/email-health/InboxHealthDetailPanel'),
  { ssr: false }
);

const HEALTH_FILTERS = [
  { value: 'all', label: 'All levels' },
  { value: 'critical', label: 'Critical' },
  { value: 'at_risk', label: 'At Risk' },
  { value: 'watch', label: 'Watch' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'paused', label: 'Paused' },
];

export default function EmailHealthPage() {
  const { showToast } = useToast();

  const [healthLevel, setHealthLevel] = useState('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [pauseTarget, setPauseTarget] = useState<InboxHealthRow | null>(null);
  const [detailRow, setDetailRow] = useState<InboxHealthRow | null>(null);
  const [checkingDomain, setCheckingDomain] = useState<string | null>(null);

  const overviewQuery = useEmailHealthOverview();
  const inboxQuery = useInboxHealth({ healthLevel, activeOnly });
  const canManage = inboxQuery.data?.canManage ?? false;

  const alertsQuery = useEmailHealthAlerts('open');
  // Both are manager-only endpoints; asking as an SDR would just 403.
  const campaignQuery = useCampaignEmailHealth(canManage);
  const domainQuery = useDomainHealth(canManage);

  const pauseInbox = usePauseInbox();
  const resumeInbox = useResumeInbox();
  const updateCap = useUpdateDailyCap();
  const alertTransition = useAlertTransition();
  const runDnsCheck = useRunDnsCheck();

  const isMutating =
    pauseInbox.isPending || resumeInbox.isPending || updateCap.isPending || alertTransition.isPending;

  const refreshAll = () => {
    overviewQuery.refetch();
    inboxQuery.refetch();
    alertsQuery.refetch();
    if (canManage) {
      campaignQuery.refetch();
      domainQuery.refetch();
    }
  };

  const handlePauseConfirm = (reason: string) => {
    if (!pauseTarget) return;
    const email = pauseTarget.email;
    pauseInbox.mutate(
      { id: pauseTarget.id, reason },
      {
        onSuccess: () => {
          showToast(`Sending paused for ${email}`, 'success');
          setPauseTarget(null);
        },
        onError: (err: Error) => showToast(err.message, 'error'),
      }
    );
  };

  const handleResume = (row: InboxHealthRow) => {
    resumeInbox.mutate(
      { id: row.id },
      {
        onSuccess: () => showToast(`Sending resumed for ${row.email}`, 'success'),
        onError: (err: Error) => showToast(err.message, 'error'),
      }
    );
  };

  const handleUpdateCap = (row: InboxHealthRow, dailyCap: number) => {
    updateCap.mutate(
      { id: row.id, dailyCap },
      {
        onSuccess: () => showToast(`Daily cap for ${row.email} set to ${dailyCap}`, 'success'),
        onError: (err: Error) => showToast(err.message, 'error'),
      }
    );
  };

  const handleAlertTransition = (id: string, action: 'acknowledge' | 'resolve') => {
    alertTransition.mutate(
      { id, action },
      {
        onSuccess: () => showToast(action === 'resolve' ? 'Alert resolved' : 'Alert acknowledged', 'success'),
        onError: (err: Error) => showToast(err.message, 'error'),
      }
    );
  };

  const handleRunDnsCheck = (domain: string) => {
    setCheckingDomain(domain);
    runDnsCheck.mutate(
      { domain },
      {
        onSuccess: () => showToast(`DNS checked for ${domain}`, 'success'),
        onError: (err: Error) => showToast(err.message, 'error'),
        onSettled: () => setCheckingDomain(null),
      }
    );
  };

  if (inboxQuery.isLoading && !inboxQuery.data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="w-12 h-12 border-4 border-brand-red/20 border-t-brand-red rounded-full animate-spin" />
        <p className="text-sm text-text-secondary font-medium font-display">Scoring inbox health…</p>
      </div>
    );
  }

  const loadError = inboxQuery.error ?? overviewQuery.error;

  return (
    <div className="space-y-6 flex-1 flex flex-col animate-in fade-in duration-200">
      <div className="page-hero flex flex-row items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-extrabold text-2xl text-text-primary tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-brand-orange" />
            Email Health
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Mailbox safety, bounce risk and sending capacity — before sender reputation is damaged.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-dark-alt hover:bg-brand-dark border border-card-border text-text-primary hover:text-white transition-all cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${inboxQuery.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loadError && (
        <div className="glass-card rounded-2xl p-4 border border-brand-red/25">
          <p className="text-xs text-brand-red">{(loadError as Error).message}</p>
        </div>
      )}

      {overviewQuery.data && <EmailHealthOverviewCards overview={overviewQuery.data} />}

      <div className="grid grid-cols-12 gap-6 items-start">
        <div className="col-span-8 glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display font-bold text-sm text-text-primary uppercase tracking-wider">
              Inbox Health
            </h2>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(e) => setActiveOnly(e.target.checked)}
                  className="accent-brand-orange cursor-pointer"
                />
                Active only
              </label>
              <select
                value={healthLevel}
                onChange={(e) => setHealthLevel(e.target.value)}
                aria-label="Filter by health level"
                className="bg-bg-main border border-card-border rounded-lg px-2 py-1 text-[11px] focus-ring cursor-pointer"
              >
                {HEALTH_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>

          <InboxHealthTable
            rows={inboxQuery.data?.accounts ?? []}
            canManage={canManage}
            isMutating={isMutating}
            onSelect={setDetailRow}
            onPause={setPauseTarget}
            onResume={handleResume}
            onUpdateCap={handleUpdateCap}
          />
        </div>

        <div className="col-span-4 glass-card rounded-2xl p-5 space-y-4">
          <h2 className="font-display font-bold text-sm text-text-primary uppercase tracking-wider">
            Alerts &amp; Recommendations
          </h2>
          <EmailHealthAlertsPanel
            alerts={alertsQuery.data?.alerts ?? []}
            canManage={alertsQuery.data?.canManage ?? false}
            isMutating={isMutating}
            onTransition={handleAlertTransition}
          />
        </div>
      </div>

      {canManage && (
        <>
          <div className="glass-card rounded-2xl p-5 space-y-4">
            <h2 className="font-display font-bold text-sm text-text-primary uppercase tracking-wider">
              Campaign Deliverability
            </h2>
            <CampaignEmailHealthTable rows={campaignQuery.data?.campaigns ?? []} />
          </div>

          <div className="glass-card rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="font-display font-bold text-sm text-text-primary uppercase tracking-wider">
                Domain Health
              </h2>
              <p className="text-[11px] text-text-muted mt-1">
                SPF, DMARC and MX are verified live. DKIM has no automated check — its selector is
                provider-specific — so it is recorded manually.
              </p>
            </div>
            <DomainHealthTable
              rows={domainQuery.data?.domains ?? []}
              canManage={canManage}
              checkingDomain={checkingDomain}
              onRunCheck={handleRunDnsCheck}
            />
          </div>
        </>
      )}

      {pauseTarget && (
        <PauseSendingModal
          row={pauseTarget}
          isSubmitting={pauseInbox.isPending}
          onClose={() => setPauseTarget(null)}
          onConfirm={handlePauseConfirm}
        />
      )}

      {detailRow && (
        <InboxHealthDetailPanel
          accountId={detailRow.id}
          fallbackRow={detailRow}
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  );
}
