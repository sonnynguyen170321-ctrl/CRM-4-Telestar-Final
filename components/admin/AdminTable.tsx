'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  /** Right-align numeric columns. */
  numeric?: boolean;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  emptyIcon?: React.ReactNode;
  emptyMessage?: string;
  /** Renders under the row when it is expanded. */
  renderExpanded?: (row: T) => React.ReactNode;
  expandedKey?: string | null;
  onRowClick?: (row: T) => void;
}

/**
 * The shared admin table. Sticky header, loading and empty states, optional
 * expanded row — lifted from the job-runs page so the five admin tables agree.
 *
 * Row height and cell padding follow the documented data-table exception to
 * brand density (see `.claude/rules/frontend-ux.md`).
 */
export default function AdminTable<T>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  emptyIcon,
  emptyMessage = 'Nothing to show.',
  renderExpanded,
  expandedKey = null,
  onRowClick,
}: Props<T>) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-text-muted type-meta font-mono">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Loading…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        {emptyIcon}
        <p className="type-meta text-text-muted">{emptyMessage}</p>
      </div>
    );
  }

  // The `px-4 py-3` on the cells below is inert: `app/globals.css` sets `table th, table td`
  // padding outside any `@layer`, and unlayered CSS beats Tailwind's layered utilities
  // whatever their specificity (the same trick the file uses to collapse ad-hoc text sizes).
  // Cell density for every table in the app is set there, not here — don't tune it locally
  // and expect it to take.
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-card-bg">
          <tr className="border-b border-card-border">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-4 py-3 type-meta font-semibold text-text-muted ${
                  col.numeric ? 'text-right' : 'text-left'
                } ${col.className ?? ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = rowKey(row);
            const isExpanded = expandedKey === id;
            return (
              <React.Fragment key={id}>
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-card-border/60 transition-colors ${
                    onRowClick ? 'cursor-pointer hover:bg-bg-main/50' : ''
                  } ${isExpanded ? 'bg-bg-main/50' : ''}`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3 type-body text-text-secondary align-middle ${
                        col.numeric ? 'text-right font-mono' : ''
                      } ${col.className ?? ''}`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
                {isExpanded && renderExpanded && (
                  <tr className="border-b border-card-border/60 bg-bg-main/30">
                    <td colSpan={columns.length} className="px-4 py-3">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
