"use client";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MappingRow } from "@/lib/mock/column-mapping";

type HeaderMapperProps = {
  rows: MappingRow[];
  sourceHeaders: string[];
};

const statusVariant = {
  mapped: "default",
  suggested: "secondary",
  optional: "outline",
  missing: "destructive",
} as const;

export function HeaderMapper({ rows, sourceHeaders }: HeaderMapperProps) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid gap-3 rounded-md border bg-background p-3 md:grid-cols-[220px_120px_minmax(0,1fr)_110px]"
        >
          <div>
            <p className="text-sm font-medium text-foreground">{row.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              TeleStar company field
            </p>
          </div>
          <div className="flex items-center">
            <Badge variant="outline">{row.requirement}</Badge>
          </div>
          <Select defaultValue={row.mappedHeader ?? "unmapped"}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select CSV header" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unmapped">Not mapped</SelectItem>
              {sourceHeaders.map((header) => (
                <SelectItem key={header} value={header}>
                  {header}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center md:justify-end">
            <Badge variant={statusVariant[row.status]}>{row.status}</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}
