import React from 'react';

/**
 * Name, role, company — the three facts that identify a prospect, in one consistent block.
 *
 * Used in the leads table, the attention queue and the command center list, so the same person
 * looks like the same person on every surface.
 */
export default function ProspectIdentity({
  name, title, company, size = 'sm', className = '',
}: {
  name: string;
  title?: string | null;
  company?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  const avatar = size === 'md' ? 'w-10 h-10' : 'w-8 h-8';

  return (
    <span className={`flex items-center gap-3 min-w-0 ${className}`}>
      <span
        className={`${avatar} rounded-full bg-brand-red/10 border border-brand-red/20 text-brand-red flex items-center justify-center type-micro shrink-0`}
        aria-hidden="true"
      >
        {initials}
      </span>
      <span className="min-w-0">
        <span className={`block ${size === 'md' ? 'type-subsection' : 'type-body'} text-text-primary truncate`}>
          {name}
        </span>
        <span className="block type-micro text-text-muted truncate">
          {[title, company].filter(Boolean).join(' · ') || '—'}
        </span>
      </span>
    </span>
  );
}
