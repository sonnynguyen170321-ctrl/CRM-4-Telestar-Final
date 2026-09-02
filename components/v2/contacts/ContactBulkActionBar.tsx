"use client";

import { X } from "lucide-react";

import { assignOwnersAction } from "@/app/v2/crm/contacts/assignOwnerAction";
import { useLeadSelection } from "@/components/v2/leads/LeadSelection";
import { BulkActionBarShell } from "@/components/v2/shared/BulkActionBarShell";
import {
  AssignContactsToIcpDialog,
  type AccountNode,
} from "./AssignContactsToIcpDialog";
import { BulkAssignOwnerDialog, type AssignableMember } from "./AssignOwnerDialog";

// Sticky bulk bar for the contacts workspace. Contacts are the people layer:
// selected contacts become Leads through Account -> Project -> ICP, then SDRs
// work the resulting lead in /v2/workspace/leads.
export function ContactBulkActionBar({
  accounts,
  assignableMembers = [],
  canAssign = false,
}: {
  accounts: AccountNode[];
  assignableMembers?: AssignableMember[];
  canAssign?: boolean;
}) {
  const { selected, count, clear } = useLeadSelection();

  if (count === 0) return null;

  const ids = Array.from(selected);

  return (
    <BulkActionBarShell>
      <span className="text-sm font-medium text-foreground">
        <span className="tabular-nums font-semibold text-foreground">{count}</span> selected
      </span>
      <div className="h-5 w-px bg-muted" aria-hidden="true" />
      <AssignContactsToIcpDialog leadAssignmentIds={ids} accounts={accounts} onDone={clear} />
      {canAssign ? (
        <BulkAssignOwnerDialog
          leadAssignmentIds={ids}
          members={assignableMembers}
          onAssign={assignOwnersAction}
          onDone={clear}
        />
      ) : null}
      <button
        type="button"
        onClick={clear}
        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-200 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        Clear
      </button>
    </BulkActionBarShell>
  );
}
