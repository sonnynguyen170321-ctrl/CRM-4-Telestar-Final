'use client';

import React from 'react';

type Status = 'active' | 'paused' | 'completed' | 'churned' | 'inactive';

/**
 * The lifecycle pill for clients, campaigns and users. Previously copy-pasted
 * ad hoc in Settings; one lookup keeps the colours consistent across the module.
 */
const STYLES: Record<Status, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30' },
  paused: { label: 'Paused', className: 'bg-amber-500/10 text-amber-700 border-amber-500/30' },
  completed: { label: 'Completed', className: 'bg-sky-500/10 text-sky-700 border-sky-500/30' },
  churned: { label: 'Churned', className: 'bg-brand-red/10 text-brand-red border-brand-red/30' },
  inactive: {
    label: 'Inactive',
    className: 'bg-card-border/40 text-text-muted border-card-border',
  },
};

export default function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status as Status] ?? {
    label: status,
    className: 'bg-card-border/40 text-text-muted border-card-border',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md border type-micro font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  );
}
