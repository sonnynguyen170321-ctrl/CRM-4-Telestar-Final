"use client";

import { V2DetailDrawer, EntityHeader } from "@/components/v2/drawers/V2DetailDrawer";
import { RowInspectorContent } from "@/components/v2/drawers/RowInspectorContent";

export type IngestionRowInspectorData = {
  id: string;
  sourceRowNumber: number;
  rowStatus: string;
  rawRowJson: unknown;
  normalizedRowJson: unknown;
  matchedCompanyName: string | null;
  matchedContactName: string | null;
  matchedCompanyId: string | null;
  matchedContactId: string | null;
  errorMessage: string | null;
};

export function IngestionRowDrawer({
  row,
  closeHref,
}: {
  row: IngestionRowInspectorData;
  closeHref: string;
}) {
  return (
    <V2DetailDrawer open={!!row} onClose={() => { window.location.href = closeHref; }} widthClass="lg:w-[640px]">
      <EntityHeader
        eyebrow="Row inspector"
        title={`Row ${row.sourceRowNumber}`}
        subtitle={row.rowStatus}
        onClose={() => { window.location.href = closeHref; }}
      />
      <RowInspectorContent row={row} />
    </V2DetailDrawer>
  );
}
