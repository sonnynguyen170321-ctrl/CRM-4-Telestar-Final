import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// The single dense-table primitive for the unified Leadger theme. Every list surface (companies,
// contacts, accounts, reviews, campaign leads, senders, suppression, jobs...) renders through this so
// they share one look: sticky header, one row rhythm, accent-tint selection (never a side-stripe),
// responsive column hiding, and a contained horizontal scroll that never overflows the page.
//
// SERVER-COMPATIBLE by design: it's presentational (no "use client"), and each surface supplies the
// cell content - including its own Links, checkboxes, and badges. Keyboard nav + row selection stay in
// the surface's existing client islands (RouteListKeyboard / useListKeyboard / LeadRowCheckbox); this
// primitive stamps `data-row-id` on every row so those islands can find rows. Selection highlight comes
// from `selectedId`.
//
// Usage:
//   const columns: DataTableColumn<Row>[] = [
//     { key: "sel", header: <SelectAll ids={ids} />, width: "w-10",
//       cell: (r) => <RowCheckbox id={r.id} /> },
//     { key: "name", header: "Company",
//       cell: (r) => <Link href={href(r)} className="font-medium text-foreground hover:text-primary">{r.name}</Link> },
//     { key: "country", header: "Country", hideBelow: "md", cell: (r) => r.country ?? "-" },
//     { key: "action", header: "", align: "right", cell: (r) => <InspectButton href={href(r)} /> },
//   ];
//   <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} selectedId={selectedId}
//     title="Companies" empty={<EmptyState .../>} footer={<DataTablePagination .../>} />

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** width utility, e.g. "w-10" / "min-w-64" */
  width?: string;
  /** hide this column below a breakpoint (keeps dense tables readable on mobile) */
  hideBelow?: "sm" | "md" | "lg";
  headerClassName?: string;
  cellClassName?: string;
};

const ALIGN: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

const HIDE: Record<NonNullable<DataTableColumn<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

const VALIGN = {
  top: "align-top",
  middle: "align-middle",
  baseline: "align-baseline",
} as const;

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  selectedId,
  minWidth = "min-w-[880px]",
  title,
  description,
  toolbar,
  footer,
  empty,
  className,
  ariaLabel,
  onRowClick,
  verticalAlign = "middle",
}: {
  columns: DataTableColumn<T>[];
  rows: readonly T[];
  getRowId: (row: T) => string;
  selectedId?: string | null;
  minWidth?: string;
  title?: ReactNode;
  description?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  className?: string;
  ariaLabel?: string;
  /** Client-only: makes the whole row clickable (e.g. open a drawer). Server callers omit it. */
  onRowClick?: (row: T) => void;
  /** Cell vertical alignment. Use "top" for form-dense rows (senders); default "middle" for scannable lists. */
  verticalAlign?: keyof typeof VALIGN;
}) {
  const showEmpty = rows.length === 0 && empty;

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-sm",
        className
      )}
    >
      {title || description || toolbar ? (
        <div className="flex shrink-0 flex-col gap-3 border-b border-hairline px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
          </div>
          {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {showEmpty ? (
          <div className="p-6">{empty}</div>
        ) : (
          <table className={cn("w-full text-left text-sm", minWidth)} aria-label={ariaLabel}>
            <thead className="sticky top-0 z-10 bg-surface/90 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80 shadow-[inset_0_-1px_0_0] shadow-hairline backdrop-blur">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={cn(
                      "h-11 px-4 align-middle font-semibold",
                      c.width,
                      ALIGN[c.align ?? "left"],
                      c.hideBelow ? HIDE[c.hideBelow] : undefined,
                      c.headerClassName
                    )}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row) => {
                const id = getRowId(row);
                const selected = selectedId != null && id === selectedId;
                return (
                  <tr
                    key={id}
                    data-row-id={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "group/row transition-colors",
                      onRowClick && "cursor-pointer",
                      selected ? "bg-accent/60" : "hover:bg-muted/40"
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-4 py-3.5",
                          VALIGN[verticalAlign],
                          ALIGN[c.align ?? "left"],
                          c.hideBelow ? HIDE[c.hideBelow] : undefined,
                          c.cellClassName
                        )}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {footer ? <div className="shrink-0 border-t border-hairline px-4 py-2.5">{footer}</div> : null}
    </section>
  );
}

/** Shared prev/next pagination footer for DataTable - one look across every list surface. */
export function DataTablePagination({
  page,
  totalPages,
  label,
  previousHref,
  nextHref,
}: {
  page: number;
  totalPages: number;
  label: string;
  previousHref: string;
  nextHref: string;
}) {
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;
  const link = (href: string, disabled: boolean, children: ReactNode) =>
    disabled ? (
      <span className="cursor-not-allowed rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-muted-foreground opacity-50">
        {children}
      </span>
    ) : (
      <a href={href} className="rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2">
        {children}
      </a>
    );
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>Page {page} of {totalPages} - {label}</span>
      <div className="flex items-center gap-1.5">
        {link(previousHref, prevDisabled, "Prev")}
        {link(nextHref, nextDisabled, "Next")}
      </div>
    </div>
  );
}
