import React from 'react';

/**
 * Loading placeholders shaped like the thing that is loading.
 *
 * The point is geometry, not decoration: if the skeleton is roughly the height of the real panel,
 * the page does not jump when data arrives. A jump mid-sentence during a live demo is the failure
 * mode these exist to prevent.
 *
 * The shimmer is a plain opacity pulse, which `prefers-reduced-motion` in globals.css already
 * collapses to nothing.
 */

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <span className={`block rounded bg-gray-100 animate-pulse ${className}`} aria-hidden="true" />;
}

export function SkeletonMetricRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-4 gap-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-card-border bg-card-bg px-4 py-4">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-7 w-14 mt-3" />
          <SkeletonBlock className="h-2.5 w-32 mt-2" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 4, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`divide-y divide-card-border ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <SkeletonBlock className="w-8 h-8 rounded-full" />
          <div className="flex-1">
            <SkeletonBlock className="h-3 w-40" />
            <SkeletonBlock className="h-2.5 w-64 mt-2" />
          </div>
          <SkeletonBlock className="h-5 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`rounded-xl border border-card-border bg-card-bg p-5 ${className}`} aria-hidden="true">
      <SkeletonBlock className="h-4 w-48" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} className="h-3 w-full mt-3" />
      ))}
      <SkeletonBlock className="h-3 w-2/3 mt-3" />
    </div>
  );
}
