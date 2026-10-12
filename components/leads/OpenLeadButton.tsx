'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { openLeadSlideOver } from '@/lib/leads/openLead';

/** Opens the lead slide-over (there is no /leads/[id] page). Renders as a text button. */
export function OpenLeadButton({ leadId, className, children }: { leadId: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <button type="button" onClick={() => openLeadSlideOver(router, leadId)} className={`cursor-pointer text-left ${className ?? ''}`}>
      {children}
    </button>
  );
}
