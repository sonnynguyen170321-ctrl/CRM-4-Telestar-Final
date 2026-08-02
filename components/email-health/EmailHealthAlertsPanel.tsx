'use client';

import { AlertTriangle, Info, ShieldAlert, Check, Eye } from 'lucide-react';
import type { EmailHealthAlert } from '@/lib/hooks/useEmailHealth';

/**
 * Open deliverability alerts. The hourly cron auto-resolves alerts whose
 * condition clears, so anything listed here is still true right now.
 */

const SEVERITY_CONFIG = {
  critical: { icon: ShieldAlert, text: 'text-brand-red', bg: 'bg-brand-red/10', border: 'border-brand-red/25' },
  warning: { icon: AlertTriangle, text: 'text-brand-orange-text', bg: 'bg-brand-orange/10', border: 'border-brand-orange/25' },
  info: { icon: Info, text: 'text-channel-email', bg: 'bg-channel-email/10', border: 'border-channel-email/25' },
} as const;

type Props = {
  alerts: EmailHealthAlert[];
  canManage: boolean;
  isMutating: boolean;
  onTransition: (id: string, action: 'acknowledge' | 'resolve') => void;
};

export default function EmailHealthAlertsPanel({ alerts, canManage, isMutating, onTransition }: Props) {
  if (alerts.length === 0) {
    return (
      <div className="text-center py-10 space-y-2">
        <div className="w-10 h-10 rounded-xl bg-channel-whatsapp/10 text-channel-whatsapp border border-channel-whatsapp/20 flex items-center justify-center mx-auto">
          <Check className="w-5 h-5" />
        </div>
        <p className="text-sm text-text-secondary">No open deliverability alerts.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {alerts.map((alert) => {
        const config = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
        const Icon = config.icon;
        const owner = alert.account?.user;

        return (
          <li
            key={alert.id}
            className={`rounded-xl border p-3 flex items-start gap-3 ${config.bg} ${config.border}`}
          >
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${config.text}`} aria-hidden="true" />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-text-primary">{alert.title}</span>
                <span className={`text-[9px] font-extrabold uppercase tracking-wide ${config.text}`}>
                  {alert.severity}
                </span>
                {alert.status === 'acknowledged' && (
                  <span className="text-[9px] font-extrabold uppercase tracking-wide text-text-muted">
                    acknowledged
                  </span>
                )}
              </div>

              <p className="text-[11px] text-text-secondary mt-0.5 break-words">{alert.message}</p>

              {alert.recommendedAction && (
                <p className="text-[11px] text-text-primary mt-1">
                  <span className="font-semibold">Do: </span>
                  {alert.recommendedAction}
                </p>
              )}

              <div className="flex items-center gap-2 mt-1 text-[10px] text-text-muted font-mono">
                {owner && <span>{owner.firstName} {owner.lastName}</span>}
                {alert.account && <span className="truncate">{alert.account.email}</span>}
                {alert.domain && !alert.account && <span>{alert.domain}</span>}
                <span>{new Date(alert.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
            </div>

            {canManage && (
              <div className="flex flex-col gap-1 shrink-0">
                {alert.status === 'open' && (
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => onTransition(alert.id, 'acknowledge')}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border border-card-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Eye className="w-3 h-3" />
                    Ack
                  </button>
                )}
                <button
                  type="button"
                  disabled={isMutating}
                  onClick={() => onTransition(alert.id, 'resolve')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border border-channel-whatsapp/30 text-channel-whatsapp hover:bg-channel-whatsapp/10 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-3 h-3" />
                  Resolve
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
