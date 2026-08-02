'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { readApiError } from '@/lib/api/client';
import type { EmailHealthLevelValue } from '@/lib/email-health/types';

/**
 * Data hooks for the Email Health module. Modelled on lib/hooks/useLeads.
 *
 * Every mutation invalidates the whole `email-health` key space: pausing an
 * inbox changes the overview counts, the table row and the alert list at once,
 * so partial invalidation would leave visibly stale numbers on screen.
 */

export interface InboxHealthRow {
  id: string;
  email: string;
  provider: string;
  domain: string | null;
  owner: { id: string; firstName: string; lastName: string; role: string } | null;
  isActive: boolean;
  isPaused: boolean;
  pauseReason: string | null;
  lastSyncAt: string | null;
  dailyCap: number;
  sentToday: number;
  usagePct: number;
  sevenDaySent: number;
  hardBounceRate: number;
  softBounceRate: number;
  replyRate: number;
  spamSignalRate: number;
  healthScore: number;
  healthLevel: EmailHealthLevelValue;
  reasons: string[];
  recommendedActions: string[];
  lastHealthCheckAt: string | null;
}

export interface EmailHealthOverview {
  totals: {
    inboxes: number; active: number; paused: number;
    healthy: number; watch: number; atRisk: number; critical: number;
  };
  today: { sent: number; capacity: number; usagePct: number };
  sevenDay: {
    sent: number; hardBounceRate: number; softBounceRate: number;
    replyRate: number; spamSignalRate: number; suppressionGrowth: number;
  };
  openAlerts: { total: number; critical: number; warning: number; info: number };
}

export interface EmailHealthAlert {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved' | 'ignored';
  recommendedAction: string | null;
  domain: string | null;
  createdAt: string;
  account: { id: string; email: string; user: { firstName: string; lastName: string } | null } | null;
  campaign: { id: string; name: string } | null;
}

export interface CampaignHealthRow {
  campaignId: string;
  campaignName: string;
  clientId: string;
  clientName: string;
  sent: number;
  hardBounces: number;
  softBounces: number;
  replies: number;
  hardBounceRate: number;
  replyRate: number;
  suppressionGrowth: number;
  meetingsBooked: number;
}

export interface DomainHealthRow {
  domain: string;
  providerMix: string[];
  activeInboxCount: number;
  spfStatus: string;
  dkimStatus: string;
  dmarcStatus: string;
  mxStatus: string;
  dnsNotes: string | null;
  lastCheckedAt: string | null;
  sevenDaySent: number;
  sevenDayBounceRate: number;
  sevenDayReplyRate: number;
  healthLevel: EmailHealthLevelValue;
}

export interface InboxHealthFilters {
  healthLevel?: string;
  userId?: string;
  provider?: string;
  activeOnly?: boolean;
}

async function getJson<T>(url: string, fallbackError: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await readApiError(res, fallbackError));
  return res.json();
}

export function useEmailHealthOverview() {
  return useQuery<EmailHealthOverview>({
    queryKey: ['email-health', 'overview'],
    queryFn: () => getJson('/api/email-health/overview', 'Failed to load email health overview'),
  });
}

export function useInboxHealth(filters: InboxHealthFilters = {}) {
  return useQuery<{ accounts: InboxHealthRow[]; canManage: boolean }>({
    queryKey: ['email-health', 'accounts', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.healthLevel && filters.healthLevel !== 'all') params.set('healthLevel', filters.healthLevel);
      if (filters.userId && filters.userId !== 'all') params.set('userId', filters.userId);
      if (filters.provider && filters.provider !== 'all') params.set('provider', filters.provider);
      if (filters.activeOnly) params.set('activeOnly', 'true');
      return getJson(`/api/email-health/accounts?${params.toString()}`, 'Failed to load inbox health');
    },
    placeholderData: (previousData) => previousData,
  });
}

export function useEmailHealthAlerts(status = 'open') {
  return useQuery<{ alerts: EmailHealthAlert[]; canManage: boolean }>({
    queryKey: ['email-health', 'alerts', status],
    queryFn: () => getJson(`/api/email-health/alerts?status=${status}`, 'Failed to load alerts'),
  });
}

export function useCampaignEmailHealth(enabled = true) {
  return useQuery<{ campaigns: CampaignHealthRow[] }>({
    queryKey: ['email-health', 'campaigns'],
    queryFn: () => getJson('/api/email-health/campaigns', 'Failed to load campaign deliverability'),
    enabled,
  });
}

export function useDomainHealth(enabled = true) {
  return useQuery<{ domains: DomainHealthRow[] }>({
    queryKey: ['email-health', 'domains'],
    queryFn: () => getJson('/api/email-health/domains', 'Failed to load domain health'),
    enabled,
  });
}

/** Shared invalidation: any write can move numbers in every panel. */
function useEmailHealthInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['email-health'] });
}

async function postJson(url: string, body: unknown, method: 'POST' | 'PATCH', fallbackError: string) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(await readApiError(res, fallbackError));
  return res.json();
}

export function usePauseInbox() {
  const invalidate = useEmailHealthInvalidation();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      postJson(`/api/email-health/accounts/${id}/pause`, { reason }, 'POST', 'Failed to pause sending'),
    onSuccess: invalidate,
  });
}

export function useResumeInbox() {
  const invalidate = useEmailHealthInvalidation();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      postJson(`/api/email-health/accounts/${id}/resume`, undefined, 'POST', 'Failed to resume sending'),
    onSuccess: invalidate,
  });
}

export function useUpdateDailyCap() {
  const invalidate = useEmailHealthInvalidation();
  return useMutation({
    mutationFn: ({ id, dailyCap }: { id: string; dailyCap: number }) =>
      postJson(`/api/email-health/accounts/${id}/cap`, { dailyCap }, 'PATCH', 'Failed to update daily cap'),
    onSuccess: invalidate,
  });
}

export function useAlertTransition() {
  const invalidate = useEmailHealthInvalidation();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'acknowledge' | 'resolve' }) =>
      postJson(`/api/email-health/alerts/${id}/${action}`, undefined, 'PATCH', 'Failed to update alert'),
    onSuccess: invalidate,
  });
}

export function useRunDnsCheck() {
  const invalidate = useEmailHealthInvalidation();
  return useMutation({
    mutationFn: ({ domain }: { domain: string }) =>
      postJson(
        `/api/email-health/domains/${encodeURIComponent(domain)}/check`,
        undefined,
        'POST',
        'DNS check failed'
      ),
    onSuccess: invalidate,
  });
}
