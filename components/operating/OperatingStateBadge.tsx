import React from 'react';
import StatusBadge from './StatusBadge';
import { operatingStateMeta } from './states';

/**
 * A prospect's operating state, in words a salesperson uses.
 *
 * The raw enum still travels with the element as `data-state`, so tests and the diagnostics
 * escape hatch can assert on the real value without the screen ever showing it.
 */
export default function OperatingStateBadge({
  state, size = 'sm', className = '', testId,
}: {
  state: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
  testId?: string;
}) {
  const meta = operatingStateMeta(state);
  return (
    <StatusBadge
      label={meta.label}
      tone={meta.tone}
      size={size}
      title={meta.hint}
      className={className}
      data-testid={testId}
      data-state={state ?? undefined}
    />
  );
}
