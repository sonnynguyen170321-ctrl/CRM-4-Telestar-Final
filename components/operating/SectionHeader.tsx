import React from 'react';

/**
 * A panel header: title, optional one-line explanation, optional action on the right.
 *
 * Deliberately not an uppercase tracked eyebrow. The heading itself carries the tier; a kicker
 * above every section is scaffolding, not hierarchy.
 */
export default function SectionHeader({
  title, description, action, level = 2, className = '', id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Keeps the document outline honest — panels inside a page are h2, groups inside a panel h3. */
  level?: 2 | 3;
  className?: string;
  id?: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const tier = level === 2 ? 'type-section' : 'type-subsection';

  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <Heading id={id} className={tier}>{title}</Heading>
        {description && <p className="type-meta text-text-muted mt-1 prose-measure">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
