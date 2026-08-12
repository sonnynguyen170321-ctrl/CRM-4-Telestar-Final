import React from 'react';
import {
  AlertCircle, CheckCircle2, CircleDot, Clock, RotateCcw, ShieldAlert, Sparkles, UserCheck,
} from 'lucide-react';
import type { StatusTone } from './states';

/**
 * The one status pill in the product.
 *
 * Same shape, same padding, same type tier everywhere — dashboard, leads table, prospect
 * workspace, command center. Two prospects in the same state must be indistinguishable at a
 * glance no matter which screen they are on; that consistency is most of what makes an operating
 * model legible.
 *
 * Every tone carries an icon as well as a colour. Colour alone never communicates state — the
 * screen has to survive a projector, a colour-blind viewer and a greyscale printout.
 */

const TONE_CLASS: Record<StatusTone, string> = {
  // Foreground colours are the darkened weights the contrast block in globals.css already
  // standardises on: all clear 4.5:1 on their own tint.
  ai: 'bg-blue-50 border-blue-200 text-blue-700',
  attention: 'bg-red-50 border-red-200 text-red-700',
  human: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  waiting: 'bg-amber-50 border-amber-200 text-amber-700',
  eligible: 'bg-orange-50 border-orange-200 text-orange-700',
  neutral: 'bg-gray-50 border-gray-200 text-gray-700',
  blocked: 'bg-red-50 border-red-300 text-red-800',
  done: 'bg-emerald-50 border-emerald-200 text-emerald-700',
};

const TONE_ICON: Record<StatusTone, React.ComponentType<{ className?: string }>> = {
  ai: Sparkles,
  attention: AlertCircle,
  human: UserCheck,
  waiting: Clock,
  eligible: RotateCcw,
  neutral: CircleDot,
  blocked: ShieldAlert,
  done: CheckCircle2,
};

interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
  /** `sm` for table cells and dense lists, `md` for headers. */
  size?: 'sm' | 'md';
  /** Hover title — usually the state's one-line hint. */
  title?: string;
  className?: string;
  'data-testid'?: string;
  /** Machine-readable value behind the human label, for tests and diagnostics. */
  'data-state'?: string;
}

export default function StatusBadge({
  label, tone, size = 'sm', title, className = '', ...rest
}: StatusBadgeProps) {
  const Icon = TONE_ICON[tone];
  const dims = size === 'md' ? 'px-2.5 py-1 gap-1.5' : 'px-2 py-0.5 gap-1';
  const icon = size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3';

  return (
    <span
      title={title}
      className={`inline-flex items-center ${dims} rounded-full border type-micro whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}
      data-testid={rest['data-testid']}
      data-state={rest['data-state']}
    >
      <Icon className={`${icon} shrink-0`} aria-hidden="true" />
      {label}
    </span>
  );
}
