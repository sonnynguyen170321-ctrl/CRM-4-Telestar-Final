import React from 'react';

/**
 * An empty region that explains itself.
 *
 * A blank panel during a live demo reads as broken. Every empty state here says what would appear
 * and why nothing has yet — "no prospects need your attention" is a *result*, not a gap.
 */
export default function EmptyState({
  title, description, icon: Icon, action, className = '', testId,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-6 py-10 ${className}`} data-testid={testId}>
      {Icon && (
        <span className="w-9 h-9 rounded-full bg-gray-50 border border-card-border flex items-center justify-center mb-3">
          <Icon className="w-4 h-4 text-text-muted" aria-hidden="true" />
        </span>
      )}
      <p className="type-body text-text-primary">{title}</p>
      {description && <p className="type-meta text-text-muted mt-1 max-w-[46ch]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
