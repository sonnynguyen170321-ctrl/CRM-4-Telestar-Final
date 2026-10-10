'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { useAppContext } from '@/context/AppContext';
import CallingRulesCard from '@/components/settings/telephony/CallingRulesCard';
import CredentialsCard from '@/components/settings/telephony/CredentialsCard';
import DeploymentCard from '@/components/settings/telephony/DeploymentCard';
import KillSwitchCard from '@/components/settings/telephony/KillSwitchCard';
import NumbersCard from '@/components/settings/telephony/NumbersCard';
import { useTelephonySettings } from '@/components/settings/telephony/useTelephonySettings';

// Mirrors MANAGER_ROLES (lib/authRoles.ts); the API enforces it, this only decides what to show.
const MANAGER_ROLE_NAMES = ['director', 'floor_manager', 'team_lead'];

/** Phone and dialer settings for managers (docs/dialer/RUNBOOK.md). */
export default function TelephonySettingsPage() {
  const { currentRole, isSessionLoading } = useAppContext();
  const isManager = MANAGER_ROLE_NAMES.includes(currentRole ?? '');
  const { payload, loadError, send } = useTelephonySettings();

  return (
    <div className="flex flex-1 flex-col space-y-6 animate-in fade-in duration-200">
      <div>
        <Link href="/settings" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-text-primary">
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Workspace settings
        </Link>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-text-primary">Phone &amp; dialer</h1>
        <p className="prose-measure mt-0.5 text-xs text-text-secondary">
          Who can call, when, where, with which number, and whether calls are recorded. Every change is written to the audit log.
        </p>
      </div>

      {isSessionLoading ? (
        <p className="text-xs text-text-muted" role="status">Checking access…</p>
      ) : !isManager ? (
        <p className="rounded-2xl border border-card-border bg-card-bg p-5 text-sm text-text-secondary" role="alert">
          Only directors, floor managers and team leads can change the dialer settings.
        </p>
      ) : loadError ? (
        <p className="rounded-2xl border border-brand-red bg-brand-red/10 p-5 text-sm text-text-primary" role="alert">{loadError}</p>
      ) : !payload ? (
        <p className="text-xs text-text-muted" role="status">Loading…</p>
      ) : (
        <div className="max-w-4xl space-y-6">
          <KillSwitchCard settings={payload.settings} send={send} />
          <DeploymentCard deployment={payload.deployment} />
          <CallingRulesCard key={payload.settings.updatedAt ?? 'unsaved'} settings={payload.settings} send={send} />
          <NumbersCard numbers={payload.numbers} send={send} />
          <CredentialsCard credentials={payload.credentials} send={send} />
        </div>
      )}
    </div>
  );
}
