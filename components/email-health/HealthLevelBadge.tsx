'use client';

import type { EmailHealthLevelValue } from '@/lib/email-health/types';

/**
 * Health level pill. Modelled on components/meetings/MeetingStatusBadge so the
 * two read as the same design system.
 *
 * Colours map to brand tokens rather than raw Tailwind palette entries:
 * healthy → whatsapp green, watch → gold, at_risk → flame orange,
 * critical → fire red, paused → muted.
 */

type LevelConfig = { label: string; text: string; bg: string; border: string; dot: string };

const LEVEL_CONFIG: Record<EmailHealthLevelValue, LevelConfig> = {
  healthy: {
    label: 'Healthy',
    text: 'text-channel-whatsapp',
    bg: 'bg-channel-whatsapp/10',
    border: 'border-channel-whatsapp/25',
    dot: 'bg-channel-whatsapp',
  },
  watch: {
    label: 'Watch',
    text: 'text-brand-gold-text',
    bg: 'bg-brand-gold/10',
    border: 'border-brand-gold/25',
    dot: 'bg-brand-gold',
  },
  at_risk: {
    label: 'At Risk',
    text: 'text-brand-orange-text',
    bg: 'bg-brand-orange/10',
    border: 'border-brand-orange/25',
    dot: 'bg-brand-orange',
  },
  critical: {
    label: 'Critical',
    text: 'text-brand-red',
    bg: 'bg-brand-red/10',
    border: 'border-brand-red/30',
    dot: 'bg-brand-red',
  },
  paused: {
    label: 'Paused',
    text: 'text-text-muted',
    bg: 'bg-text-muted/10',
    border: 'border-text-muted/25',
    dot: 'bg-text-muted',
  },
};

type Props = {
  level: EmailHealthLevelValue;
  score?: number;
  size?: 'sm' | 'md';
};

export default function HealthLevelBadge({ level, score, size = 'sm' }: Props) {
  const config = LEVEL_CONFIG[level] ?? LEVEL_CONFIG.paused;
  const sizing = size === 'md' ? 'text-[11px] px-2.5 py-1' : 'text-[9px] px-1.5 py-0.5';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-extrabold uppercase tracking-wide border ${config.bg} ${config.text} ${config.border} ${sizing}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      {config.label}
      {score !== undefined && <span className="font-mono opacity-70">{score}</span>}
    </span>
  );
}

export { LEVEL_CONFIG };
