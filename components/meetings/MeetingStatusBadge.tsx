'use client';

import React from 'react';

type MeetingStatusType = 'link_sent' | 'scheduled' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled';

const STATUS_CONFIG: Record<MeetingStatusType, { label: string; color: string; bg: string; dot: string }> = {
  link_sent:    { label: 'Link Sent',    color: 'text-blue-800 border border-blue-200/80',    bg: 'bg-blue-50',    dot: 'bg-blue-600' },
  scheduled:    { label: 'Scheduled',    color: 'text-amber-800 border border-amber-200/80',   bg: 'bg-amber-50',   dot: 'bg-amber-600' },
  completed:    { label: 'Completed',    color: 'text-emerald-800 border border-emerald-200/80', bg: 'bg-emerald-50', dot: 'bg-emerald-600' },
  no_show:      { label: 'No Show',      color: 'text-rose-800 border border-rose-200/80',     bg: 'bg-rose-50',     dot: 'bg-rose-600' },
  cancelled:    { label: 'Cancelled',    color: 'text-gray-700 border border-gray-200',    bg: 'bg-gray-100',   dot: 'bg-gray-500' },
  rescheduled:  { label: 'Rescheduled',  color: 'text-purple-800 border border-purple-200/80',  bg: 'bg-purple-50',  dot: 'bg-purple-600' },
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
