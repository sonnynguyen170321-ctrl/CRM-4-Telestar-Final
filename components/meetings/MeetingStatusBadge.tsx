'use client';

import React from 'react';

type MeetingStatusType = 'link_sent' | 'scheduled' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled';

const STATUS_CONFIG: Record<MeetingStatusType, { label: string; color: string; bg: string; dot: string }> = {
  link_sent:    { label: 'Link Sent',    color: 'text-blue-400',    bg: 'bg-blue-500/15',    dot: 'bg-blue-400' },
  scheduled:    { label: 'Scheduled',    color: 'text-amber-400',   bg: 'bg-amber-500/15',   dot: 'bg-amber-400' },
  completed:    { label: 'Completed',    color: 'text-emerald-400', bg: 'bg-emerald-500/15', dot: 'bg-emerald-400' },
  no_show:      { label: 'No Show',      color: 'text-red-400',     bg: 'bg-red-500/15',     dot: 'bg-red-400' },
  cancelled:    { label: 'Cancelled',    color: 'text-gray-400',    bg: 'bg-gray-500/15',    dot: 'bg-gray-400' },
  rescheduled:  { label: 'Rescheduled',  color: 'text-purple-400',  bg: 'bg-purple-500/15',  dot: 'bg-purple-400' },
};

interface MeetingStatusBadgeProps {
  status: MeetingStatusType;
  size?: 'sm' | 'md';
}

export default function MeetingStatusBadge({ status, size = 'sm' }: MeetingStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.scheduled;
  const sizeClasses = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.bg} ${config.color} ${sizeClasses}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
